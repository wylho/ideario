//! Sync com o Google Drive (Fase 5, SPEC §6). Tudo em segundo plano: a UI só fala com o banco local.
//!
//! No Drive, na pasta oculta do app (`appDataFolder`), um arquivo por nota (o estado Yjs), um com as categorias
//! (também um Y.Doc) e um por anexo (endereçado pelo hash). Cada arquivo leva `appProperties` (`kind`, `noteId`,
//! `hash`…) para ser reconhecido sem baixar o conteúdo.
//!
//! Ciclo (`sync_once`): puxa o que mudou no Drive desde a última vez (`changes`) e junta no Y.Doc local (o CRDT
//! garante que nada se perde); depois sobe os anexos novos, as notas com mudança local (`dirty`), as categorias e
//! as exclusões. Mesmo que dois aparelhos sobrescrevam o mesmo arquivo ao mesmo tempo, o próximo ciclo converge:
//! quem tinha algo que o Drive não tem continua `dirty` depois de juntar e sobe de novo.

#[cfg(target_os = "android")]
pub(crate) mod android;
mod auth;
mod drive;
#[cfg(test)]
mod memory;
pub(crate) mod service;
#[cfg(test)]
mod tests;

use std::collections::BTreeMap;
use std::fmt;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use sha2::{Digest, Sha256};

use crate::store::{now, Attachment, Millis, Store};
use crate::{attachments, media, ydoc};

pub use service::{ensure_local, start, Sync};

/// `appProperties` de um arquivo no Drive.
pub(crate) type Props = BTreeMap<String, String>;

const KIND: &str = "kind";
const NOTE: &str = "note";
const CATEGORIES: &str = "categories";
const ATTACHMENT: &str = "attachment";

/// Anexos maiores que isso não descem no sync: só quando alguém abre (fotos sempre descem, para a lista e o
/// Moodboard).
const EAGER_LIMIT: i64 = 8 * 1024 * 1024;

/// Quantos arquivos descem por vez (o Drive de verdade baixa o lote em paralelo). A cada lote de notas a interface já
/// mostra o que chegou, sem esperar o ciclo inteiro (a primeira vez num aparelho novo são centenas de notas).
const BATCH: usize = 24;

/// Envio de um arquivo: `file` já existe no Drive (atualiza o conteúdo e o `appProperties`) ou é criado a partir de
/// `new`. Se o arquivo sumiu do Drive enquanto havia mudança aqui, é criado de novo (a edição não se perde).
pub(crate) struct Upload<'a> {
    pub file: Option<String>,
    pub new: NewFile<'a>,
}

/// Um arquivo no Drive, como o sync precisa.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct RemoteFile {
    pub id: String,
    /// Versão do conteúdo (muda a cada envio): o que já foi juntado aqui não desce de novo.
    pub rev: String,
    pub modified: Millis,
    pub props: Props,
    pub description: Option<String>,
}

impl RemoteFile {
    fn kind(&self) -> Option<&str> {
        self.props.get(KIND).map(String::as_str)
    }

    fn millis(&self, key: &str) -> Option<Millis> {
        self.props.get(key).and_then(|v| v.parse().ok())
    }
}

#[derive(Debug, Clone)]
pub(crate) enum Change {
    Upsert(RemoteFile),
    Removed(String),
}

/// Arquivo novo a criar no Drive.
pub(crate) struct NewFile<'a> {
    pub name: String,
    pub props: Props,
    pub description: Option<String>,
    pub mime: &'a str,
    pub bytes: &'a [u8],
}

#[derive(Debug, Clone, PartialEq)]
pub enum SyncError {
    /// O arquivo não existe (outro aparelho apagou).
    NotFound,
    /// Sem login ou o login perdeu a validade: precisa entrar de novo.
    Unauthorized,
    /// Sem conexão (ou o Drive não respondeu): tenta de novo depois.
    Offline(String),
    /// Parado no meio (saiu da conta): nada mais é gravado.
    Stopped,
    Other(String),
}

impl fmt::Display for SyncError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SyncError::NotFound => write!(f, "arquivo não encontrado no Drive"),
            SyncError::Unauthorized => write!(f, "é preciso entrar com a conta Google de novo"),
            SyncError::Offline(e) => write!(f, "sem conexão com o Drive ({e})"),
            SyncError::Stopped => write!(f, "sincronização interrompida"),
            SyncError::Other(e) => write!(f, "{e}"),
        }
    }
}

impl From<String> for SyncError {
    fn from(e: String) -> Self {
        SyncError::Other(e)
    }
}

pub(crate) type SResult<T> = std::result::Result<T, SyncError>;

/// O Drive (ou, nos testes, um Drive em memória).
pub(crate) trait Remote {
    /// Marca "agora" na lista de mudanças: `changes` a partir dela traz só o que mudar depois.
    fn start_token(&mut self) -> SResult<String>;
    fn list_all(&mut self) -> SResult<Vec<RemoteFile>>;
    /// O que mudou desde `token` e a marca para a próxima vez.
    fn changes(&mut self, token: &str) -> SResult<(Vec<Change>, String)>;
    fn download(&mut self, id: &str) -> SResult<Vec<u8>>;
    /// Vários downloads, um resultado por id, na mesma ordem. O Drive de verdade faz em paralelo.
    fn download_many(&mut self, ids: &[String]) -> Vec<SResult<Vec<u8>>> {
        ids.iter().map(|id| self.download(id)).collect()
    }
    fn create(&mut self, file: &NewFile) -> SResult<RemoteFile>;
    fn update(&mut self, id: &str, props: &Props, bytes: &[u8]) -> SResult<RemoteFile>;
    /// Vários envios, um resultado por item, na mesma ordem. O Drive de verdade faz em paralelo. Sem rede ou sem
    /// login, o resto nem tenta.
    fn upload_many(&mut self, ups: &[Upload]) -> Vec<SResult<RemoteFile>> {
        let mut give_up: Option<SyncError> = None;
        ups.iter()
            .map(|u| {
                if let Some(e) = &give_up {
                    return Err(e.clone());
                }
                let res = upload_one(self, u);
                if let Err(e @ (SyncError::Offline(_) | SyncError::Unauthorized | SyncError::Stopped)) = &res {
                    give_up = Some(e.clone());
                }
                res
            })
            .collect()
    }
    fn delete(&mut self, id: &str) -> SResult<()>;
}

/// Um envio pelo caminho normal (um por vez).
pub(crate) fn upload_one<R: Remote + ?Sized>(remote: &mut R, u: &Upload) -> SResult<RemoteFile> {
    match &u.file {
        Some(f) => match remote.update(f, &u.new.props, u.new.bytes) {
            Err(SyncError::NotFound) => remote.create(&u.new),
            other => other,
        },
        None => remote.create(&u.new),
    }
}

/// Este aparelho: o banco (a trava só é pega para ler e gravar, nunca durante a rede) e a pasta de dados.
/// `stop` liga quando a conta sai no meio de um ciclo: daí em diante nada é lido nem gravado (senão os ids do Drive da
/// conta antiga voltariam para o banco que acabou de ser limpo).
pub(crate) struct Device<'a> {
    pub store: &'a Mutex<Store>,
    pub data: &'a Path,
    pub stop: &'a AtomicBool,
    /// Notas que acabaram de chegar ou mudar (a cada lote): a interface recarrega sem esperar o fim do ciclo.
    pub arrived: &'a dyn Fn(&[String]),
}

/// `f` em cada item, com até `workers` linhas ao mesmo tempo; os resultados na ordem dos itens.
pub(crate) fn par_map<T: std::marker::Sync, R: Send>(items: &[T], workers: usize, f: impl Fn(&T) -> R + std::marker::Sync) -> Vec<R> {
    let next = std::sync::atomic::AtomicUsize::new(0);
    let mut out: Vec<(usize, R)> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..workers.clamp(1, items.len().max(1)))
            .map(|_| {
                scope.spawn(|| {
                    let mut mine = Vec::new();
                    loop {
                        let i = next.fetch_add(1, Ordering::Relaxed);
                        let Some(item) = items.get(i) else { break };
                        mine.push((i, f(item)));
                    }
                    mine
                })
            })
            .collect();
        handles.into_iter().flat_map(|h| h.join().unwrap_or_default()).collect()
    });
    out.sort_by_key(|(i, _)| *i);
    out.into_iter().map(|(_, r)| r).collect()
}

impl Device<'_> {
    fn with<T>(&self, f: impl FnOnce(&Store) -> crate::store::Result<T>) -> SResult<T> {
        if self.stop.load(Ordering::Relaxed) {
            return Err(SyncError::Stopped);
        }
        let store = self.store.lock().map_err(|_| SyncError::Other("banco indisponível".into()))?;
        Ok(f(&store)?)
    }
}

/// O que um ciclo fez.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct Report {
    /// Notas que chegaram ou mudaram por causa do Drive.
    pub received: usize,
    /// Quais (o editor aberto numa delas junta a mudança na hora).
    pub notes: Vec<String>,
    /// Notas enviadas.
    pub sent: usize,
    /// Notas que saíram daqui porque foram excluídas em outro aparelho.
    pub removed: usize,
    /// Quais (o editor aberto numa delas avisa).
    pub removed_notes: Vec<String>,
    /// Anexos que desceram.
    pub files: usize,
    /// Categorias mudaram por causa do Drive.
    pub categories: bool,
    /// Arquivos do Drive que não deu para ler (corrompidos ou de uma versão futura do app): ficam de fora, sem travar
    /// o resto.
    pub skipped: usize,
}

impl Report {
    /// A UI precisa recarregar?
    pub fn changed_here(&self) -> bool {
        self.received > 0 || self.removed > 0 || self.files > 0 || self.categories
    }
}

pub(crate) fn sync_once(dev: &Device, remote: &mut dyn Remote) -> SResult<Report> {
    let mut report = Report::default();
    pull(dev, remote, &mut report)?;
    push(dev, remote, &mut report)?;
    fetch_files(dev, remote, &mut report)?;
    dev.with(|s| s.set_sync_value("last_sync", Some(&now().to_string())))?;
    Ok(report)
}

// ---------- puxar ----------

pub(crate) fn pull(dev: &Device, remote: &mut dyn Remote, report: &mut Report) -> SResult<()> {
    let (changes, next) = match dev.with(|s| s.sync_value("drive_token"))? {
        Some(token) => remote.changes(&token)?,
        None => {
            // Primeira vez: tudo o que já está lá. A marca vem antes da lista, para nada que mude no meio se perder.
            let start = remote.start_token()?;
            let files = remote.list_all()?;
            // Entrando numa conta que já tem notas: a nota de boas-vindas deste aparelho sobra.
            if files.iter().any(|f| f.kind() == Some(NOTE)) {
                dev.with(|s| s.drop_untouched_welcome())?;
            }
            (files.into_iter().map(Change::Upsert).collect(), start)
        }
    };
    // Anexos antes das notas (a nota que chega já acha o anexo) e as categorias antes das notas também.
    let (mut notes, mut categories, mut removed) = (Vec::new(), Vec::new(), Vec::new());
    for change in changes {
        match change {
            Change::Removed(id) => removed.push(id),
            Change::Upsert(f) => match f.kind() {
                Some(ATTACHMENT) => register_attachment(dev, &f)?,
                Some(CATEGORIES) => categories.push(f),
                Some(NOTE) => notes.push(f),
                _ => {}
            },
        }
    }
    for f in &categories {
        pull_categories(dev, remote, f, report)?;
    }
    for batch in notes.chunks(BATCH) {
        pull_notes(dev, remote, batch, report)?;
    }
    for file in &removed {
        let note = dev.with(|s| s.note_by_file(file))?;
        if dev.with(|s| s.remove_synced_note(file))? {
            report.removed += 1;
            report.removed_notes.extend(note);
        }
    }
    dev.with(|s| s.set_sync_value("drive_token", Some(&next)))
}

/// Um lote de notas: vê quais precisam descer, baixa todas de uma vez e junta uma a uma.
fn pull_notes(dev: &Device, remote: &mut dyn Remote, batch: &[RemoteFile], report: &mut Report) -> SResult<()> {
    let mut wanted = Vec::new();
    for f in batch {
        if needs_pull(dev, f)? {
            wanted.push(f);
        }
    }
    let ids: Vec<String> = wanted.iter().map(|f| f.id.clone()).collect();
    let before = report.notes.len();
    for (f, bytes) in wanted.into_iter().zip(remote.download_many(&ids)) {
        match bytes {
            Err(SyncError::NotFound) => {}
            other => merge_note(dev, f, &other?, report)?,
        }
    }
    if report.notes.len() > before {
        (dev.arrived)(&report.notes[before..]);
    }
    Ok(())
}

/// A nota precisa descer? Não se já foi juntada nesta versão (inclusive a que este aparelho mesmo enviou) nem se
/// foi excluída de vez aqui (o arquivo sai no próximo envio: não pode voltar).
fn needs_pull(dev: &Device, f: &RemoteFile) -> SResult<bool> {
    let Some(id) = f.props.get("noteId") else { return Ok(false) };
    let (known, deleting) = dev.with(|s| Ok((s.note_file(id)?, s.is_pending_delete(&f.id)?)))?;
    if deleting && known.is_none() {
        return Ok(false);
    }
    let (mine, my_rev) = known.unwrap_or_default();
    Ok(!(mine.as_deref() == Some(f.id.as_str()) && my_rev.as_deref() == Some(f.rev.as_str())))
}

fn merge_note(dev: &Device, f: &RemoteFile, bytes: &[u8], report: &mut Report) -> SResult<()> {
    let Some(id) = f.props.get("noteId") else { return Ok(()) };
    if ydoc::to_note(id, bytes).is_err() {
        report.skipped += 1;
        return Ok(());
    }
    let (mine, my_rev) = dev.with(|s| s.note_file(id))?.unwrap_or_default();
    // Dois arquivos para a mesma nota (dois aparelhos criaram ao mesmo tempo): fica o de menor id, o outro é juntado
    // e apagado. Os dois aparelhos escolhem o mesmo. O que perdeu continua sendo juntado enquanto não sai do Drive
    // (o outro aparelho pode ter escrito nele de novo).
    let (file, rev, keep_mine) = match mine {
        Some(m) if m != f.id && m < f.id => (m, my_rev.unwrap_or_default(), true),
        Some(m) if m != f.id => {
            dev.with(|s| s.add_pending_delete(&m))?;
            (f.id.clone(), f.rev.clone(), false)
        }
        _ => (f.id.clone(), f.rev.clone(), false),
    };
    let edited = f.millis("updated").unwrap_or(f.modified);
    let created = f.millis("created").unwrap_or(edited);
    let changed = dev.with(|s| {
        let changed = s.merge_remote_note(id, bytes, (&file, &rev), created, edited)?;
        if keep_mine {
            // O arquivo que fica ainda não tem o que veio do outro: sobe junto (antes de o outro ser apagado).
            s.add_pending_delete(&f.id)?;
            s.mark_dirty(id)?;
        }
        Ok(changed)
    })?;
    if changed {
        report.received += 1;
        report.notes.push(id.clone());
    }
    Ok(())
}

fn register_attachment(dev: &Device, f: &RemoteFile) -> SResult<()> {
    let Some(hash) = f.props.get("hash") else { return Ok(()) };
    let Some(a) = f.description.as_deref().and_then(|d| serde_json::from_str::<Attachment>(d).ok()) else { return Ok(()) };
    if &a.hash != hash {
        return Ok(());
    }
    dev.with(|s| s.register_remote_attachment(&a, &f.id))
}

fn pull_categories(dev: &Device, remote: &mut dyn Remote, f: &RemoteFile, report: &mut Report) -> SResult<()> {
    let mine = dev.with(|s| s.sync_value("categories_file"))?;
    if mine.as_deref() == Some(f.id.as_str()) && dev.with(|s| s.sync_value("categories_rev"))?.as_deref() == Some(f.rev.as_str()) {
        return Ok(());
    }
    let bytes = match remote.download(&f.id) {
        Err(SyncError::NotFound) => return Ok(()),
        other => other?,
    };
    if ydoc::read_categories(&bytes).is_err() {
        report.skipped += 1;
        return Ok(());
    }
    dev.with(|s| {
        let local = ydoc::write_categories(&s.sync_blob("categories")?.unwrap_or_default(), &s.category_rows()?)?;
        let merged = ydoc::apply(&local, &bytes)?;
        let rows = ydoc::read_categories(&merged)?;
        if rows != ydoc::read_categories(&local)? {
            report.categories = true;
        }
        s.put_category_rows(&rows)?;
        s.set_sync_blob("categories", &merged)?;
        // Um arquivo de categorias só (o de menor id, se dois aparelhos criaram ao mesmo tempo).
        match mine {
            Some(m) if m != f.id && m < f.id => s.add_pending_delete(&f.id),
            Some(m) if m != f.id => {
                s.add_pending_delete(&m)?;
                adopt_categories_file(s, f, &bytes)
            }
            _ => adopt_categories_file(s, f, &bytes),
        }
    })
}

fn adopt_categories_file(s: &Store, f: &RemoteFile, content: &[u8]) -> crate::store::Result<()> {
    s.set_sync_value("categories_file", Some(&f.id))?;
    s.set_sync_value("categories_rev", Some(&f.rev))?;
    s.set_sync_blob("categories_remote", content)
}

// ---------- subir ----------

pub(crate) fn push(dev: &Device, remote: &mut dyn Remote, report: &mut Report) -> SResult<()> {
    push_attachments(dev, remote)?;
    // Em lotes, cada lote em paralelo. Um envio que falha não desfaz os outros: eles ficam marcados e o erro volta no
    // fim do lote (o ciclo seguinte tenta só o que faltou).
    let dirty = dev.with(|s| s.dirty_notes())?;
    for batch in dirty.chunks(BATCH) {
        let mut notes = Vec::new();
        for (id, file) in batch {
            let (state, (created, updated)) = dev.with(|s| Ok((s.ydoc(id)?, s.note_times(id)?)))?;
            let Some(state) = state else { continue };
            let props = Props::from([
                (KIND.into(), NOTE.into()),
                ("noteId".into(), id.clone()),
                ("created".into(), created.to_string()),
                ("updated".into(), updated.to_string()),
            ]);
            notes.push((id.clone(), file.clone(), state, props));
        }
        let ups: Vec<Upload> = notes
            .iter()
            .map(|(id, file, state, props)| Upload {
                file: file.clone(),
                new: NewFile { name: format!("note-{id}.ydoc"), props: props.clone(), description: None, mime: "application/octet-stream", bytes: state },
            })
            .collect();
        let mut failed = None;
        for ((id, _, state, _), res) in notes.iter().zip(remote.upload_many(&ups)) {
            match res {
                Ok(sent) => {
                    // Excluída enquanto subia: o arquivo que acabou de nascer sai também (senão a nota volta nos outros).
                    if !dev.with(|s| s.mark_uploaded(id, state, &sent.id, &sent.rev))? {
                        dev.with(|s| s.add_pending_delete(&sent.id))?;
                    }
                    report.sent += 1;
                }
                Err(e) => failed = failed.or(Some(e)),
            }
        }
        if let Some(e) = failed {
            return Err(e);
        }
    }
    push_categories(dev, remote)?;
    for file in dev.with(|s| s.pending_deletes())? {
        match remote.delete(&file) {
            Ok(()) | Err(SyncError::NotFound) => dev.with(|s| s.clear_pending_delete(&file))?,
            Err(e) => return Err(e),
        }
    }
    Ok(())
}

fn push_attachments(dev: &Device, remote: &mut dyn Remote) -> SResult<()> {
    let todo = dev.with(|s| s.attachments_to_upload())?;
    for batch in todo.chunks(BATCH) {
        let mut files = Vec::new();
        for a in batch {
            // Só o que está aqui. Sumiu do disco: fica marcado como ausente (não é trabalho pendente para sempre).
            let Ok(bytes) = std::fs::read(attachments::dir(dev.data).join(&a.hash)) else {
                dev.with(|s| s.set_attachment_missing(&a.hash))?;
                continue;
            };
            let description = serde_json::to_string(a).map_err(|e| SyncError::Other(e.to_string()))?;
            files.push((a, bytes, description));
        }
        let ups: Vec<Upload> = files
            .iter()
            .map(|(a, bytes, description)| Upload {
                file: None,
                new: NewFile {
                    name: format!("att-{}", a.hash),
                    props: Props::from([(KIND.into(), ATTACHMENT.into()), ("hash".into(), a.hash.clone())]),
                    description: Some(description.clone()),
                    mime: &a.mime,
                    bytes,
                },
            })
            .collect();
        let mut failed = None;
        for ((a, ..), res) in files.iter().zip(remote.upload_many(&ups)) {
            match res {
                Ok(f) => dev.with(|s| s.set_attachment_file(&a.hash, &f.id))?,
                Err(e) => failed = failed.or(Some(e)),
            }
        }
        if let Some(e) = failed {
            return Err(e);
        }
    }
    Ok(())
}

fn push_categories(dev: &Device, remote: &mut dyn Remote) -> SResult<()> {
    let (doc, remote_known, file) = dev.with(|s| {
        let saved = s.sync_blob("categories")?.unwrap_or_default();
        let doc = ydoc::write_categories(&saved, &s.category_rows()?)?;
        if doc != saved {
            s.set_sync_blob("categories", &doc)?;
        }
        Ok((doc, s.sync_blob("categories_remote")?.unwrap_or_default(), s.sync_value("categories_file")?))
    })?;
    if !ydoc::has_more_than(&doc, &remote_known)? {
        return Ok(());
    }
    let props = Props::from([(KIND.into(), CATEGORIES.into())]);
    let sent = upload_one(
        remote,
        &Upload { file, new: NewFile { name: "categories.ydoc".into(), props, description: None, mime: "application/octet-stream", bytes: &doc } },
    )?;
    dev.with(|s| adopt_categories_file(s, &sent, &doc))
}

// ---------- anexos que descem ----------

/// Fotos (e anexos pequenos) que outro aparelho subiu descem logo; os grandes, só quando alguém abre.
fn fetch_files(dev: &Device, remote: &mut dyn Remote, report: &mut Report) -> SResult<()> {
    let wanted: Vec<_> = dev.with(|s| s.missing_attachments())?.into_iter().filter(|(_, _, kind, bytes)| kind == "image" || *bytes <= EAGER_LIMIT).collect();
    // Miniaturas em paralelo, mas poucas (cada foto aberta ocupa dezenas de MB no celular).
    let cpus = std::thread::available_parallelism().map_or(2, |n| n.get().min(4));
    for batch in wanted.chunks(BATCH) {
        let ids: Vec<String> = batch.iter().map(|(_, file, _, _)| file.clone()).collect();
        let got: Vec<_> = batch.iter().zip(remote.download_many(&ids)).collect();
        let data = dev.data;
        let saved = par_map(&got, cpus, |((hash, _, kind, _), bytes)| match bytes {
            Ok(bytes) => save_fetched(data, hash, kind == "image", bytes),
            Err(e) => Err(e.clone()),
        });
        for ((hash, ..), res) in batch.iter().zip(saved) {
            match res {
                Ok(()) => {
                    dev.with(|s| s.set_attachment_local(hash))?;
                    report.files += 1;
                }
                // Sumiu do Drive ou veio corrompido: fica para depois, sem travar o resto.
                Err(SyncError::NotFound | SyncError::Other(_)) => {}
                Err(e) => return Err(e),
            }
        }
    }
    Ok(())
}

/// Baixa um anexo e confere o hash. Fotos ganham a miniatura aqui (a paleta e o tom já vieram junto).
pub(crate) fn fetch_attachment(dev: &Device, remote: &mut dyn Remote, hash: &str, file: &str) -> SResult<()> {
    let bytes = remote.download(file)?;
    let image = dev.with(|s| s.attachment_kind(hash))?.as_deref() == Some("image");
    save_fetched(dev.data, hash, image, &bytes)?;
    dev.with(|s| s.set_attachment_local(hash))
}

/// Grava o anexo que desceu (se o hash confere) e, se for foto, a miniatura.
fn save_fetched(data: &Path, hash: &str, image: bool, bytes: &[u8]) -> SResult<()> {
    if format!("{:x}", Sha256::digest(bytes)) != hash {
        return Err(SyncError::Other(format!("anexo {hash} veio diferente do esperado")));
    }
    attachments::store_file(data, hash, bytes)?;
    if image {
        if let Ok(thumb) = media::thumbnail(bytes) {
            attachments::store_thumb(data, hash, &thumb)?;
        }
    }
    Ok(())
}
