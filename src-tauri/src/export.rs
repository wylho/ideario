//! Exportar uma nota: Markdown ou HTML. Sem anexos, um arquivo só; com anexos, um `.zip` com o arquivo da nota e a
//! pasta `anexos/` (no HTML, áudio e vídeo tocam no navegador; no Markdown, viram link). O PDF sai pela impressão do
//! sistema, na interface ("Salvar como PDF").

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufReader, BufWriter, Write};
use std::path::Path;

use serde::Serialize;
use serde_json::Value;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use crate::commands::Core;
use crate::store::{Attachment, Result};
use crate::{attachments, markdown};

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExportReport {
    pub path: String,
    pub attachments: usize,
    /// Anexos que não estão neste computador (só no Drive) e ficaram de fora.
    pub missing: usize,
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Anexo como sai na exportação: onde fica (relativo ao arquivo da nota) e o que é.
struct Asset {
    href: String,
    att: Attachment,
}

fn safe(name: &str) -> String {
    let s: String = name.chars().map(|c| if "/\\:*?\"<>|\n\r\t".contains(c) { '_' } else { c }).collect();
    let s = s.trim().to_string();
    if s.is_empty() {
        "arquivo".into()
    } else {
        s
    }
}

/// Nome do arquivo da nota (o título, ou "Nota").
pub fn file_stem(title: &str) -> String {
    let t: String = safe(title).chars().take(80).collect();
    if title.trim().is_empty() {
        "Nota".into()
    } else {
        t
    }
}

fn hashes(node: &Value, out: &mut Vec<String>) {
    if matches!(node.get("type").and_then(Value::as_str), Some("noteImage") | Some("noteFile")) {
        if let Some(h) = node.get("attrs").and_then(|a| a.get("hash")).and_then(Value::as_str) {
            if !out.iter().any(|x| x == h) {
                out.push(h.to_string());
            }
        }
    }
    for c in node.get("content").and_then(Value::as_array).into_iter().flatten() {
        hashes(c, out);
    }
}

/// `anexos/<nome>` para cada anexo, sem repetir nomes.
fn assets(atts: Vec<Attachment>) -> HashMap<String, Asset> {
    let mut used: Vec<String> = Vec::new();
    let mut out = HashMap::new();
    for a in atts {
        let base = safe(&a.name);
        let (stem, ext) = match base.rsplit_once('.') {
            Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
            _ => (base.clone(), String::new()),
        };
        let mut name = base.clone();
        let mut i = 2;
        while used.contains(&name) {
            name = format!("{stem} ({i}){ext}");
            i += 1;
        }
        used.push(name.clone());
        out.insert(a.hash.clone(), Asset { href: format!("anexos/{name}"), att: a });
    }
    out
}

// ---------- HTML ----------

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// Espaços no endereço relativo (o navegador abre `anexos/minha foto.webp` só com `%20`).
fn href(s: &str) -> String {
    s.split('/').map(|p| p.replace('%', "%25").replace(' ', "%20").replace('#', "%23").replace('?', "%3F")).collect::<Vec<_>>().join("/")
}

fn kids(node: &Value) -> &[Value] {
    node.get("content").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[])
}

fn inline_html(nodes: &[Value]) -> String {
    let mut out = String::new();
    for n in nodes {
        match n.get("type").and_then(Value::as_str) {
            Some("hardBreak") => out.push_str("<br>"),
            Some("text") => {
                let mut t = esc(n.get("text").and_then(Value::as_str).unwrap_or(""));
                let marks: Vec<&str> = n.get("marks").and_then(Value::as_array).into_iter().flatten().filter_map(|m| m.get("type").and_then(Value::as_str)).collect();
                if marks.contains(&"italic") {
                    t = format!("<em>{t}</em>");
                }
                if marks.contains(&"bold") {
                    t = format!("<strong>{t}</strong>");
                }
                out.push_str(&t);
            }
            _ => {}
        }
    }
    out
}

fn fmt_bytes(b: i64) -> String {
    let b = b as f64;
    if b < 1024.0 * 1024.0 {
        format!("{:.0} KB", (b / 1024.0).max(1.0))
    } else {
        format!("{:.1} MB", b / 1024.0 / 1024.0).replace('.', ",")
    }
}

fn block_html(node: &Value, assets: &HashMap<String, Asset>) -> String {
    let attr = |k: &str| node.get("attrs").and_then(|a| a.get(k)).cloned().unwrap_or(Value::Null);
    let children = || kids(node).iter().map(|c| block_html(c, assets)).collect::<String>();
    match node.get("type").and_then(Value::as_str).unwrap_or("") {
        "paragraph" if kids(node).is_empty() => "<p><br></p>\n".into(),
        "paragraph" => format!("<p>{}</p>\n", inline_html(kids(node))),
        "heading" => format!("<h2>{}</h2>\n", inline_html(kids(node))),
        "bulletList" => format!("<ul>\n{}</ul>\n", children()),
        "orderedList" => {
            let start = attr("start").as_i64().unwrap_or(1);
            if start == 1 {
                format!("<ol>\n{}</ol>\n", children())
            } else {
                format!("<ol start=\"{start}\">\n{}</ol>\n", children())
            }
        }
        "listItem" => format!("<li>{}</li>\n", children()),
        "taskList" => format!("<ul class=\"tasks\">\n{}</ul>\n", children()),
        "taskItem" => {
            let done = attr("checked").as_bool().unwrap_or(false);
            format!(
                "<li class=\"task{}\"><input type=\"checkbox\" disabled{}><div>{}</div></li>\n",
                if done { " done" } else { "" },
                if done { " checked" } else { "" },
                children()
            )
        }
        "codeBlock" => {
            let text: String = kids(node).iter().filter_map(|t| t.get("text").and_then(Value::as_str)).collect();
            format!("<pre><code>{}</code></pre>\n", esc(&text))
        }
        "noteImage" => match attr("hash").as_str().and_then(|h| assets.get(h)) {
            Some(a) => format!("<figure><img src=\"{}\" alt=\"{}\"></figure>\n", href(&a.href), esc(&a.att.name)),
            None => String::new(),
        },
        "imageRow" => {
            let imgs: String = kids(node)
                .iter()
                .filter_map(|i| i.get("attrs").and_then(|a| a.get("hash")).and_then(Value::as_str).and_then(|h| assets.get(h)))
                .map(|a| format!("<img src=\"{}\" alt=\"{}\">", href(&a.href), esc(&a.att.name)))
                .collect();
            format!("<figure class=\"row\">{imgs}</figure>\n")
        }
        "linkCard" => {
            let url = attr("url").as_str().unwrap_or("").to_string();
            let text = |k: &str| attr(k).as_str().filter(|s| !s.is_empty()).map(str::to_string);
            let title = text("title").unwrap_or_else(|| url.clone());
            let img = text("image").filter(|i| i.starts_with("data:image/")).map(|i| format!("<img src=\"{}\" alt=\"\">", esc(&i))).unwrap_or_default();
            let desc = text("description").map(|d| format!("<span>{}</span>", esc(&d))).unwrap_or_default();
            let site = text("site").unwrap_or_default();
            format!(
                "<a class=\"link\" href=\"{}\">{img}<div><b>{}</b>{desc}<small>{}</small></div></a>\n",
                esc(&url),
                esc(&title),
                esc(&site)
            )
        }
        "noteFile" => match attr("hash").as_str().and_then(|h| assets.get(h)) {
            Some(a) => {
                let src = href(&a.href);
                let name = esc(&a.att.name);
                let meta = format!("{} · {}", kind_label(&a.att.kind), fmt_bytes(a.att.bytes));
                match a.att.kind.as_str() {
                    "audio" => format!("<figure class=\"file\"><figcaption><b>{name}</b> {meta}</figcaption><audio controls preload=\"metadata\" src=\"{src}\"></audio></figure>\n"),
                    "video" => format!("<figure class=\"file\"><video controls preload=\"metadata\" src=\"{src}\"></video><figcaption><b>{name}</b> {meta}</figcaption></figure>\n"),
                    _ => format!("<p class=\"file\"><a href=\"{src}\">📎 {name}</a> <span>{meta}</span></p>\n"),
                }
            }
            None => String::new(),
        },
        _ => children(),
    }
}

fn kind_label(kind: &str) -> &'static str {
    match kind {
        "audio" => "Áudio",
        "video" => "Vídeo",
        "pdf" => "PDF",
        "image" => "Imagem",
        "sheet" => "Planilha",
        "doc" => "Documento",
        _ => "Arquivo",
    }
}

const CSS: &str = "body{margin:0;background:#fff;color:#1f2328;font:17px/1.7 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif}\
main{max-width:720px;margin:0 auto;padding:48px 24px 64px}h1{font-size:2em;line-height:1.2;margin:0 0 .3em}\
.meta{color:#6b7280;font-size:14px;margin-bottom:2em}h2{font-size:1.35em;margin:1.4em 0 .4em}p{margin:.5em 0}\
img{max-width:100%;border-radius:12px;display:block}figure{margin:1em 0}figure.row{display:flex;gap:8px}figure.row img{flex:1;min-width:0;object-fit:cover}\
ul.tasks{list-style:none;padding-left:0}ul.tasks ul.tasks{padding-left:1.6em}li.task{display:flex;gap:.6em;align-items:flex-start}li.task input{margin-top:.45em}\
li.task.done>div>p{text-decoration:line-through;color:#6b7280}pre{background:#f3f4f6;padding:14px 16px;border-radius:10px;overflow:auto;font-size:14px}\
figure.file{border:1px solid #e5e7eb;border-radius:12px;padding:12px 14px}figure.file figcaption{font-size:14px;color:#6b7280;margin:4px 0}\
figure.file audio,figure.file video{width:100%}\
a.link{display:flex;gap:14px;align-items:center;border:1px solid #e5e7eb;border-radius:12px;padding:10px;margin:1em 0;color:inherit;text-decoration:none}\
a.link img{width:96px;height:72px;object-fit:cover;border-radius:8px;flex:none}a.link div{display:flex;flex-direction:column;min-width:0}\
a.link span{color:#6b7280;font-size:14px}a.link small{color:#6b7280;font-size:12px}p.file span{color:#6b7280;font-size:14px}a{color:#2563eb}\
@media (prefers-color-scheme:dark){body{background:#17191c;color:#e6e8eb}.meta,figure.file figcaption,p.file span,li.task.done>div>p{color:#9aa1a9}pre{background:#23262b}figure.file{border-color:#30343a}a{color:#7aa7ff}}";

/// A nota como uma página HTML (sozinha, sem nada de fora: abre em qualquer navegador).
fn html_page(title: &str, meta: &str, body: &Value, assets: &HashMap<String, Asset>) -> String {
    let content: String = kids(body).iter().map(|b| block_html(b, assets)).collect();
    let h1 = if title.trim().is_empty() { String::new() } else { format!("<h1>{}</h1>\n", esc(title)) };
    let meta = if meta.is_empty() { String::new() } else { format!("<div class=\"meta\">{}</div>\n", esc(meta)) };
    format!(
        "<!doctype html>\n<html lang=\"pt-BR\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n\
         <title>{}</title>\n<style>{CSS}</style>\n</head>\n<body>\n<main>\n{h1}{meta}{content}</main>\n</body>\n</html>\n",
        esc(if title.trim().is_empty() { "Nota" } else { title })
    )
}

// ---------- exportar ----------

/// Exporta a nota `id` em `format` ("md" ou "html") para `dest`. Se `dest` termina em `.zip`, o pacote leva os anexos;
/// senão, só o arquivo da nota (os anexos ficam como nome).
pub fn export_note(core: &Core, id: &str, format: &str, dest: &Path) -> Result<ExportReport> {
    if !matches!(format, "md" | "html") {
        return Err(format!("formato desconhecido: {format} (md ou html)"));
    }
    let (note, atts, meta) = core.with(|s| {
        let n = s.note_input(id)?.ok_or("nota não encontrada")?;
        let mut hs = Vec::new();
        hashes(&n.body, &mut hs);
        let atts = s.get_attachments(&hs)?;
        let mut parts: Vec<String> = Vec::new();
        if let Some(c) = n.category_id.as_ref().and_then(|c| s.list_categories().ok()?.into_iter().find(|x| &x.id == c)) {
            parts.push(c.name);
        }
        let mut tags = n.tags.clone();
        for t in crate::projection::project(&n.body, &|_| None).hash_tags {
            if !tags.contains(&t) {
                tags.push(t);
            }
        }
        if !tags.is_empty() {
            parts.push(tags.iter().map(|t| format!("#{t}")).collect::<Vec<_>>().join(" "));
        }
        Ok((n, atts, parts.join(" · ")))
    })?;
    let assets = assets(atts);
    let main = match format {
        "md" => {
            let names = |h: &str| assets.get(h).map(|a| a.att.name.clone());
            let mut md = markdown::to_markdown(&note.body, &names);
            for (hash, a) in &assets {
                md = md.replace(&format!("({}{hash})", markdown::ATT), &format!("(<{}>)", a.href));
            }
            let head = if note.title.trim().is_empty() { String::new() } else { format!("# {}\n\n", markdown::escape_line(&note.title)) };
            let meta = if meta.is_empty() { String::new() } else { format!("{meta}\n\n") };
            format!("{head}{meta}{md}\n")
        }
        _ => html_page(&note.title, &meta, &note.body, &assets),
    };
    let stem = file_stem(&note.title);
    let zipped = dest.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("zip"));
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(err)?;
    }
    if !zipped {
        std::fs::write(dest, main).map_err(err)?;
        return Ok(ExportReport { path: dest.display().to_string(), attachments: 0, missing: 0 });
    }
    let dir = attachments::dir(&core.data);
    let mut z = ZipWriter::new(BufWriter::new(File::create(dest).map_err(err)?));
    let deflate = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored).large_file(true);
    z.start_file(format!("{stem}.{format}"), deflate).map_err(err)?;
    z.write_all(main.as_bytes()).map_err(err)?;
    let (mut packed, mut missing) = (0, 0);
    let mut list: Vec<&Asset> = assets.values().collect();
    list.sort_by(|a, b| a.href.cmp(&b.href));
    for a in list {
        let src = dir.join(&a.att.hash);
        if !src.is_file() {
            missing += 1;
            continue;
        }
        z.start_file(&a.href, stored).map_err(err)?;
        std::io::copy(&mut BufReader::new(File::open(&src).map_err(err)?), &mut z).map_err(err)?;
        packed += 1;
    }
    z.finish().map_err(err)?.flush().map_err(err)?;
    Ok(ExportReport { path: dest.display().to_string(), attachments: packed, missing })
}

/// A nota tem anexos (a exportação vira um .zip)?
pub fn has_attachments(core: &Core, id: &str) -> Result<bool> {
    core.with(|s| {
        let n = s.note_input(id)?.ok_or("nota não encontrada")?;
        let mut hs = Vec::new();
        hashes(&n.body, &mut hs);
        Ok(!hs.is_empty())
    })
}

#[tauri::command]
pub async fn export_note_cmd(app: tauri::AppHandle, id: String, format: String, path: String) -> Result<ExportReport> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || export_note(&app.state::<Core>(), &id, &format, Path::new(&path))).await.map_err(err)?
}

/// Imprime a janela (a interface deixa só a nota à vista): "Salvar como PDF" fica na janela de impressão do sistema.
#[tauri::command]
pub fn print_window(window: tauri::WebviewWindow) -> Result<()> {
    window.print().map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::Read;

    fn core() -> (Core, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("ideario-export-{}", uuid::Uuid::now_v7()));
        (Core::open(dir.join("data")).unwrap(), dir)
    }

    fn with_media(c: &Core) -> (String, String, String) {
        let png = {
            let mut buf = std::io::Cursor::new(Vec::new());
            image::RgbImage::from_fn(16, 12, |x, _| image::Rgb([x as u8 * 10, 90, 200])).write_to(&mut buf, image::ImageFormat::Png).unwrap();
            buf.into_inner()
        };
        let img = c.with(|s| attachments::import(s, &c.data, &png, "minha praia.png", "image/png")).unwrap();
        let audio = c.with(|s| attachments::import(s, &c.data, b"ID3fake-audio", "aula 1.m4a", "audio/mp4")).unwrap();
        let id = "0199bbbb-0000-7000-8000-000000000001".to_string();
        let n = crate::store::NoteInput {
            id: id.clone(),
            title: "Viagem <SP>".into(),
            body: json!({"type":"doc","content":[
                {"type":"paragraph","content":[{"type":"text","text":"Roteiro "},{"type":"text","text":"bom","marks":[{"type":"bold"}]},{"type":"text","text":" #ferias"}]},
                {"type":"taskList","content":[{"type":"taskItem","attrs":{"checked":true},"content":[{"type":"paragraph","content":[{"type":"text","text":"Passagem"}]}]}]},
                {"type":"noteImage","attrs":{"hash": img.hash}},
                {"type":"noteFile","attrs":{"hash": audio.hash}}
            ]}),
            category_id: None,
            color: "none".into(),
            pinned: false,
            archived: false,
            trashed_at: None,
            reminder_at: None,
            reminder_done: false,
            reminder_repeat: None,
            tags: vec![],
        };
        c.with(|s| s.save_note(&n).map(|_| ())).unwrap();
        (id, img.hash, audio.hash)
    }

    fn zip_entry(path: &Path, name: &str) -> Option<Vec<u8>> {
        let mut z = zip::ZipArchive::new(File::open(path).unwrap()).unwrap();
        let mut f = z.by_name(name).ok()?;
        let mut buf = Vec::new();
        f.read_to_end(&mut buf).unwrap();
        Some(buf)
    }

    #[test]
    fn html_package_plays_audio_and_shows_photos() {
        let (c, dir) = core();
        let (id, _img, _audio) = with_media(&c);
        assert!(has_attachments(&c, &id).unwrap());
        let dest = dir.join("out").join("Viagem.zip");
        let r = export_note(&c, &id, "html", &dest).unwrap();
        assert_eq!((r.attachments, r.missing), (2, 0));
        let html = String::from_utf8(zip_entry(&dest, "Viagem _SP_.html").unwrap()).unwrap();
        assert!(html.contains("<h1>Viagem &lt;SP&gt;</h1>"), "título escapado");
        assert!(html.contains("<div class=\"meta\">#ferias</div>"));
        assert!(html.contains("Roteiro <strong>bom</strong>"));
        assert!(html.contains("<li class=\"task done\"><input type=\"checkbox\" disabled checked>"));
        assert!(html.contains("<img src=\"anexos/minha%20praia.webp\""), "{html}");
        assert!(html.contains("<audio controls preload=\"metadata\" src=\"anexos/aula%201.m4a\"></audio>"), "{html}");
        assert_eq!(zip_entry(&dest, "anexos/aula 1.m4a").unwrap(), b"ID3fake-audio");
        assert!(zip_entry(&dest, "anexos/minha praia.webp").is_some());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn markdown_package_links_the_files() {
        let (c, dir) = core();
        let (id, _, _) = with_media(&c);
        let dest = dir.join("Viagem.zip");
        export_note(&c, &id, "md", &dest).unwrap();
        let md = String::from_utf8(zip_entry(&dest, "Viagem _SP_.md").unwrap()).unwrap();
        assert!(md.starts_with("# Viagem \\<SP>\n\n#ferias\n\nRoteiro **bom** #ferias\n\n- [x] Passagem\n\n"), "{md}");
        assert!(md.contains("![minha praia.webp](<anexos/minha praia.webp>)"), "{md}");
        assert!(md.contains("[📎 aula 1.m4a](<anexos/aula 1.m4a>)"), "{md}");
        // sem zip: um arquivo só
        let single = dir.join("so.md");
        assert_eq!(export_note(&c, &id, "md", &single).unwrap().attachments, 0);
        assert!(std::fs::read_to_string(&single).unwrap().contains("Passagem"));
        assert!(export_note(&c, &id, "docx", &single).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn same_name_attachments_do_not_overwrite_each_other() {
        let mk = |hash: &str| Attachment {
            hash: hash.into(),
            kind: "doc".into(),
            mime: "text/plain".into(),
            name: "notas.txt".into(),
            bytes: 1,
            orig_bytes: None,
            width: None,
            height: None,
            palette: None,
            tone: None,
            added_at: 0,
        };
        let a = assets(vec![mk("a"), mk("b"), mk("c")]);
        let mut hrefs: Vec<&str> = a.values().map(|x| x.href.as_str()).collect();
        hrefs.sort();
        assert_eq!(hrefs, vec!["anexos/notas (2).txt", "anexos/notas (3).txt", "anexos/notas.txt"]);
    }
}
