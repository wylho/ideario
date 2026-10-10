//! O Google Drive de verdade (API v3, pasta oculta `appDataFolder`), por HTTP.
//! Erros viram `SyncError`: 401 renova o acesso e tenta uma vez de novo; 404 é `NotFound`; limite de uso e erro do
//! servidor esperam um pouco e tentam de novo; falha de rede é `Offline` (o ciclo tenta depois).

use std::collections::BTreeMap;
use std::io::Read;
use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};

use super::{Change, NewFile, Props, RemoteFile, Remote, SResult, SyncError};
use crate::store::Millis;

const FIELDS: &str = "id,version,modifiedTime,appProperties,description";
/// Acima disso o envio é "resumable" (o multipart do Drive aceita até 5 MB).
pub(crate) const MULTIPART_LIMIT: usize = 5 * 1024 * 1024;
const RETRIES: u32 = 4;

/// Quem fornece o token de acesso (o login Google; nos testes, um falso).
pub(crate) trait Tokens {
    /// Token válido; com `renew`, pede um novo mesmo que o atual não tenha vencido (o Drive recusou).
    fn access(&mut self, renew: bool) -> SResult<String>;
}

pub(crate) struct DriveApi<T: Tokens> {
    agent: ureq::Agent,
    base: String,
    tokens: T,
    multipart_limit: usize,
    /// Espera entre tentativas (curta nos testes).
    backoff: Duration,
}

pub(crate) fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(15)).timeout_read(Duration::from_secs(60)).build()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileJson {
    id: String,
    version: Option<String>,
    modified_time: Option<String>,
    app_properties: Option<BTreeMap<String, String>>,
    description: Option<String>,
    #[serde(default)]
    trashed: bool,
}

impl FileJson {
    fn into_remote(self) -> RemoteFile {
        let modified = self
            .modified_time
            .as_deref()
            .and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok())
            .map(|d| d.timestamp_millis() as Millis)
            .unwrap_or(0);
        RemoteFile {
            id: self.id,
            rev: self.version.unwrap_or_default(),
            modified,
            props: self.app_properties.unwrap_or_default(),
            description: self.description,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChangeJson {
    file_id: String,
    #[serde(default)]
    removed: bool,
    file: Option<FileJson>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChangesPage {
    next_page_token: Option<String>,
    new_start_page_token: Option<String>,
    #[serde(default)]
    changes: Vec<ChangeJson>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FilesPage {
    next_page_token: Option<String>,
    #[serde(default)]
    files: Vec<FileJson>,
}

/// Corpo de uma requisição (para poder repetir a tentativa).
enum Body<'a> {
    Empty,
    Json(Value),
    Bytes(&'a str, &'a [u8]),
}

fn other<E: std::fmt::Display>(e: E) -> SyncError {
    SyncError::Other(e.to_string())
}

fn read_all(r: ureq::Response) -> SResult<Vec<u8>> {
    let mut out = Vec::new();
    r.into_reader().read_to_end(&mut out).map_err(|e| SyncError::Offline(e.to_string()))?;
    Ok(out)
}

fn json_of<T: for<'de> Deserialize<'de>>(r: ureq::Response) -> SResult<T> {
    serde_json::from_slice(&read_all(r)?).map_err(other)
}

impl<T: Tokens> DriveApi<T> {
    pub fn new(tokens: T) -> Self {
        DriveApi { agent: agent(), base: "https://www.googleapis.com".into(), tokens, multipart_limit: MULTIPART_LIMIT, backoff: Duration::from_secs(1) }
    }

    #[cfg(test)]
    pub(crate) fn local(base: &str, tokens: T, multipart_limit: usize) -> Self {
        DriveApi { agent: agent(), base: base.into(), tokens, multipart_limit, backoff: Duration::from_millis(5) }
    }

    /// Faz a requisição com o token, renovando uma vez se o Drive recusar e esperando se pedir calma.
    fn send(&mut self, method: &str, url: &str, headers: &[(&str, String)], body: &Body) -> SResult<ureq::Response> {
        let mut renewed = false;
        let mut attempt = 0;
        loop {
            let token = self.tokens.access(renewed)?;
            let mut req = self.agent.request(method, url).set("Authorization", &format!("Bearer {token}"));
            for (k, v) in headers {
                req = req.set(k, v);
            }
            let res = match body {
                Body::Empty => req.call(),
                Body::Json(v) => req.send_json(v.clone()),
                Body::Bytes(mime, b) => req.set("Content-Type", mime).send_bytes(b),
            };
            match res {
                Ok(r) => return Ok(r),
                Err(ureq::Error::Status(401, _)) if !renewed => renewed = true,
                Err(ureq::Error::Status(401, _)) => return Err(SyncError::Unauthorized),
                Err(ureq::Error::Status(404, _)) => return Err(SyncError::NotFound),
                Err(ureq::Error::Status(code, r)) => {
                    let text = r.into_string().unwrap_or_default();
                    let calm_down = code == 429 || code >= 500 || (code == 403 && text.contains("ateLimitExceeded"));
                    if calm_down && attempt < RETRIES {
                        std::thread::sleep(self.backoff * 2u32.pow(attempt));
                        attempt += 1;
                        continue;
                    }
                    if text.contains("storageQuotaExceeded") {
                        return Err(SyncError::Other("o Google Drive está sem espaço".into()));
                    }
                    if calm_down {
                        return Err(SyncError::Offline(format!("o Drive respondeu {code}")));
                    }
                    return Err(SyncError::Other(format!("o Drive respondeu {code}: {}", text.chars().take(300).collect::<String>())));
                }
                Err(ureq::Error::Transport(t)) => return Err(SyncError::Offline(t.to_string())),
            }
        }
    }

    fn get(&mut self, url: &str) -> SResult<ureq::Response> {
        self.send("GET", url, &[], &Body::Empty)
    }

    /// Metadados + conteúdo numa requisição só (até 5 MB) ou em duas (sessão "resumable") acima disso.
    fn upload(&mut self, method: &str, id: Option<&str>, meta: Value, mime: &str, bytes: &[u8]) -> SResult<RemoteFile> {
        let path = id.map(|i| format!("/{i}")).unwrap_or_default();
        if bytes.len() <= self.multipart_limit {
            let boundary = format!("ideario-{}", uuid::Uuid::now_v7().simple());
            let body = multipart(&boundary, &meta, mime, bytes);
            let url = format!("{}/upload/drive/v3/files{path}?uploadType=multipart&fields={FIELDS}", self.base);
            let ct = format!("multipart/related; boundary={boundary}");
            let r = self.send(method, &url, &[], &Body::Bytes(&ct, &body))?;
            return Ok(json_of::<FileJson>(r)?.into_remote());
        }
        let url = format!("{}/upload/drive/v3/files{path}?uploadType=resumable&fields={FIELDS}", self.base);
        let headers = [("X-Upload-Content-Type", mime.to_string()), ("X-Upload-Content-Length", bytes.len().to_string())];
        let r = self.send(method, &url, &headers, &Body::Json(meta))?;
        let session = r.header("Location").ok_or_else(|| other("o Drive não abriu a sessão de envio"))?.to_string();
        let r = self.send("PUT", &session, &[], &Body::Bytes(mime, bytes))?;
        Ok(json_of::<FileJson>(r)?.into_remote())
    }
}

/// Corpo `multipart/related` do Drive: metadados em JSON e depois o conteúdo.
fn multipart(boundary: &str, meta: &Value, mime: &str, bytes: &[u8]) -> Vec<u8> {
    let mut body = format!("--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{meta}\r\n--{boundary}\r\nContent-Type: {mime}\r\n\r\n")
        .into_bytes();
    body.extend_from_slice(bytes);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    body
}

impl<T: Tokens> Remote for DriveApi<T> {
    fn start_token(&mut self) -> SResult<String> {
        let url = format!("{}/drive/v3/changes/startPageToken", self.base);
        let v: Value = json_of(self.get(&url)?)?;
        v["startPageToken"].as_str().map(str::to_string).ok_or_else(|| other("resposta sem startPageToken"))
    }

    fn list_all(&mut self) -> SResult<Vec<RemoteFile>> {
        let mut out = Vec::new();
        let mut page: Option<String> = None;
        loop {
            let mut url = format!("{}/drive/v3/files?spaces=appDataFolder&pageSize=1000&fields=nextPageToken,files({FIELDS})", self.base);
            if let Some(p) = &page {
                url.push_str(&format!("&pageToken={}", encode(p)));
            }
            let p: FilesPage = json_of(self.get(&url)?)?;
            out.extend(p.files.into_iter().filter(|f| !f.trashed).map(FileJson::into_remote));
            match p.next_page_token {
                Some(next) => page = Some(next),
                None => return Ok(out),
            }
        }
    }

    fn changes(&mut self, token: &str) -> SResult<(Vec<Change>, String)> {
        let mut out = Vec::new();
        let mut page = token.to_string();
        loop {
            let url = format!(
                "{}/drive/v3/changes?pageToken={}&spaces=appDataFolder&pageSize=1000&includeRemoved=true\
                 &fields=nextPageToken,newStartPageToken,changes(fileId,removed,file({FIELDS},trashed))",
                self.base,
                encode(&page)
            );
            let p: ChangesPage = json_of(self.get(&url)?)?;
            for c in p.changes {
                out.push(match c.file {
                    Some(f) if !c.removed && !f.trashed => Change::Upsert(f.into_remote()),
                    _ => Change::Removed(c.file_id),
                });
            }
            match (p.next_page_token, p.new_start_page_token) {
                (Some(next), _) => page = next,
                (None, Some(start)) => return Ok((out, start)),
                (None, None) => return Err(other("resposta de mudanças sem a próxima marca")),
            }
        }
    }

    fn download(&mut self, id: &str) -> SResult<Vec<u8>> {
        let url = format!("{}/drive/v3/files/{}?alt=media", self.base, encode(id));
        read_all(self.get(&url)?)
    }

    fn create(&mut self, file: &NewFile) -> SResult<RemoteFile> {
        let mut meta = json!({ "name": file.name, "parents": ["appDataFolder"], "appProperties": file.props, "mimeType": file.mime });
        if let Some(d) = &file.description {
            meta["description"] = Value::from(d.as_str());
        }
        self.upload("POST", None, meta, file.mime, file.bytes)
    }

    fn update(&mut self, id: &str, props: &Props, bytes: &[u8]) -> SResult<RemoteFile> {
        self.upload("PATCH", Some(&encode(id)), json!({ "appProperties": props }), "application/octet-stream", bytes)
    }

    fn delete(&mut self, id: &str) -> SResult<()> {
        let url = format!("{}/drive/v3/files/{}", self.base, encode(id));
        self.send("DELETE", &url, &[], &Body::Empty).map(|_| ())
    }
}

/// Codifica para a URL (ids e marcas do Drive são seguros, mas não custa).
fn encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    #[derive(Debug, Clone)]
    pub(crate) struct Req {
        pub method: String,
        pub path: String,
        pub headers: Vec<(String, String)>,
        pub body: Vec<u8>,
    }

    impl Req {
        pub fn header(&self, k: &str) -> Option<&str> {
            self.headers.iter().find(|(n, _)| n.eq_ignore_ascii_case(k)).map(|(_, v)| v.as_str())
        }
    }

    type Handler = dyn Fn(&Req) -> (u16, Vec<(String, String)>, Vec<u8>) + Send + Sync;

    /// Servidor HTTP mínimo (uma conexão por vez) que responde com `handler` e guarda as requisições.
    pub(crate) fn serve(handler: Box<Handler>) -> (String, Arc<Mutex<Vec<Req>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let log = Arc::new(Mutex::new(Vec::new()));
        let seen = log.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or(0) == 0 {
                    continue;
                }
                let mut parts = line.split_whitespace();
                let (method, path) = (parts.next().unwrap_or("").to_string(), parts.next().unwrap_or("").to_string());
                let mut headers = Vec::new();
                loop {
                    let mut h = String::new();
                    reader.read_line(&mut h).unwrap();
                    let h = h.trim_end();
                    if h.is_empty() {
                        break;
                    }
                    if let Some((k, v)) = h.split_once(':') {
                        headers.push((k.trim().to_string(), v.trim().to_string()));
                    }
                }
                let len = headers.iter().find(|(k, _)| k.eq_ignore_ascii_case("content-length")).and_then(|(_, v)| v.parse().ok()).unwrap_or(0);
                let mut body = vec![0; len];
                reader.read_exact(&mut body).unwrap();
                let req = Req { method, path, headers, body };
                let (code, extra, out) = handler(&req);
                seen.lock().unwrap().push(req);
                let mut head = format!("HTTP/1.1 {code} X\r\nContent-Length: {}\r\nConnection: close\r\n", out.len());
                for (k, v) in extra {
                    head.push_str(&format!("{k}: {v}\r\n"));
                }
                head.push_str("\r\n");
                let _ = stream.write_all(head.as_bytes());
                let _ = stream.write_all(&out);
            }
        });
        (base, log)
    }

    /// Tokens falsos: "t0", e "t1", "t2"… a cada renovação.
    #[derive(Default)]
    pub(crate) struct Fake(u32);

    impl Tokens for Fake {
        fn access(&mut self, renew: bool) -> SResult<String> {
            if renew {
                self.0 += 1;
            }
            Ok(format!("t{}", self.0))
        }
    }

    fn ok(v: Value) -> (u16, Vec<(String, String)>, Vec<u8>) {
        (200, vec![], v.to_string().into_bytes())
    }

    fn file_json(id: &str) -> Value {
        json!({"id": id, "version": "7", "modifiedTime": "2026-10-10T12:00:00.500Z", "appProperties": {"kind": "note", "noteId": "n1"}})
    }

    #[test]
    fn creates_with_multipart_in_the_hidden_folder() {
        let (base, log) = serve(Box::new(|_| ok(file_json("f1"))));
        let mut d = DriveApi::local(&base, Fake::default(), MULTIPART_LIMIT);
        let props = Props::from([("kind".to_string(), "note".to_string()), ("noteId".to_string(), "n1".to_string())]);
        let f = d
            .create(&NewFile { name: "note-n1.ydoc".into(), props, description: None, mime: "application/octet-stream", bytes: &[1, 2, 0, 255] })
            .unwrap();
        assert_eq!((f.id.as_str(), f.rev.as_str(), f.modified), ("f1", "7", 1_791_633_600_500));
        assert_eq!(f.props["noteId"], "n1");
        let req = log.lock().unwrap()[0].clone();
        assert_eq!(req.method, "POST");
        assert!(req.path.starts_with("/upload/drive/v3/files?uploadType=multipart"), "{}", req.path);
        assert_eq!(req.header("authorization"), Some("Bearer t0"));
        let ct = req.header("content-type").unwrap();
        let boundary = ct.strip_prefix("multipart/related; boundary=").unwrap().to_string();
        let body = req.body.clone();
        let text = String::from_utf8_lossy(&body);
        let meta: Value = serde_json::from_str(text.split("\r\n\r\n").nth(1).unwrap().split("\r\n--").next().unwrap()).unwrap();
        assert_eq!(meta["parents"], json!(["appDataFolder"]));
        assert_eq!(meta["appProperties"]["kind"], "note");
        // o conteúdo binário vai intacto entre as marcas
        let start = body.windows(4).rposition(|w| w == b"\r\n\r\n").unwrap() + 4;
        assert_eq!(&body[start..start + 4], &[1, 2, 0, 255]);
        assert!(body.ends_with(format!("\r\n--{boundary}--\r\n").as_bytes()));
    }

    #[test]
    fn big_files_use_a_resumable_session() {
        let (base, log) = {
            let base_cell = Arc::new(Mutex::new(String::new()));
            let b2 = base_cell.clone();
            let (base, log) = serve(Box::new(move |r: &Req| {
                if r.path.contains("uploadType=resumable") {
                    (200, vec![("Location".into(), format!("{}/session/1", b2.lock().unwrap()))], vec![])
                } else {
                    ok(file_json("big"))
                }
            }));
            *base_cell.lock().unwrap() = base.clone();
            (base, log)
        };
        let mut d = DriveApi::local(&base, Fake::default(), 8);
        let bytes = vec![7u8; 100];
        let f = d.create(&NewFile { name: "att-x".into(), props: Props::new(), description: Some("{}".into()), mime: "video/mp4", bytes: &bytes }).unwrap();
        assert_eq!(f.id, "big");
        let reqs = log.lock().unwrap().clone();
        assert_eq!(reqs.len(), 2);
        assert_eq!(reqs[0].header("x-upload-content-length"), Some("100"));
        assert_eq!(reqs[0].header("x-upload-content-type"), Some("video/mp4"));
        assert_eq!((reqs[1].method.as_str(), reqs[1].path.as_str()), ("PUT", "/session/1"));
        assert_eq!(reqs[1].body, bytes);
    }

    #[test]
    fn changes_follow_pages_and_report_removals() {
        let (base, log) = serve(Box::new(|r: &Req| {
            if r.path.contains("pageToken=p2") {
                ok(json!({"newStartPageToken": "p3", "changes": [{"fileId": "gone", "removed": true}]}))
            } else {
                ok(json!({"nextPageToken": "p2", "changes": [
                    {"fileId": "f1", "removed": false, "file": file_json("f1")},
                    {"fileId": "f2", "removed": false, "file": {"id": "f2", "trashed": true}}
                ]}))
            }
        }));
        let mut d = DriveApi::local(&base, Fake::default(), MULTIPART_LIMIT);
        let (changes, next) = d.changes("p1").unwrap();
        assert_eq!(next, "p3");
        let summary: Vec<String> = changes
            .iter()
            .map(|c| match c {
                Change::Upsert(f) => format!("+{}", f.id),
                Change::Removed(id) => format!("-{id}"),
            })
            .collect();
        assert_eq!(summary, ["+f1", "-f2", "-gone"]);
        assert!(log.lock().unwrap()[0].path.contains("spaces=appDataFolder"));
    }

    #[test]
    fn renews_the_token_once_and_maps_errors() {
        let (base, log) = serve(Box::new(|r: &Req| match (r.header("authorization"), r.path.as_str()) {
            (Some("Bearer t0"), _) => (401, vec![], vec![]),
            (_, p) if p.contains("missing") => (404, vec![], vec![]),
            (_, p) if p.contains("busy") => (503, vec![], vec![]),
            _ => (200, vec![], b"conteudo".to_vec()),
        }));
        let mut d = DriveApi::local(&base, Fake::default(), MULTIPART_LIMIT);
        assert_eq!(d.download("f1").unwrap(), b"conteudo");
        assert_eq!(log.lock().unwrap().len(), 2, "recusou com o token velho, tentou com o novo");
        assert_eq!(d.download("missing").unwrap_err(), SyncError::NotFound);
        assert!(matches!(d.download("busy").unwrap_err(), SyncError::Offline(_)));
        assert_eq!(log.lock().unwrap().len(), 3 + 1 + RETRIES as usize, "espera e tenta de novo antes de desistir");
        // sem servidor nenhum: sem conexão
        let mut nowhere = DriveApi::local("http://127.0.0.1:9", Fake::default(), MULTIPART_LIMIT);
        assert!(matches!(nowhere.download("x").unwrap_err(), SyncError::Offline(_)));
    }

    #[test]
    fn a_login_that_keeps_being_refused_is_unauthorized() {
        let (base, _) = serve(Box::new(|_| (401, vec![], vec![])));
        let mut d = DriveApi::local(&base, Fake::default(), MULTIPART_LIMIT);
        assert_eq!(d.start_token().unwrap_err(), SyncError::Unauthorized);
    }
}
