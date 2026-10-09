//! Anexos locais (Fase 1): o arquivo entra como veio, endereçado pelo hash do conteúdo, em `<dados>/attachments/<hash>`.
//! O pipeline das fotos (EXIF, WebP, miniatura, paleta e tom) chega na Fase 3 (SPEC §7).
//! A UI mostra e toca os anexos pelo protocolo `att` (`convertFileSrc(hash, 'att')`), com suporte a trechos (Range)
//! para o vídeo e o áudio poderem avançar e voltar.

use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use tauri::http::{header, Request, Response, StatusCode};

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

/// Guarda o arquivo (uma vez por conteúdo) e registra o anexo. Devolve o anexo como ficou no banco.
pub fn import(store: &Store, data: &Path, bytes: &[u8], name: &str, mime: &str) -> Result<Attachment, String> {
    let hash = format!("{:x}", Sha256::digest(bytes));
    let dir = dir(data);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(&hash);
    if !path.exists() {
        // grava ao lado e renomeia: um arquivo pela metade nunca fica com o nome final
        let tmp = dir.join(format!("{hash}.part"));
        std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    }
    let kind = kind_of(mime, name);
    let (width, height) = match (kind, imagesize::blob_size(bytes)) {
        ("image", Ok(s)) => (Some(s.width as i64), Some(s.height as i64)),
        _ => (None, None),
    };
    let mime = if mime.is_empty() { "application/octet-stream" } else { mime };
    store.insert_attachment(&Attachment {
        hash: hash.clone(),
        kind: kind.into(),
        mime: mime.into(),
        name: name.into(),
        bytes: bytes.len() as i64,
        orig_bytes: None,
        width,
        height,
        palette: None,
        tone: None,
        added_at: now(),
    })?;
    store.get_attachments(&[hash])?.pop().ok_or_else(|| "anexo não gravado".into())
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
pub fn serve(store: &Store, data: &Path, req: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let hash: String = req.uri().path().trim_start_matches('/').chars().filter(|c| c.is_ascii_hexdigit()).collect();
    let not_found = || status_only(StatusCode::NOT_FOUND);
    if hash.is_empty() {
        return not_found();
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
