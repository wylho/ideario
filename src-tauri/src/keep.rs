//! Importação do Google Keep (SPEC §3.9) pelo zip do Google Takeout: pasta `Keep/`, um JSON por nota mais as mídias.
//!
//! Campos conferidos numa exportação real (out/2026): `title`, `textContent`, `textContentHtml` (parágrafos, títulos,
//! negrito e itálico em `<span style>`), `listContent` (`text`, `textHtml`, `isChecked`), `labels` (`name`),
//! `attachments` (`filePath`, `mimetype`), `annotations` (links: `url`, `title`), `color`, `isPinned`, `isArchived`,
//! `isTrashed`, `createdTimestampUsec`, `userEditedTimestampUsec`.
//!
//! Aqui fica a parte pura: ler o zip e converter cada nota. Gravar (com as fotos pelo pipeline) é do comando.

use std::collections::HashMap;
use std::io::{Read, Seek};

use serde::Deserialize;
use serde_json::{json, Value};
use zip::ZipArchive;

use crate::store::Millis;
use crate::text::normalize_tag;

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct KeepNote {
    pub title: String,
    pub text_content: String,
    pub text_content_html: String,
    pub list_content: Vec<ListItem>,
    pub labels: Vec<Label>,
    pub attachments: Vec<KeepAttachment>,
    pub annotations: Vec<Annotation>,
    pub color: String,
    pub is_pinned: bool,
    pub is_archived: bool,
    pub is_trashed: bool,
    pub created_timestamp_usec: i64,
    pub user_edited_timestamp_usec: i64,
    /// Caminho do JSON no zip (identifica a nota entre importações).
    #[serde(skip)]
    pub path: String,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ListItem {
    pub text: String,
    pub text_html: String,
    pub is_checked: bool,
}

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
pub struct Label {
    pub name: String,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct KeepAttachment {
    pub file_path: String,
    pub mimetype: String,
}

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
pub struct Annotation {
    pub url: String,
    pub title: String,
}

/// O Takeout aberto: as notas já lidas e o zip, para buscar as mídias só quando forem usadas.
pub struct Takeout<R: Read + Seek> {
    pub notes: Vec<KeepNote>,
    archive: ZipArchive<R>,
    /// Caminho (já com o nome certo) → índice no zip.
    index: HashMap<String, usize>,
}

/// Nome da entrada no zip. Zips refeitos no Mac gravam o nome em UTF-8 sem avisar (sem a marca de UTF-8): lido como
/// CP437, "☎️ Senha" viraria "ΓÿÄ∩╕Å Senha". Se os bytes crus forem UTF-8 válido, valem eles.
fn entry_name(raw: &[u8], decoded: &str) -> String {
    std::str::from_utf8(raw).map(str::to_string).unwrap_or_else(|_| decoded.to_string())
}

/// Lixo do Finder: `__MACOSX/…`, `._arquivo`, `.DS_Store`.
fn is_junk(path: &str) -> bool {
    path.starts_with("__MACOSX/") || path.contains("/__MACOSX/") || path.rsplit('/').next().is_some_and(|f| f.starts_with("._") || f == ".DS_Store")
}

impl<R: Read + Seek> Takeout<R> {
    /// Abre o zip e lê as notas. `Ok(None)` = não é um Takeout do Keep.
    pub fn open(reader: R) -> Result<Option<Takeout<R>>, String> {
        let mut archive = ZipArchive::new(reader).map_err(|e| format!("zip ilegível: {e}"))?;
        let mut index = HashMap::new();
        for i in 0..archive.len() {
            let f = archive.by_index_raw(i).map_err(|e| e.to_string())?;
            let name = entry_name(f.name_raw(), f.name());
            if !f.is_dir() && !is_junk(&name) {
                index.insert(name, i);
            }
        }
        let mut notes = Vec::new();
        let mut paths: Vec<(&String, &usize)> = index.iter().filter(|(p, _)| in_keep_dir(p) && p.ends_with(".json")).collect();
        paths.sort();
        for (path, &i) in paths {
            let mut s = String::new();
            if archive.by_index(i).map_err(|e| e.to_string())?.read_to_string(&mut s).is_err() {
                continue;
            }
            // Só o que tem cara de nota do Keep (o Takeout pode trazer outros produtos e JSONs).
            let Ok(v) = serde_json::from_str::<Value>(&s) else { continue };
            if v.get("createdTimestampUsec").is_none() && v.get("userEditedTimestampUsec").is_none() {
                continue;
            }
            let Ok(mut note) = serde_json::from_value::<KeepNote>(v) else { continue };
            note.path = path.clone();
            notes.push(note);
        }
        if notes.is_empty() {
            return Ok(None);
        }
        Ok(Some(Takeout { notes, archive, index }))
    }

    /// Mídia de uma nota (`filePath` é relativo à pasta Keep da própria nota: um zip pode juntar várias partes do
    /// Takeout, cada uma com a sua). None = não está no zip (apagada, por exemplo).
    pub fn media(&mut self, note_path: &str, file_path: &str) -> Option<Vec<u8>> {
        let dir = note_path.rsplit_once('/').map(|(d, _)| format!("{d}/")).unwrap_or_default();
        let i = *self.index.get(&format!("{dir}{file_path}"))?;
        let mut out = Vec::new();
        self.archive.by_index(i).ok()?.read_to_end(&mut out).ok()?;
        Some(out)
    }
}

fn in_keep_dir(path: &str) -> bool {
    path.split('/').rev().nth(1) == Some("Keep")
}

// ---------- conversão de uma nota ----------

/// Id estável: importar o mesmo Takeout de novo reconhece as notas que já entraram.
pub fn note_id(n: &KeepNote) -> String {
    let key = format!("keep:{}:{}", n.created_timestamp_usec, n.path.rsplit('/').next().unwrap_or(&n.path));
    uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_URL, key.as_bytes()).to_string()
}

/// Cor do Keep → a mais próxima das cores de nota do Ideario.
pub fn color(keep: &str) -> &'static str {
    match keep {
        "RED" | "PINK" => "rose",
        "ORANGE" | "BROWN" => "sand",
        "YELLOW" => "butter",
        "GREEN" | "TEAL" => "sage",
        "BLUE" | "CERULEAN" => "sky",
        "PURPLE" => "lilac",
        _ => "none",
    }
}

pub fn created_ms(n: &KeepNote) -> Millis {
    n.created_timestamp_usec / 1000
}

pub fn edited_ms(n: &KeepNote) -> Millis {
    let e = n.user_edited_timestamp_usec / 1000;
    if e > 0 { e } else { created_ms(n) }
}

/// Primeiro marcador → categoria; os demais → tags (SPEC §3.9).
pub fn category_and_tags(n: &KeepNote) -> (Option<String>, Vec<String>) {
    let mut names = n.labels.iter().map(|l| l.name.trim()).filter(|l| !l.is_empty());
    let category = names.next().map(str::to_string);
    let mut tags: Vec<String> = names.map(normalize_tag).filter(|t| !t.is_empty()).collect();
    tags.dedup();
    (category, tags)
}

/// Corpo em JSON do TipTap: texto (com negrito, itálico e títulos) ou checklist, as fotos (`images`: hashes já
/// importados, na ordem), os outros anexos (`files`, ex.: áudio) e os links salvos.
pub fn body(n: &KeepNote, images: &[String], files: &[String]) -> Value {
    let mut content: Vec<Value> = Vec::new();
    if !n.text_content_html.trim().is_empty() {
        content.extend(html_blocks(&n.text_content_html));
    } else if !n.text_content.is_empty() {
        content.extend(n.text_content.split('\n').map(|l| paragraph(text_runs(l, Marks::default()))));
    }
    if !n.list_content.is_empty() {
        let items: Vec<Value> = n
            .list_content
            .iter()
            .map(|it| {
                let runs = if it.text_html.trim().is_empty() { text_runs(&it.text, Marks::default()) } else { inline_html(&it.text_html) };
                json!({ "type": "taskItem", "attrs": { "checked": it.is_checked }, "content": [paragraph(runs)] })
            })
            .collect();
        content.push(json!({ "type": "taskList", "content": items }));
    }
    for row in images.chunks(4) {
        let imgs: Vec<Value> = row.iter().map(|h| json!({ "type": "noteImage", "attrs": { "hash": h } })).collect();
        content.push(if imgs.len() == 1 { imgs.into_iter().next().unwrap_or_default() } else { json!({ "type": "imageRow", "content": imgs }) });
    }
    for h in files {
        content.push(json!({ "type": "noteFile", "attrs": { "hash": h } }));
    }
    for a in n.annotations.iter().filter(|a| !a.url.is_empty()) {
        // O editor não tem links clicáveis ainda: o endereço vai como texto, com o título antes.
        let line = if a.title.trim().is_empty() { a.url.clone() } else { format!("{} — {}", a.title.trim(), a.url) };
        content.push(paragraph(text_runs(&line, Marks::default())));
    }
    // Parágrafos vazios nas pontas não servem para nada.
    let empty = |v: &Value| v["type"] == "paragraph" && v.get("content").is_none();
    while content.last().is_some_and(empty) {
        content.pop();
    }
    while content.first().is_some_and(empty) {
        content.remove(0);
    }
    if content.is_empty() {
        content.push(json!({ "type": "paragraph" }));
    }
    json!({ "type": "doc", "content": content })
}

// ---------- HTML do Keep → blocos ----------

#[derive(Debug, Clone, Copy, Default, PartialEq)]
struct Marks {
    bold: bool,
    italic: bool,
}

fn paragraph(runs: Vec<Value>) -> Value {
    if runs.is_empty() {
        json!({ "type": "paragraph" })
    } else {
        json!({ "type": "paragraph", "content": runs })
    }
}

/// Texto com quebras de linha → trechos e `hardBreak`.
fn text_runs(s: &str, m: Marks) -> Vec<Value> {
    let mut out = Vec::new();
    for (i, line) in s.split('\n').enumerate() {
        if i > 0 {
            out.push(json!({ "type": "hardBreak" }));
        }
        if !line.is_empty() {
            out.push(run(line, m));
        }
    }
    out
}

fn run(text: &str, m: Marks) -> Value {
    let mut marks = Vec::new();
    if m.bold {
        marks.push(json!({ "type": "bold" }));
    }
    if m.italic {
        marks.push(json!({ "type": "italic" }));
    }
    if marks.is_empty() {
        json!({ "type": "text", "text": text })
    } else {
        json!({ "type": "text", "text": text, "marks": marks })
    }
}

enum Token {
    Open(String, String),
    Close(String),
    Text(String),
}

/// O HTML do Keep é simples (p, h1/h2, span com estilo, br): um leitor pequeno basta.
fn tokens(html: &str) -> Vec<Token> {
    let mut out = Vec::new();
    let mut rest = html;
    while !rest.is_empty() {
        if let Some(stripped) = rest.strip_prefix('<') {
            let Some(end) = stripped.find('>') else {
                out.push(Token::Text(decode_entities(rest)));
                break;
            };
            let tag = &stripped[..end];
            rest = &stripped[end + 1..];
            if let Some(name) = tag.strip_prefix('/') {
                out.push(Token::Close(name.trim().to_ascii_lowercase()));
            } else {
                let tag = tag.trim_end_matches('/');
                let (name, attrs) = tag.split_once(char::is_whitespace).unwrap_or((tag, ""));
                out.push(Token::Open(name.to_ascii_lowercase(), attrs.to_string()));
            }
        } else {
            let end = rest.find('<').unwrap_or(rest.len());
            out.push(Token::Text(decode_entities(&rest[..end])));
            rest = &rest[end..];
        }
    }
    out
}

fn decode_entities(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        let Some(end) = rest.find(';').filter(|&e| e <= 10) else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let ent = &rest[1..end];
        let ch = match ent {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" | "#39" => Some('\''),
            "nbsp" => Some('\u{a0}'),
            _ => ent
                .strip_prefix("#x")
                .and_then(|h| u32::from_str_radix(h, 16).ok())
                .or_else(|| ent.strip_prefix('#').and_then(|d| d.parse().ok()))
                .and_then(char::from_u32),
        };
        match ch {
            Some(c) => {
                out.push(c);
                rest = &rest[end + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// Marcas que um `<span style>` ou uma tag de formatação liga.
fn marks_of(tag: &str, attrs: &str, cur: Marks) -> Marks {
    let mut m = cur;
    match tag {
        "b" | "strong" => m.bold = true,
        "i" | "em" => m.italic = true,
        _ => {}
    }
    let style = attrs.to_ascii_lowercase().replace(' ', "");
    if let Some(w) = style.split("font-weight:").nth(1) {
        let w = w.split(';').next().unwrap_or("").trim_matches(|c| c == '"' || c == '\'');
        m.bold = w == "bold" || w.parse::<u32>().is_ok_and(|n| n >= 600);
    }
    if let Some(s) = style.split("font-style:").nth(1) {
        m.italic = s.split(';').next().map(|v| v.trim_matches(|c| c == '"' || c == '\'')) == Some("italic");
    }
    m
}

/// Trechos de texto de um pedaço de HTML (itens de lista), ignorando a estrutura de blocos.
fn inline_html(html: &str) -> Vec<Value> {
    let mut runs = Vec::new();
    let mut stack = vec![Marks::default()];
    let mut first_block = true;
    for t in tokens(html) {
        match t {
            Token::Open(tag, attrs) => {
                if matches!(tag.as_str(), "p" | "div" | "h1" | "h2" | "h3") {
                    if !first_block {
                        runs.push(json!({ "type": "hardBreak" }));
                    }
                    first_block = false;
                }
                if tag == "br" {
                    runs.push(json!({ "type": "hardBreak" }));
                    continue;
                }
                let cur = *stack.last().unwrap_or(&Marks::default());
                stack.push(marks_of(&tag, &attrs, cur));
            }
            Token::Close(_) => {
                if stack.len() > 1 {
                    stack.pop();
                }
            }
            Token::Text(s) => runs.extend(text_runs(&s, *stack.last().unwrap_or(&Marks::default()))),
        }
    }
    merge_runs(runs)
}

/// Blocos (parágrafos e títulos) do HTML do texto da nota.
fn html_blocks(html: &str) -> Vec<Value> {
    let mut blocks = Vec::new();
    let mut runs: Vec<Value> = Vec::new();
    let mut heading = false;
    let mut stack = vec![Marks::default()];
    let flush = |runs: &mut Vec<Value>, heading: bool, blocks: &mut Vec<Value>| {
        let content = merge_runs(std::mem::take(runs));
        blocks.push(if heading {
            json!({ "type": "heading", "attrs": { "level": 3 }, "content": content })
        } else {
            paragraph(content)
        });
    };
    for t in tokens(html) {
        match t {
            Token::Open(tag, attrs) => match tag.as_str() {
                "p" | "div" | "h1" | "h2" | "h3" | "li" => {
                    if !runs.is_empty() {
                        flush(&mut runs, heading, &mut blocks);
                    }
                    heading = tag.starts_with('h');
                    stack.truncate(1);
                    stack.push(marks_of(&tag, &attrs, Marks::default()));
                }
                "br" => runs.push(json!({ "type": "hardBreak" })),
                _ => {
                    let cur = *stack.last().unwrap_or(&Marks::default());
                    stack.push(marks_of(&tag, &attrs, cur));
                }
            },
            Token::Close(tag) => {
                if matches!(tag.as_str(), "p" | "div" | "h1" | "h2" | "h3" | "li") {
                    // Título vazio vira parágrafo vazio.
                    let is_heading = heading && !runs.is_empty();
                    flush(&mut runs, is_heading, &mut blocks);
                    heading = false;
                    stack.truncate(1);
                } else if stack.len() > 1 {
                    stack.pop();
                }
            }
            Token::Text(s) => runs.extend(text_runs(&s, *stack.last().unwrap_or(&Marks::default()))),
        }
    }
    if !runs.is_empty() {
        flush(&mut runs, heading, &mut blocks);
    }
    // Uma quebra de linha sozinha no fim do parágrafo (o Keep põe <br> em linha vazia) não conta.
    for b in &mut blocks {
        if let Some(c) = b.get_mut("content").and_then(Value::as_array_mut) {
            while c.last().is_some_and(|r| r["type"] == "hardBreak") {
                c.pop();
            }
            if c.is_empty() {
                b.as_object_mut().map(|o| o.remove("content"));
            }
        }
    }
    blocks
}

/// Junta trechos vizinhos com as mesmas marcas (como o editor faz).
fn merge_runs(runs: Vec<Value>) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    for r in runs {
        if let (Some(prev), Some(t)) = (out.last_mut(), r.get("text").and_then(Value::as_str)) {
            if prev.get("text").is_some() && prev.get("marks") == r.get("marks") {
                let joined = format!("{}{t}", prev["text"].as_str().unwrap_or(""));
                prev["text"] = Value::from(joined);
                continue;
            }
        }
        out.push(r);
    }
    out
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    use zip::write::SimpleFileOptions;

    /// Takeout inventado no formato real: notas variadas, lixo do Finder, uma foto presente e uma apagada.
    pub fn fake_takeout() -> Vec<u8> {
        let mut z = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let o = SimpleFileOptions::default();
        let mut put = |name: &str, data: &[u8]| {
            z.start_file(name, o).unwrap();
            z.write_all(data).unwrap();
        };
        put("Takeout/archive_browser.html", b"<html></html>");
        put(
            "Takeout/Keep/Mercado.json",
            json!({
                "title": "Mercado", "color": "YELLOW", "isPinned": true, "isArchived": false, "isTrashed": false,
                "createdTimestampUsec": 1_700_000_000_000_000i64, "userEditedTimestampUsec": 1_700_000_500_000_000i64,
                "listContent": [
                    {"text": "Arroz", "textHtml": "<p dir=\"ltr\"><span style=\"font-weight:400\">Arroz</span></p>", "isChecked": true},
                    {"text": "Café", "textHtml": "", "isChecked": false}
                ],
                "labels": [{"name": "Casa"}, {"name": "Compras Mensais"}]
            })
            .to_string()
            .as_bytes(),
        );
        put(
            "Takeout/Keep/☎️ Senha.json",
            json!({
                "title": "☎️ Senha", "color": "DEFAULT", "isPinned": false, "isArchived": true, "isTrashed": false,
                "createdTimestampUsec": 1_600_000_000_000_000i64, "userEditedTimestampUsec": 1_600_000_000_000_000i64,
                "textContent": "Ramal 2040\nfalar com a Ana",
                "textContentHtml": "<p dir=\"ltr\" style=\"line-height:1.38\"><span style=\"font-weight:700;font-style:normal\">Ramal</span><span style=\"font-weight:400\"> 2040 &amp; &lt;24h&gt;</span></p><p><span style=\"font-style:italic\">falar com a Ana</span><br></p><h2><span>Mais</span></h2>",
                "annotations": [{"url": "https://exemplo.com/a", "title": "Site", "description": "", "source": "WEBLINK"}]
            })
            .to_string()
            .as_bytes(),
        );
        put(
            "Takeout/Keep/Viagem.json",
            json!({
                "title": "Viagem", "color": "TEAL", "isPinned": false, "isArchived": false, "isTrashed": true,
                "createdTimestampUsec": 1_650_000_000_000_000i64, "userEditedTimestampUsec": 1_650_000_000_000_000i64,
                "textContent": "Fotos #praia",
                "attachments": [{"filePath": "foto1.jpg", "mimetype": "image/jpeg"}, {"filePath": "apagada.jpg", "mimetype": "image/jpeg"}]
            })
            .to_string()
            .as_bytes(),
        );
        put("Takeout/Keep/foto1.jpg", &crate::media::tests::camera_jpeg(300, 200, 1));
        put("Takeout/Keep/Mercado.html", b"<html></html>");
        put("__MACOSX/Takeout/Keep/._Mercado.json", b"\x00\x05\x16\x07lixo");
        put("Takeout/.DS_Store", b"lixo");
        z.finish().unwrap().into_inner()
    }

    fn open() -> Takeout<Cursor<Vec<u8>>> {
        Takeout::open(Cursor::new(fake_takeout())).unwrap().expect("é um Takeout do Keep")
    }

    fn note<'a>(t: &'a Takeout<Cursor<Vec<u8>>>, title: &str) -> &'a KeepNote {
        t.notes.iter().find(|n| n.title == title).unwrap()
    }

    #[test]
    fn reads_only_keep_notes_and_skips_finder_junk() {
        let t = open();
        let mut titles: Vec<&str> = t.notes.iter().map(|n| n.title.as_str()).collect();
        titles.sort();
        assert_eq!(titles, vec!["Mercado", "Viagem", "☎️ Senha"]);
    }

    #[test]
    fn a_zip_that_is_not_a_takeout_is_none() {
        let mut z = zip::ZipWriter::new(Cursor::new(Vec::new()));
        z.start_file("fotos/a.json", SimpleFileOptions::default()).unwrap();
        z.write_all(b"{\"nome\": 1}").unwrap();
        let bytes = z.finish().unwrap().into_inner();
        assert!(Takeout::open(Cursor::new(bytes)).unwrap().is_none());
        assert!(Takeout::open(Cursor::new(b"nao e zip".to_vec())).is_err());
    }

    #[test]
    fn names_zipped_on_a_mac_keep_their_accents_and_emoji() {
        let raw = "☎️ Senha.json".as_bytes();
        let cp437 = "ΓÿÄ∩╕Å Senha.json";
        assert_eq!(entry_name(raw, cp437), "☎️ Senha.json");
        assert_eq!(entry_name(&[0x82, 0x20], "é "), "é ", "bytes que não são UTF-8: vale o CP437");
    }

    #[test]
    fn checklist_labels_color_and_dates() {
        let t = open();
        let n = note(&t, "Mercado");
        assert_eq!(color(&n.color), "butter");
        assert!(n.is_pinned);
        assert_eq!(category_and_tags(n), (Some("Casa".to_string()), vec!["compras-mensais".to_string()]));
        assert_eq!(edited_ms(n), 1_700_000_500_000);
        assert_eq!(
            body(n, &[], &[]),
            json!({"type":"doc","content":[{"type":"taskList","content":[
                {"type":"taskItem","attrs":{"checked":true},"content":[{"type":"paragraph","content":[{"type":"text","text":"Arroz"}]}]},
                {"type":"taskItem","attrs":{"checked":false},"content":[{"type":"paragraph","content":[{"type":"text","text":"Café"}]}]}
            ]}]})
        );
    }

    #[test]
    fn rich_text_keeps_bold_italic_headings_entities_and_links() {
        let t = open();
        let n = note(&t, "☎️ Senha");
        assert!(n.is_archived);
        assert_eq!(
            body(n, &[], &[]),
            json!({"type":"doc","content":[
                {"type":"paragraph","content":[
                    {"type":"text","text":"Ramal","marks":[{"type":"bold"}]},
                    {"type":"text","text":" 2040 & <24h>"}
                ]},
                {"type":"paragraph","content":[{"type":"text","text":"falar com a Ana","marks":[{"type":"italic"}]}]},
                {"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"Mais"}]},
                {"type":"paragraph","content":[{"type":"text","text":"Site — https://exemplo.com/a"}]}
            ]})
        );
    }

    #[test]
    fn a_zip_with_two_takeout_parts_finds_each_note_media_in_its_own_folder() {
        let mut z = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let o = SimpleFileOptions::default();
        let note = |title: &str, file: &str| {
            json!({"title": title, "createdTimestampUsec": 1_700_000_000_000_000i64, "userEditedTimestampUsec": 1_700_000_000_000_000i64,
                   "textContent": "x", "attachments": [{"filePath": file, "mimetype": "image/jpeg"}]})
            .to_string()
        };
        for (name, data) in [
            ("Takeout/Keep/A.json", note("A", "a.jpg").into_bytes()),
            ("Takeout/Keep/a.jpg", b"foto A".to_vec()),
            ("Takeout 2/Keep/B.json", note("B", "b.jpg").into_bytes()),
            ("Takeout 2/Keep/b.jpg", b"foto B".to_vec()),
        ] {
            z.start_file(name, o).unwrap();
            z.write_all(&data).unwrap();
        }
        let bytes = z.finish().unwrap().into_inner();
        let mut t = Takeout::open(Cursor::new(bytes)).unwrap().unwrap();
        let wanted: Vec<(String, String)> = t.notes.iter().map(|n| (n.path.clone(), n.attachments[0].file_path.clone())).collect();
        assert_eq!(wanted.len(), 2);
        for (path, file) in wanted {
            assert!(t.media(&path, &file).is_some(), "{path} sem a mídia {file}");
        }
    }

    #[test]
    fn plain_text_photos_and_missing_media() {
        let mut t = open();
        let viagem = note(&t, "Viagem").path.clone();
        assert!(t.media(&viagem, "foto1.jpg").is_some());
        assert!(t.media(&viagem, "apagada.jpg").is_none(), "apagada do zip: a nota entra sem ela");
        let n = note(&t, "Viagem");
        assert!(n.is_trashed);
        assert_eq!(color(&n.color), "sage");
        let b = body(n, &["h1".into(), "h2".into()], &[]);
        assert_eq!(b["content"][0], json!({"type":"paragraph","content":[{"type":"text","text":"Fotos #praia"}]}));
        assert_eq!(b["content"][1]["type"], "imageRow");
        assert_eq!(body(n, &["h1".into()], &[])["content"][1], json!({"type":"noteImage","attrs":{"hash":"h1"}}));
    }

    #[test]
    fn ids_are_stable_between_imports() {
        let (a, b) = (open(), open());
        assert_eq!(note_id(note(&a, "Mercado")), note_id(note(&b, "Mercado")));
        assert_ne!(note_id(note(&a, "Mercado")), note_id(note(&a, "Viagem")));
    }

    #[test]
    fn empty_note_has_one_empty_paragraph() {
        assert_eq!(body(&KeepNote::default(), &[], &[]), json!({"type":"doc","content":[{"type":"paragraph"}]}));
    }
}

#[cfg(test)]
mod props {
    //! O leitor de HTML do Keep com entradas quaisquer: nunca quebra, e o texto e a formatação chegam inteiros.
    use super::*;
    use proptest::prelude::*;

    /// Texto que os blocos levam (quebras viram "\n").
    fn plain(blocks: &[Value]) -> String {
        blocks
            .iter()
            .flat_map(|b| b.get("content").and_then(Value::as_array).cloned().unwrap_or_default())
            .map(|r| if r["type"] == "hardBreak" { "\n".to_string() } else { r["text"].as_str().unwrap_or("").to_string() })
            .collect()
    }

    fn escape(s: &str) -> String {
        s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
    }

    proptest! {
        #[test]
        fn any_input_is_read_without_crashing(s in ".{0,300}", tagsoup in "[<>/&;#a-z0-9 \"'=:]{0,300}") {
            for input in [&s, &tagsoup] {
                let _ = html_blocks(input);
                let _ = inline_html(input);
                let _ = decode_entities(input);
            }
        }

        #[test]
        fn escaped_text_comes_back_as_it_was(t in "[^\n]{0,60}") {
            prop_assert_eq!(decode_entities(&escape(&t)), t);
        }

        #[test]
        fn text_and_bold_survive_any_formatting(parts in prop::collection::vec(("[a-zA-Zçãéõ0-9 <>&]{1,12}", 0..4u8), 1..8)) {
            let html: String = parts
                .iter()
                .map(|(t, k)| {
                    let t = escape(t);
                    match k {
                        0 => t,
                        1 => format!("<b>{t}</b>"),
                        2 => format!("<i>{t}</i>"),
                        _ => format!("<span style=\"font-weight:700;\">{t}</span>"),
                    }
                })
                .collect();
            let blocks = html_blocks(&format!("<p>{html}</p>"));
            let expected: String = parts.iter().map(|(t, _)| t.as_str()).collect();
            prop_assert_eq!(plain(&blocks), expected);
            // negrito exatamente onde havia <b> ou font-weight
            let bold: String = blocks[0]["content"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|r| r["marks"].as_array().is_some_and(|m| m.iter().any(|m| m["type"] == "bold")))
                .map(|r| r["text"].as_str().unwrap_or("").to_string())
                .collect();
            let want: String = parts.iter().filter(|(_, k)| *k == 1 || *k == 3).map(|(t, _)| t.as_str()).collect();
            prop_assert_eq!(bold, want);
        }
    }
}
