//! Login Google no desktop (SPEC §6): OAuth "loopback" com PKCE. O app abre o navegador na página de login do
//! Google, que volta para um endereço local (`http://127.0.0.1:<porta>`) com o código; o código vira o token de
//! acesso (dura uma hora) e o de renovação (fica guardado: no chaveiro do sistema no Mac e no Windows, num arquivo só
//! do usuário no Linux).
//!
//! Escopo `drive.appdata` (só a pasta oculta do app) mais o e-mail, para mostrar qual conta está conectada.
//! O id do cliente OAuth ("App para computador" no Google Cloud) entra na compilação: `IDEARIO_GOOGLE_CLIENT_ID` e
//! `IDEARIO_GOOGLE_CLIENT_SECRET` (num app instalado o "segredo" não é segredo; o PKCE é que protege o login).

use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use base64::engine::general_purpose::{URL_SAFE, URL_SAFE_NO_PAD};
use base64::Engine;
use rand::RngCore;
use serde::Deserialize;
use sha2::{Digest, Sha256};

use super::drive::Tokens;
use super::{SResult, SyncError};

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";
const SCOPE: &str = "https://www.googleapis.com/auth/drive.appdata openid email";

#[derive(Clone, Copy)]
pub(crate) struct Client {
    pub id: &'static str,
    pub secret: &'static str,
}

/// O cliente OAuth desta compilação (sem ele, o sync não aparece como opção).
pub(crate) fn client() -> Option<Client> {
    let id = option_env!("IDEARIO_GOOGLE_CLIENT_ID").filter(|s| !s.is_empty())?;
    Some(Client { id, secret: option_env!("IDEARIO_GOOGLE_CLIENT_SECRET").unwrap_or("") })
}

fn random_token(bytes: usize) -> String {
    let mut b = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut b);
    URL_SAFE_NO_PAD.encode(b)
}

/// `code_challenge` do PKCE (S256) para o `verifier`.
pub(crate) fn challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

fn url_encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn url_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < b.len() => {
                match u8::from_str_radix(std::str::from_utf8(&b[i + 1..i + 3]).unwrap_or("zz"), 16) {
                    Ok(v) => {
                        out.push(v);
                        i += 2;
                    }
                    Err(_) => out.push(b'%'),
                }
            }
            c => out.push(c),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Um login em andamento: a porta local que espera a volta do navegador e os segredos dele.
pub(crate) struct Pending {
    listener: TcpListener,
    verifier: String,
    state: String,
    pub url: String,
    redirect: String,
}

pub(crate) fn begin(client: Client) -> SResult<Pending> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| SyncError::Other(e.to_string()))?;
    let port = listener.local_addr().map_err(|e| SyncError::Other(e.to_string()))?.port();
    let redirect = format!("http://127.0.0.1:{port}");
    let verifier = random_token(48);
    let state = random_token(16);
    let url = format!(
        "{AUTH_URL}?client_id={}&redirect_uri={}&response_type=code&scope={}&code_challenge={}&code_challenge_method=S256\
         &state={state}&access_type=offline&prompt=consent",
        url_encode(client.id),
        url_encode(&redirect),
        url_encode(SCOPE),
        challenge(&verifier),
    );
    Ok(Pending { listener, verifier, state, url, redirect })
}

const DONE_PAGE: &str = "<!doctype html><meta charset=utf-8><title>Ideario</title>\
<body style=\"font-family:system-ui,sans-serif;display:grid;place-items:center;height:90vh;color:#333\">\
<div style=\"text-align:center\"><h2>Pronto!</h2><p>Pode fechar esta aba e voltar ao Ideario.</p></div>";

const FAIL_PAGE: &str = "<!doctype html><meta charset=utf-8><title>Ideario</title>\
<body style=\"font-family:system-ui,sans-serif;display:grid;place-items:center;height:90vh;color:#333\">\
<div style=\"text-align:center\"><h2>Não deu certo</h2><p>Volte ao Ideario e tente de novo.</p></div>";

impl Pending {
    /// Espera o navegador voltar com o código (até `timeout`, ou até `cancel`). Outras visitas à porta (ícone da
    /// aba…) são ignoradas.
    pub fn wait_for_code(&self, timeout: Duration, cancel: &AtomicBool) -> SResult<String> {
        let until = Instant::now() + timeout;
        self.listener.set_nonblocking(true).map_err(|e| SyncError::Other(e.to_string()))?;
        loop {
            let (mut stream, _) = match self.listener.accept() {
                Ok(s) => s,
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    if cancel.load(Ordering::Relaxed) {
                        return Err(SyncError::Other("login cancelado".into()));
                    }
                    if Instant::now() > until {
                        return Err(SyncError::Other("o login não foi concluído a tempo".into()));
                    }
                    std::thread::sleep(Duration::from_millis(100));
                    continue;
                }
                Err(e) => return Err(SyncError::Other(e.to_string())),
            };
            let _ = stream.set_nonblocking(false);
            let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
            let mut line = String::new();
            let _ = BufReader::new(&stream).read_line(&mut line);
            let target = line.split_whitespace().nth(1).unwrap_or("");
            let query = target.split_once('?').map(|(_, q)| q).unwrap_or("");
            let param = |k: &str| query.split('&').filter_map(|p| p.split_once('=')).find(|(n, _)| *n == k).map(|(_, v)| url_decode(v));
            let reply = |stream: &mut std::net::TcpStream, page: &str| {
                let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{page}", page.len());
            };
            if param("state").as_deref() != Some(self.state.as_str()) {
                // Não é a volta deste login.
                let _ = write!(stream, "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                continue;
            }
            if let Some(code) = param("code") {
                reply(&mut stream, DONE_PAGE);
                return Ok(code);
            }
            reply(&mut stream, FAIL_PAGE);
            return Err(match param("error").as_deref() {
                Some("access_denied") => SyncError::Other("o acesso ao Drive não foi permitido".into()),
                Some(e) => SyncError::Other(format!("o Google recusou o login ({e})")),
                None => SyncError::Other("o Google não devolveu o código".into()),
            });
        }
    }

    /// Troca o código pelos tokens.
    pub fn finish(&self, client: Client, code: &str) -> SResult<Grant> {
        let res = super::drive::agent().post(TOKEN_URL).send_form(&[
            ("code", code),
            ("client_id", client.id),
            ("client_secret", client.secret),
            ("code_verifier", &self.verifier),
            ("grant_type", "authorization_code"),
            ("redirect_uri", &self.redirect),
        ]);
        let g: TokenJson = token_response(res)?;
        let refresh = g.refresh_token.ok_or_else(|| SyncError::Other("o Google não devolveu o token de renovação".into()))?;
        let email = g.id_token.as_deref().and_then(email_of).unwrap_or_default();
        Ok(Grant { access: g.access_token, expires_in: g.expires_in, refresh, email })
    }
}

pub(crate) struct Grant {
    pub access: String,
    pub expires_in: u64,
    pub refresh: String,
    pub email: String,
}

#[derive(Deserialize)]
struct TokenJson {
    access_token: String,
    #[serde(default = "hour")]
    expires_in: u64,
    refresh_token: Option<String>,
    id_token: Option<String>,
}

fn hour() -> u64 {
    3600
}

fn token_response(res: Result<ureq::Response, ureq::Error>) -> SResult<TokenJson> {
    match res {
        Ok(r) => r.into_json().map_err(|e| SyncError::Other(e.to_string())),
        // Renovação recusada (revogada, senha trocada, 6 meses sem uso…): precisa entrar de novo.
        Err(ureq::Error::Status(400 | 401, _)) => Err(SyncError::Unauthorized),
        Err(ureq::Error::Status(code, _)) => Err(SyncError::Offline(format!("o Google respondeu {code}"))),
        Err(ureq::Error::Transport(t)) => Err(SyncError::Offline(t.to_string())),
    }
}

/// E-mail de dentro do `id_token` (JWT). Veio direto do Google pela conexão segura: não precisa conferir a assinatura
/// só para mostrar qual conta está conectada.
pub(crate) fn email_of(jwt: &str) -> Option<String> {
    let payload = jwt.split('.').nth(1)?;
    let bytes = URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).or_else(|_| URL_SAFE.decode(payload)).ok()?;
    let v: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    v["email"].as_str().map(str::to_string)
}

/// Login ativo: renova o acesso com o token de renovação quando precisa.
pub(crate) struct Session {
    client: Client,
    refresh: String,
    access: Option<(String, Instant)>,
}

impl Session {
    pub fn new(client: Client, refresh: String) -> Session {
        Session { client, refresh, access: None }
    }

    pub fn with_access(mut self, access: String, expires_in: u64) -> Session {
        self.access = Some((access, Instant::now() + Duration::from_secs(expires_in)));
        self
    }

    /// Desfaz o acesso no Google (ao sair). Sem rede, fica só o esquecimento local.
    pub fn revoke(&self) {
        let _ = super::drive::agent().post(REVOKE_URL).send_form(&[("token", self.refresh.as_str())]);
    }
}

impl Tokens for Session {
    fn access(&mut self, renew: bool) -> SResult<String> {
        if let Some((token, until)) = &self.access {
            // Com folga de um minuto para não vencer no meio de um envio.
            if !renew && Instant::now() + Duration::from_secs(60) < *until {
                return Ok(token.clone());
            }
        }
        let res = super::drive::agent().post(TOKEN_URL).send_form(&[
            ("client_id", self.client.id),
            ("client_secret", self.client.secret),
            ("refresh_token", &self.refresh),
            ("grant_type", "refresh_token"),
        ]);
        let g = token_response(res)?;
        self.access = Some((g.access_token.clone(), Instant::now() + Duration::from_secs(g.expires_in)));
        Ok(g.access_token)
    }
}

// ---------- onde o token de renovação fica ----------

#[cfg(any(target_os = "macos", windows))]
fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new("Ideario", "google-drive").map_err(|e| e.to_string())
}

#[cfg(any(target_os = "macos", windows))]
pub(crate) fn save_refresh(_data: &Path, token: &str) -> Result<(), String> {
    entry()?.set_password(token).map_err(|e| e.to_string())
}

#[cfg(any(target_os = "macos", windows))]
pub(crate) fn load_refresh(_data: &Path) -> Option<String> {
    entry().ok()?.get_password().ok()
}

#[cfg(any(target_os = "macos", windows))]
pub(crate) fn forget_refresh(_data: &Path) {
    if let Ok(e) = entry() {
        let _ = e.delete_credential();
    }
}

fn token_file(data: &Path) -> PathBuf {
    data.join("google-drive.token")
}

/// Linux (e o resto): arquivo legível só pelo usuário, na pasta de dados do app.
#[cfg(not(any(target_os = "macos", windows)))]
pub(crate) fn save_refresh(data: &Path, token: &str) -> Result<(), String> {
    let path = token_file(data);
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts.open(&path).map_err(|e| e.to_string())?;
    f.write_all(token.as_bytes()).map_err(|e| e.to_string())
}

#[cfg(not(any(target_os = "macos", windows)))]
pub(crate) fn load_refresh(data: &Path) -> Option<String> {
    std::fs::read_to_string(token_file(data)).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

#[cfg(not(any(target_os = "macos", windows)))]
pub(crate) fn forget_refresh(data: &Path) {
    let _ = std::fs::remove_file(token_file(data));
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::net::TcpStream;

    #[test]
    fn pkce_challenge_is_sha256_in_url_safe_base64() {
        // SHA-256 em base64 de URL, sem "=" (conferido com o hashlib do Python).
        assert_eq!(challenge("ideario-pkce-verifier-0123456789abcdefghijklmn"), "q8iH23Sat3KQWxi4K2ADe_lGcKF0kl55DlFfImEFou4");
    }

    #[test]
    fn email_comes_from_the_id_token() {
        let payload = URL_SAFE_NO_PAD.encode(r#"{"email":"ana@gmail.com","email_verified":true}"#);
        assert_eq!(email_of(&format!("xx.{payload}.yy")).as_deref(), Some("ana@gmail.com"));
        assert_eq!(email_of("lixo"), None);
    }

    fn visit(port: u16, path: &str) -> String {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(s, "GET {path} HTTP/1.1\r\nHost: x\r\n\r\n").unwrap();
        let mut out = String::new();
        let _ = s.read_to_string(&mut out);
        out
    }

    #[test]
    fn the_browser_comes_back_with_the_code() {
        let client = Client { id: "123.apps.googleusercontent.com", secret: "" };
        let p = begin(client).unwrap();
        assert!(p.url.starts_with(AUTH_URL));
        assert!(p.url.contains("code_challenge_method=S256"));
        assert!(p.url.contains("drive.appdata"));
        let port = p.listener.local_addr().unwrap().port();
        let state = p.state.clone();
        let browser = std::thread::spawn(move || {
            // o ícone da aba e uma volta de outro login não contam
            let other = visit(port, "/favicon.ico");
            let forged = visit(port, "/?code=falso&state=outro");
            let page = visit(port, &format!("/?state={state}&code=4%2F0Abc-d&scope=x"));
            (other, forged, page)
        });
        let code = p.wait_for_code(Duration::from_secs(10), &AtomicBool::new(false)).unwrap();
        let (other, forged, page) = browser.join().unwrap();
        assert_eq!(code, "4/0Abc-d");
        assert!(other.starts_with("HTTP/1.1 404") && forged.starts_with("HTTP/1.1 404"));
        assert!(page.contains("Pronto!"));
    }

    #[test]
    fn a_denied_login_is_an_error() {
        let p = begin(Client { id: "x", secret: "" }).unwrap();
        let port = p.listener.local_addr().unwrap().port();
        let state = p.state.clone();
        let browser = std::thread::spawn(move || visit(port, &format!("/?error=access_denied&state={state}")));
        let e = p.wait_for_code(Duration::from_secs(10), &AtomicBool::new(false)).unwrap_err();
        assert!(browser.join().unwrap().contains("Não deu certo"));
        assert_eq!(e, SyncError::Other("o acesso ao Drive não foi permitido".into()));
        assert!(p.wait_for_code(Duration::from_millis(200), &AtomicBool::new(false)).is_err(), "sem volta, desiste no prazo");
        assert_eq!(p.wait_for_code(Duration::from_secs(60), &AtomicBool::new(true)).unwrap_err(), SyncError::Other("login cancelado".into()));
    }

    #[test]
    fn decodes_query_values() {
        assert_eq!(url_decode("a%2Fb+c%20d"), "a/b c d");
        assert_eq!(url_decode("100%"), "100%");
        assert_eq!(url_encode("a b/é"), "a%20b%2F%C3%A9");
    }

    #[cfg(not(any(target_os = "macos", windows)))]
    #[test]
    fn the_refresh_token_file_is_private() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("ideario-auth-{}", uuid::Uuid::now_v7()));
        std::fs::create_dir_all(&dir).unwrap();
        save_refresh(&dir, "1//segredo").unwrap();
        assert_eq!(load_refresh(&dir).as_deref(), Some("1//segredo"));
        assert_eq!(std::fs::metadata(token_file(&dir)).unwrap().permissions().mode() & 0o777, 0o600);
        forget_refresh(&dir);
        assert_eq!(load_refresh(&dir), None);
    }
}
