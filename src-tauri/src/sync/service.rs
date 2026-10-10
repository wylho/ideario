//! O sync dentro do app: o login, a linha de fundo que sincroniza e o que a interface vê.
//!
//! Quando sincroniza: ao abrir, a cada minuto (o que mudou em outros aparelhos), alguns segundos depois de uma
//! edição aqui (quando a escrita para), ao voltar à janela e no "Sincronizar agora". Só uma linha sincroniza; a rede
//! nunca segura o banco (a trava é pega só para ler e gravar).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_opener::OpenerExt;

use super::auth::{self, Session};
use super::drive::{DriveApi, Tokens};
use super::{fetch_attachment, sync_once, Device, Report, SResult, SyncError};
use crate::commands::Core;
use crate::store::{LocalChanges, SyncStatus};

/// De quanto em quanto tempo a linha olha se há algo a fazer.
const TICK: Duration = Duration::from_secs(4);
/// De quanto em quanto tempo pergunta ao Drive o que mudou em outros aparelhos.
const POLL: Duration = Duration::from_secs(60);
/// Depois de falhar (sem rede), espera isso antes de tentar sozinho de novo.
const RETRY: Duration = Duration::from_secs(30);
/// "Voltar à janela" não sincroniza de novo se acabou de sincronizar.
const FOCUS_GAP: Duration = Duration::from_secs(15);
const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);

enum Wake {
    /// Pedido explícito ("Sincronizar agora", login novo).
    Now,
    /// A janela voltou ao primeiro plano.
    Focus,
}

/// Fase que a interface mostra (a nuvem só aparece em `syncing`, `offline` e `error`).
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Phase {
    pub state: &'static str,
    pub error: Option<String>,
}

type SharedSession = Arc<Mutex<Option<Session>>>;

/// Estado do sync no app (gerenciado pelo Tauri).
#[derive(Default)]
pub struct Sync {
    /// O login (a trava fica pega durante a renovação do token, que vai à rede: nada da interface espera por ela).
    session: SharedSession,
    /// Há login? (lido pela interface sem tocar na sessão)
    connected: AtomicBool,
    wake: Mutex<Option<mpsc::Sender<Wake>>>,
    phase: Mutex<Phase>,
    cancel_login: Arc<AtomicBool>,
    /// Um ciclo por vez; sair da conta espera o ciclo em andamento terminar.
    cycle: Mutex<()>,
    /// Liga ao sair da conta: o ciclo em andamento para de gravar na hora.
    stop: AtomicBool,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Os tokens da sessão compartilhada (o sync e o download sob demanda usam a mesma).
struct Shared(SharedSession);

impl Tokens for Shared {
    fn access(&mut self, renew: bool) -> SResult<String> {
        match lock(&self.0).as_mut() {
            Some(s) => s.access(renew),
            None => Err(SyncError::Unauthorized),
        }
    }
}

impl Sync {
    fn signed_in(&self) -> bool {
        self.connected.load(Ordering::Relaxed)
    }

    fn set_session(&self, session: Option<Session>) {
        self.connected.store(session.is_some(), Ordering::Relaxed);
        *lock(&self.session) = session;
    }

    fn drive(&self) -> DriveApi<Shared> {
        DriveApi::new(Shared(self.session.clone()))
    }

    fn poke(&self, w: Wake) {
        if let Some(tx) = lock(&self.wake).as_ref() {
            let _ = tx.send(w);
        }
    }

    fn set_phase(&self, app: &AppHandle, state: &'static str, error: Option<String>) {
        let next = Phase { state, error };
        let mut cur = lock(&self.phase);
        if *cur != next {
            *cur = next.clone();
            let _ = app.emit("sync-state", next);
        }
    }
}

/// Ao abrir o app: retoma o login guardado e começa a linha do sync.
pub fn start(app: &AppHandle) {
    let core = app.state::<Core>();
    let sync = app.state::<Sync>();
    let account = core.with(|s| s.sync_value("account")).ok().flatten();
    if let (Some(client), Some(_), Some(refresh)) = (auth::client(), account, auth::load_refresh(&core.data)) {
        sync.set_session(Some(Session::new(client, refresh)));
    }
    let (tx, rx) = mpsc::channel();
    *lock(&sync.wake) = Some(tx);
    let app = app.clone();
    std::thread::spawn(move || run(app, rx));
}

fn run(app: AppHandle, rx: mpsc::Receiver<Wake>) {
    let mut last_sync: Option<Instant> = None;
    let mut failed_at: Option<Instant> = None;
    let mut previous: Option<LocalChanges> = None;
    // Categorias mexidas depois do último sync contam como mudança local.
    let mut synced_categories = i64::MIN;
    let mut first = true;
    loop {
        let woke = match rx.recv_timeout(TICK) {
            Ok(w) => Some(w),
            Err(RecvTimeoutError::Timeout) => None,
            Err(RecvTimeoutError::Disconnected) => return,
        };
        let sync = app.state::<Sync>();
        if !sync.signed_in() {
            previous = None;
            continue;
        }
        let Ok(local) = app.state::<Core>().with(|s| s.local_changes()) else { continue };
        let work = local.has_work() || local.categories_changed_at > synced_categories;
        let since = |t: Option<Instant>| t.map_or(Duration::MAX, |t| t.elapsed());
        let backing_off = since(failed_at) < RETRY;
        let go = match woke {
            Some(Wake::Now) => true,
            Some(Wake::Focus) => since(last_sync) >= FOCUS_GAP && !backing_off,
            // Mudança aqui: espera a escrita parar (nada mudou desde a última olhada).
            None => !backing_off && (first || since(last_sync) >= POLL || (work && previous.as_ref() == Some(&local))),
        };
        previous = Some(local.clone());
        if !go {
            continue;
        }
        first = false;
        // A nuvem só aparece quando há algo daqui subindo (o "o que mudou lá?" de cada minuto fica quieto).
        let res = run_once(&app, work || matches!(woke, Some(Wake::Now)));
        last_sync = Some(Instant::now());
        match res {
            Ok(_) => {
                failed_at = None;
                synced_categories = local.categories_changed_at;
            }
            Err(_) => failed_at = Some(Instant::now()),
        }
        previous = None;
    }
}

fn run_once(app: &AppHandle, visible: bool) -> SResult<Report> {
    let (sync, core) = (app.state::<Sync>(), app.state::<Core>());
    let _cycle = lock(&sync.cycle);
    if !sync.signed_in() {
        return Ok(Report::default());
    }
    if visible {
        sync.set_phase(app, "syncing", None);
    }
    let res = sync_once(&Device { store: &core.store, data: &core.data, stop: &sync.stop }, &mut sync.drive());
    match &res {
        Ok(report) => {
            sync.set_phase(app, "ok", None);
            if report.changed_here() {
                let _ = app.emit("core-changed", ());
                let _ = app.emit("notes-synced", &report.notes);
            }
        }
        Err(SyncError::Offline(_)) => sync.set_phase(app, "offline", None),
        Err(SyncError::Stopped) => {}
        Err(SyncError::Unauthorized) => {
            // O Google não aceita mais o login (revogado, senha trocada, meses sem uso): para de tentar e pede para
            // entrar de novo. A conta e o que já foi sincronizado ficam; entrar de novo continua de onde parou.
            sync.set_session(None);
            sync.set_phase(app, "error", Some("O login do Google expirou. Entre de novo para voltar a sincronizar.".into()));
            let _ = app.emit("core-changed", ());
        }
        Err(e) => sync.set_phase(app, "error", Some(e.to_string())),
    }
    res
}

/// Anexo que outro aparelho subiu e ainda não desceu (os grandes só descem quando alguém abre): baixa agora.
/// Roda na linha do protocolo `att`, fora da trava do banco.
pub fn ensure_local(app: &AppHandle, hash: &str) {
    if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        return;
    }
    let (core, sync) = (app.state::<Core>(), app.state::<Sync>());
    if crate::attachments::dir(&core.data).join(hash).exists() || !sync.signed_in() {
        return;
    }
    let Ok(Some(file)) = core.with(|s| s.attachment_file(hash)) else { return };
    let _ = fetch_attachment(&Device { store: &core.store, data: &core.data, stop: &sync.stop }, &mut sync.drive(), hash, &file);
}

// ---------- comandos ----------

/// Status para as Configurações: conta, última vez, pendências e se o sync existe nesta versão.
#[tauri::command]
pub fn sync_status(core: tauri::State<Core>, sync: tauri::State<Sync>) -> Result<SyncStatus, String> {
    let mut status = core.with(|s| s.sync_status())?;
    status.configured = auth::client().is_some();
    status.connected = status.connected && sync.signed_in();
    let phase = lock(&sync.phase).clone();
    status.state = phase.state;
    status.error = phase.error;
    Ok(status)
}

#[tauri::command]
pub fn sync_now(sync: tauri::State<Sync>) {
    sync.poke(Wake::Now);
}

/// A janela voltou ao primeiro plano.
#[tauri::command]
pub fn sync_focus(sync: tauri::State<Sync>) {
    sync.poke(Wake::Focus);
}

/// Entrar com o Google: abre o navegador e espera a volta (até 5 minutos, ou "Cancelar").
#[tauri::command]
pub async fn sync_sign_in(app: AppHandle) -> Result<SyncStatus, String> {
    let client = auth::client().ok_or("O sync com o Google Drive não está configurado nesta versão do app.")?;
    let pending = auth::begin(client).map_err(|e| e.to_string())?;
    let sync = app.state::<Sync>();
    sync.cancel_login.store(false, Ordering::Relaxed);
    app.opener().open_url(&pending.url, None::<&str>).map_err(|e| format!("não foi possível abrir o navegador: {e}"))?;
    let cancel = sync.cancel_login.clone();
    let grant = tauri::async_runtime::spawn_blocking(move || {
        let code = pending.wait_for_code(LOGIN_TIMEOUT, &cancel)?;
        pending.finish(client, &code)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;
    let core = app.state::<Core>();
    // Outra conta que não a de antes: nada daqui aponta para os arquivos da conta antiga.
    let previous = core.with(|s| s.sync_value("account"))?;
    if previous.as_deref().is_some_and(|p| !grant.email.is_empty() && p != grant.email) {
        let _cycle = lock(&sync.cycle);
        core.with(|s| s.reset_sync())?;
    }
    auth::save_refresh(&core.data, &grant.refresh)?;
    let account = if grant.email.is_empty() { "Conta Google".to_string() } else { grant.email.clone() };
    core.with(|s| s.set_sync_value("account", Some(&account)))?;
    sync.set_session(Some(Session::new(client, grant.refresh).with_access(grant.access, grant.expires_in)));
    sync.set_phase(&app, "ok", None);
    sync.poke(Wake::Now);
    sync_status(app.state::<Core>(), app.state::<Sync>())
}

#[tauri::command]
pub fn sync_cancel_sign_in(sync: tauri::State<Sync>) {
    sync.cancel_login.store(true, Ordering::Relaxed);
}

/// Sair: esquece o login (e o desfaz no Google). As notas ficam neste aparelho; entrar de novo (com qualquer conta)
/// junta tudo outra vez. Espera o ciclo em andamento parar, para ele não gravar nada da conta antiga depois da limpeza.
#[tauri::command]
pub async fn sync_sign_out(app: AppHandle) -> Result<(), String> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (core, sync) = (handle.state::<Core>(), handle.state::<Sync>());
        sync.stop.store(true, Ordering::Relaxed);
        let _cycle = lock(&sync.cycle);
        let session = lock(&sync.session).take();
        sync.connected.store(false, Ordering::Relaxed);
        if let Some(session) = session {
            std::thread::spawn(move || session.revoke());
        }
        auth::forget_refresh(&core.data);
        let res = core.with(|s| s.reset_sync());
        sync.stop.store(false, Ordering::Relaxed);
        res
    })
    .await
    .map_err(|e| e.to_string())??;
    let sync = app.state::<Sync>();
    sync.set_phase(&app, "ok", None);
    let _ = app.emit("core-changed", ());
    Ok(())
}
