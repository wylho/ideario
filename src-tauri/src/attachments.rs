//! Anexos locais (Fase 1): o arquivo entra como veio, endereçado pelo hash do conteúdo, em `<dados>/attachments/<hash>`.
//! O pipeline das fotos (EXIF, WebP, miniatura, paleta e tom) chega na Fase 3 (SPEC §7).
//! A UI mostra e toca os anexos pelo protocolo `att` (`convertFileSrc(hash, 'att')`), com suporte a trechos (Range)
//! para o vídeo e o áudio poderem avançar e voltar.

use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use tauri::http::{header, Request, Response, StatusCode};

use crate::media::{self, Quality};
use crate::store::{now, Attachment, Store};

pub fn dir(data: &Path) -> PathBuf {
    data.join("attachments")
}

/// Tipo do anexo pelo MIME e pela extensão (o mesmo critério do mock).
pub fn kind_of(mime: &str, name: &str) -> &'static str {
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_lowercase()).unwrap_or_default();
    let has = |words: &[&str]| words.iter().any(|w| mime.contains(w));
    if mime.starts_with("image/") {
        "image"
    } else if mime.starts_with("video/") {
        "video"
    } else if mime.starts_with("audio/") {
        "audio"
    } else if mime == "application/pdf" || ext == "pdf" {
        "pdf"
    } else if has(&["sheet", "excel", "csv"]) || ["xls", "xlsx", "ods", "csv"].contains(&ext.as_str()) {
        "sheet"
    } else if has(&["word", "document", "text", "rtf"]) || ["doc", "docx", "odt", "txt", "md", "rtf"].contains(&ext.as_str()) {
        "doc"
    } else {
        "other"
    }
}

/// Tipo MIME pela extensão, para arquivos que chegam pelo caminho (arrastados do sistema).
pub fn mime_of(name: &str) -> &'static str {
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_lowercase()).unwrap_or_default();
    match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "heic" => "image/heic",
        "heif" => "image/heif",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "tif" | "tiff" => "image/tiff",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "wav" => "audio/wav",
        "ogg" | "oga" | "opus" => "audio/ogg",
        "flac" => "audio/flac",
        "pdf" => "application/pdf",
        "zip" => "application/zip",
        "txt" => "text/plain",
        "md" => "text/markdown",
        "csv" => "text/csv",
        "json" => "application/json",
        "html" | "htm" => "text/html",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ppt" => "application/vnd.ms-powerpoint",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "odt" => "application/vnd.oasis.opendocument.text",
        "ods" => "application/vnd.oasis.opendocument.spreadsheet",
        "rtf" => "application/rtf",
        _ => "application/octet-stream",
    }
}

/// Anexo pronto para gravar: já passou pelo pipeline (fotos) e tem o hash do conteúdo final.
pub struct Prepared {
    pub bytes: Vec<u8>,
    pub thumb: Option<Vec<u8>>,
    pub att: Attachment,
}

/// Trabalho pesado, sem tocar no banco (roda fora da trava e da thread da janela): fotos passam pelo pipeline
/// (SPEC §7); o resto fica exatamente como veio.
pub fn prepare(bytes: Vec<u8>, name: &str, mime: &str, quality: Quality) -> Prepared {
    let mime = if mime.is_empty() { mime_of(name) } else { mime };
    let kind = kind_of(mime, name);
    let orig_len = bytes.len() as i64;
    let processed = if kind == "image" { media::process(&bytes, mime, quality).ok() } else { None };
    let (bytes, thumb, att) = match processed {
        Some(p) => {
            let converted = p.mime != mime;
            let smaller = (p.bytes.len() as i64) < orig_len;
            // Virou WebP: o nome acompanha, para o arquivo baixado abrir no programa certo.
            let name = if converted { with_extension(name, "webp") } else { name.to_string() };
            let att = Attachment {
                hash: String::new(),
                kind: kind.into(),
                mime: p.mime,
                name,
                bytes: p.bytes.len() as i64,
                // Economia só quando houve: a interface soma `orig_bytes - bytes`.
                orig_bytes: (converted && smaller).then_some(orig_len),
                width: Some(p.width as i64),
                height: Some(p.height as i64),
                palette: Some(p.palette),
                tone: Some(p.tone.as_str().into()),
                added_at: now(),
            };
            (p.bytes, Some(p.thumb), att)
        }
        None => {
            // Não é foto, ou a foto não pôde ser lida (HEIC, SVG…): guarda como veio.
            let (width, height) = match (kind, imagesize::blob_size(&bytes)) {
                ("image", Ok(s)) => (Some(s.width as i64), Some(s.height as i64)),
                _ => (None, None),
            };
            let att = Attachment {
                hash: String::new(),
                kind: kind.into(),
                mime: mime.into(),
                name: name.into(),
                bytes: orig_len,
                orig_bytes: None,
                width,
                height,
                palette: None,
                tone: None,
                added_at: now(),
            };
            (bytes, None, att)
        }
    };
    let hash = format!("{:x}", Sha256::digest(&bytes));
    Prepared { bytes, thumb, att: Attachment { hash, ..att } }
}

fn with_extension(name: &str, ext: &str) -> String {
    match name.rsplit_once('.') {
        Some((stem, _)) if !stem.is_empty() => format!("{stem}.{ext}"),
        _ => format!("{name}.{ext}"),
    }
}

/// Grava o arquivo (uma vez por conteúdo) e a miniatura, e registra o anexo. Devolve o anexo como ficou no banco.
pub fn save(store: &Store, data: &Path, p: Prepared) -> Result<Attachment, String> {
    write_once(&dir(data).join(&p.att.hash), &p.bytes)?;
    if let Some(t) = &p.thumb {
        write_once(&thumb_path(data, &p.att.hash), t)?;
    }
    store.insert_attachment(&p.att)?;
    store.get_attachments(std::slice::from_ref(&p.att.hash))?.pop().ok_or_else(|| "anexo não gravado".into())
}

/// Grava ao lado e renomeia: um arquivo pela metade nunca fica com o nome final.
fn write_once(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("part");
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

pub fn thumb_path(data: &Path, hash: &str) -> PathBuf {
    data.join("thumbs").join(format!("{hash}.webp"))
}

/// Importa de uma vez (pipeline + gravação), com a qualidade das configurações.
#[cfg(test)]
pub fn import(store: &Store, data: &Path, bytes: &[u8], name: &str, mime: &str) -> Result<Attachment, String> {
    let p = prepare(bytes.to_vec(), name, mime, quality(store));
    save(store, data, p)
}

/// Qualidade das fotos escolhida nas Configurações.
pub fn quality(store: &Store) -> Quality {
    let s = store.get_settings().unwrap_or_default();
    Quality::from_setting(s.get("photoQuality").and_then(|v| v.as_str()).unwrap_or("balanced"))
}

/// Copia o anexo para a pasta Downloads, sem sobrescrever nada ("nome (1).pdf"). Devolve o caminho salvo.
pub fn save_copy(data: &Path, downloads: &Path, hash: &str, name: &str) -> Result<PathBuf, String> {
    let src = dir(data).join(hash);
    let safe: String = name.chars().map(|c| if "/\\:*?\"<>|".contains(c) { '_' } else { c }).collect();
    let safe = if safe.trim().is_empty() { hash.to_string() } else { safe };
    let (stem, ext) = match safe.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
        _ => (safe.clone(), String::new()),
    };
    let mut dest = downloads.join(&safe);
    let mut i = 1;
    while dest.exists() {
        dest = downloads.join(format!("{stem} ({i}){ext}"));
        i += 1;
    }
    std::fs::create_dir_all(downloads).map_err(|e| e.to_string())?;
    std::fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    Ok(dest)
}

/// Responde a `att://localhost/<hash>` com o arquivo, inteiro ou só o trecho pedido (Range).
/// `?thumb` pede a miniatura (WebP); sem miniatura (não é foto, ou ainda não gerada), vai o arquivo.
pub fn serve(store: &Store, data: &Path, req: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let hash: String = req.uri().path().trim_start_matches('/').chars().filter(|c| c.is_ascii_hexdigit()).collect();
    let not_found = || status_only(StatusCode::NOT_FOUND);
    if hash.is_empty() {
        return not_found();
    }
    if req.uri().query() == Some("thumb") {
        if let Ok(bytes) = std::fs::read(thumb_path(data, &hash)) {
            return Response::builder()
                .header(header::CONTENT_TYPE, "image/webp")
                .header(header::CACHE_CONTROL, "max-age=31536000, immutable")
                .body(bytes)
                .unwrap_or_else(|_| status_only(StatusCode::INTERNAL_SERVER_ERROR));
        }
    }
    let Ok(bytes) = std::fs::read(dir(data).join(&hash)) else { return not_found() };
    // Tipo vindo do banco: se não servir de cabeçalho (caractere inválido), vai como binário genérico.
    let mime = store
        .attachment_mime(&hash)
        .ok()
        .flatten()
        .filter(|m| header::HeaderValue::from_str(m).is_ok())
        .unwrap_or_else(|| "application/octet-stream".into());
    let len = bytes.len();
    let range = req
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("bytes="))
        .and_then(|v| v.split(',').next())
        .and_then(|v| v.split_once('-'))
        .and_then(|(a, b)| {
            let start: usize = if a.is_empty() { len.saturating_sub(b.parse().ok()?) } else { a.parse().ok()? };
            let end: usize = if a.is_empty() || b.is_empty() { len.saturating_sub(1) } else { b.parse::<usize>().ok()?.min(len.saturating_sub(1)) };
            (start <= end && start < len).then_some((start, end))
        });
    let base = Response::builder()
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CACHE_CONTROL, "max-age=31536000, immutable");
    let res = match range {
        Some((start, end)) => base
            .status(StatusCode::PARTIAL_CONTENT)
            .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}"))
            .body(bytes[start..=end].to_vec()),
        None => base.status(StatusCode::OK).body(bytes),
    };
    res.unwrap_or_else(|_| status_only(StatusCode::INTERNAL_SERVER_ERROR))
}

/// Resposta vazia só com o código (não falha: sem cabeçalhos a montar).
pub fn status_only(code: StatusCode) -> Response<Vec<u8>> {
    let mut res = Response::new(Vec::new());
    *res.status_mut() = code;
    res
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds() {
        assert_eq!(kind_of("image/png", "a.png"), "image");
        assert_eq!(kind_of("", "Contrato.PDF"), "pdf");
        assert_eq!(kind_of("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "x.xlsx"), "sheet");
        assert_eq!(kind_of("", "notas.md"), "doc");
        assert_eq!(kind_of("application/zip", "a.zip"), "other");
        assert_eq!(kind_of(mime_of("Foto.JPG"), "Foto.JPG"), "image");
        assert_eq!(kind_of(mime_of("aula.m4a"), "aula.m4a"), "audio");
    }

    #[test]
    fn photos_go_through_the_pipeline_and_serve_a_thumbnail() {
        let tmp = std::env::temp_dir().join(format!("ideario-test-{}", uuid::Uuid::now_v7()));
        let store = Store::memory();
        let jpg = crate::media::tests::camera_jpeg(2400, 1800, 1);
        let a = import(&store, &tmp, &jpg, "IMG_0042.JPG", "image/jpeg").unwrap();
        assert_eq!((a.mime.as_str(), a.name.as_str()), ("image/webp", "IMG_0042.webp"));
        assert_eq!((a.width, a.height), (Some(2048), Some(1536)), "Equilibrada: lado maior 2048");
        assert_eq!(a.orig_bytes, Some(jpg.len() as i64));
        assert!(a.bytes < jpg.len() as i64);
        assert_eq!(a.palette.as_ref().map(Vec::len), Some(5));
        assert!(a.tone.is_some());
        let get = |q: &str| serve(&store, &tmp, &Request::builder().uri(format!("att://localhost/{}{q}", a.hash)).body(Vec::new()).unwrap());
        let thumb = get("?thumb");
        assert_eq!(thumb.headers()[header::CONTENT_TYPE], "image/webp");
        assert_eq!(image::load_from_memory(thumb.body()).unwrap().width(), 400);
        assert_eq!(get("").body().len() as i64, a.bytes);
        // Original: fica como veio, mas ganha miniatura e paleta.
        store.save_settings(&serde_json::json!({ "photoQuality": "original" })).unwrap();
        let b = import(&store, &tmp, &jpg, "IMG_0042.JPG", "image/jpeg").unwrap();
        assert_eq!((b.mime.as_str(), b.bytes, b.orig_bytes), ("image/jpeg", jpg.len() as i64, None));
        assert!(thumb_path(&tmp, &b.hash).exists());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn import_dedups_and_serves_ranges() {
        let tmp = std::env::temp_dir().join(format!("ideario-test-{}", uuid::Uuid::now_v7()));
        let store = Store::memory();
        let a = import(&store, &tmp, b"0123456789", "a.txt", "text/plain").unwrap();
        let b = import(&store, &tmp, b"0123456789", "b.txt", "text/plain").unwrap();
        assert_eq!(a.hash, b.hash);
        assert_eq!(a.kind, "doc");
        let req = Request::builder().uri(format!("att://localhost/{}", a.hash)).header("Range", "bytes=2-4").body(Vec::new()).unwrap();
        let res = serve(&store, &tmp, &req);
        assert_eq!(res.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(res.body(), b"234");
        let dl = save_copy(&tmp, &tmp.join("dl"), &a.hash, "a.txt").unwrap();
        // tipo gravado que não serve de cabeçalho não derruba o servidor
        store.conn.execute("UPDATE attachments SET mime = 'text/plain\nX: y' WHERE hash = ?1", [&a.hash]).unwrap();
        let req = Request::builder().uri(format!("att://localhost/{}", a.hash)).body(Vec::new()).unwrap();
        let res = serve(&store, &tmp, &req);
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(res.headers()[header::CONTENT_TYPE], "application/octet-stream");
        let dl2 = save_copy(&tmp, &tmp.join("dl"), &a.hash, "a.txt").unwrap();
        assert!(dl.ends_with("a.txt") && dl2.ends_with("a (1).txt"));
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
