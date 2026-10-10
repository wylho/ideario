//! Corpo da nota ↔ Markdown, para o MCP (o Claude lê e escreve notas como texto).
//!
//! O que o editor tem e como fica aqui:
//! - parágrafo, `### título`, **negrito**, *itálico*, quebra de linha (uma linha nova dentro do parágrafo);
//! - listas com marcador, numeradas e checklist (`- [ ]`, `- [x]`), com subitens recuados em vários níveis;
//! - bloco de código (```);
//! - foto `![nome](ideario://att/<hash>)` (várias na mesma linha = fotos lado a lado) e anexo
//!   `[📎 nome](ideario://att/<hash>)`, sozinhos na linha;
//! - parágrafo vazio = `&nbsp;` (sem isso o Markdown perde as linhas em branco da nota).
//!
//! O que o editor não tem vira texto: link → "texto (endereço)", citação → parágrafos, riscado e `código` → texto.
//! Ida e volta (nota → Markdown → nota) devolve a mesma nota: é o que deixa o MCP editar um pedaço do texto sem
//! mexer no resto (ver os testes de propriedade).

use pulldown_cmark::{CodeBlockKind, Event, Options, Parser, Tag, TagEnd};
use serde_json::{json, Value};

/// Endereço dos anexos no Markdown: `ideario://att/<hash>`.
pub const ATT: &str = "ideario://att/";
const EMPTY_PARAGRAPH: &str = "&nbsp;";
const NBSP: &str = "\u{a0}";

// ---------- nota → Markdown ----------

/// `name` dá o nome do anexo pelo hash (para o texto da foto e do arquivo).
pub fn to_markdown(body: &Value, name: &dyn Fn(&str) -> Option<String>) -> String {
    blocks(children(body), name).into_iter().map(|(_, md)| md).collect::<Vec<_>>().join("\n\n")
}

/// Blocos em Markdown, cada um com o tipo. Duas listas seguidas do mesmo tipo virariam uma só: a segunda usa o
/// outro marcador (`*` em vez de `-`, `)` em vez de `.`).
fn blocks<'a>(nodes: &'a [Value], name: &dyn Fn(&str) -> Option<String>) -> Vec<(&'a str, String)> {
    let family = |k: &str| match k {
        "bulletList" | "taskList" => Some('-'),
        "orderedList" => Some('.'),
        _ => None,
    };
    let mut out = Vec::new();
    let mut prev: Option<(char, bool)> = None;
    for n in nodes {
        let fam = family(kind(n));
        let alt = match (fam, prev) {
            (Some(f), Some((p, alt))) if f == p => !alt,
            _ => false,
        };
        prev = fam.map(|f| (f, alt));
        out.push((kind(n), block(n, name, alt)));
    }
    out
}

fn children(node: &Value) -> &[Value] {
    node.get("content").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[])
}

fn kind(node: &Value) -> &str {
    node.get("type").and_then(Value::as_str).unwrap_or("")
}

fn block(node: &Value, name: &dyn Fn(&str) -> Option<String>, alt: bool) -> String {
    match kind(node) {
        "heading" => format!("### {}", inline(children(node), true)),
        "bulletList" | "orderedList" | "taskList" => list(node, name, alt),
        "codeBlock" => code(node),
        "noteImage" => image(node, name),
        "imageRow" => children(node).iter().map(|i| image(i, name)).collect::<Vec<_>>().join(" "),
        "noteFile" => {
            let hash = attr_str(node, "hash");
            format!("[📎 {}]({ATT}{hash})", esc_label(&name(hash).unwrap_or_else(|| "arquivo".into())))
        }
        "paragraph" if children(node).is_empty() => EMPTY_PARAGRAPH.into(),
        // parágrafo (e qualquer outro bloco de texto)
        _ => inline(children(node), false),
    }
}

fn attr_str<'a>(node: &'a Value, key: &str) -> &'a str {
    node.get("attrs").and_then(|a| a.get(key)).and_then(Value::as_str).unwrap_or("")
}

fn image(node: &Value, name: &dyn Fn(&str) -> Option<String>) -> String {
    let hash = attr_str(node, "hash");
    format!("![{}]({ATT}{hash})", esc_label(&name(hash).unwrap_or_else(|| "foto".into())))
}

fn code(node: &Value) -> String {
    let text: String = children(node).iter().filter_map(|t| t.get("text").and_then(Value::as_str)).collect();
    let lang = attr_str(node, "language");
    // A cerca é maior que qualquer sequência de crases do código.
    let longest = text.split(|c| c != '`').map(str::len).max().unwrap_or(0);
    let fence = "`".repeat(longest.max(2) + 1);
    if text.is_empty() {
        format!("{fence}{lang}\n{fence}")
    } else {
        format!("{fence}{lang}\n{text}\n{fence}")
    }
}

fn list(node: &Value, name: &dyn Fn(&str) -> Option<String>, alt: bool) -> String {
    let bullet = if alt { "*" } else { "-" };
    let delim = if alt { ")" } else { "." };
    let start = node.get("attrs").and_then(|a| a.get("start")).and_then(Value::as_i64).unwrap_or(1);
    let items: Vec<String> = children(node)
        .iter()
        .enumerate()
        .map(|(i, item)| {
            let marker = match kind(node) {
                "orderedList" => format!("{}{delim} ", start + i as i64),
                "taskList" => {
                    let done = item.get("attrs").and_then(|a| a.get("checked")).and_then(Value::as_bool).unwrap_or(false);
                    format!("{bullet} [{}] ", if done { "x" } else { " " })
                }
                _ => format!("{bullet} "),
            };
            // O conteúdo do item fica recuado até a coluna do texto do marcador (no checklist, a do "- ").
            let pad = if kind(node) == "taskList" { 2 } else { marker.len() };
            let mut parts: Vec<String> = Vec::new();
            let kids = children(item);
            for (j, (k, text)) in blocks(kids, name).into_iter().enumerate() {
                // Um segundo parágrafo no mesmo item precisa de linha em branco antes; listas e código, não. Lista
                // numerada que não começa no 1 também (senão continua o parágrafo de cima).
                let late_start = k == "orderedList" && kids[j].get("attrs").and_then(|a| a.get("start")).and_then(Value::as_i64).unwrap_or(1) != 1;
                if j > 0 && (k == "paragraph" || late_start) {
                    parts.push(String::new());
                }
                parts.push(text);
            }
            let body = if parts.is_empty() { String::new() } else { parts.join("\n") };
            let body = if body.is_empty() && kind(node) != "taskList" { EMPTY_PARAGRAPH.to_string() } else { body };
            format!("{}{}", marker, indent(&body, pad))
        })
        .collect();
    items.join("\n")
}

/// Recua as linhas depois da primeira (as linhas vazias ficam vazias).
fn indent(s: &str, n: usize) -> String {
    let pad = " ".repeat(n);
    s.split('\n')
        .enumerate()
        .map(|(i, l)| if i == 0 || l.is_empty() { l.to_string() } else { format!("{pad}{l}") })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Texto com negrito/itálico e quebras de linha. Espaços nas pontas de um trecho marcado ficam de fora das marcas
/// (`** a**` não seria negrito).
fn inline(nodes: &[Value], heading: bool) -> String {
    let mut out = String::new();
    let mut line_start = true;
    for n in nodes {
        match kind(n) {
            // título é uma linha só: a quebra fica como <br>
            "hardBreak" if heading => out.push_str("<br>"),
            "hardBreak" => {
                out.push('\n');
                line_start = true;
            }
            "text" => {
                let text = n.get("text").and_then(Value::as_str).unwrap_or("");
                let marks: Vec<&str> =
                    n.get("marks").and_then(Value::as_array).into_iter().flatten().filter_map(|m| m.get("type").and_then(Value::as_str)).collect();
                let delim = match (marks.contains(&"bold"), marks.contains(&"italic")) {
                    (true, true) => "***",
                    (true, false) => "**",
                    (false, true) => "*",
                    (false, false) => "",
                };
                // Linhas dentro do trecho (texto colado com "\n"): cada uma como quebra de linha.
                for (k, piece) in text.split('\n').enumerate() {
                    if k > 0 {
                        out.push('\n');
                        line_start = true;
                    }
                    let core = piece.trim_matches(' ');
                    if delim.is_empty() || core.is_empty() {
                        out.push_str(&esc(piece, line_start, heading));
                    } else {
                        let lead = &piece[..piece.len() - piece.trim_start_matches(' ').len()];
                        let trail = &piece[piece.trim_end_matches(' ').len()..];
                        out.push_str(&esc(lead, line_start, heading));
                        out.push_str(delim);
                        out.push_str(&esc(core, false, heading));
                        out.push_str(delim);
                        out.push_str(trail);
                    }
                    if !piece.is_empty() {
                        line_start = false;
                    }
                }
            }
            _ => {}
        }
    }
    out
}

/// Escapa o que o Markdown leria como formatação. No começo da linha, também o que abriria um bloco (título, lista,
/// citação…); num título, todo `#` (senão os do fim somem).
fn esc(text: &str, line_start: bool, heading: bool) -> String {
    let mut out = String::with_capacity(text.len());
    let chars: Vec<char> = text.chars().collect();
    let mut at_start = line_start;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if at_start && c == ' ' {
            // espaço no começo da linha some no Markdown: guarda como entidade
            out.push_str("&#32;");
            i += 1;
            continue;
        }
        let special = matches!(c, '\\' | '`' | '*' | '_' | '[' | ']' | '<' | '~')
            || (heading && c == '#')
            || (at_start && matches!(c, '#' | '-' | '+' | '>' | '=' | '|'))
            || (c == '&' && entity_at(&chars[i..]))
            || (c == '!' && chars.get(i + 1) == Some(&'['));
        if at_start && c.is_ascii_digit() {
            // "1." ou "1)" no começo da linha abre lista numerada
            let mut j = i;
            while j < chars.len() && chars[j].is_ascii_digit() {
                j += 1;
            }
            out.extend(&chars[i..j]);
            if matches!(chars.get(j), Some('.') | Some(')')) {
                out.push('\\');
                out.push(chars[j]);
                j += 1;
            }
            i = j;
            at_start = false;
            continue;
        }
        if special {
            out.push('\\');
        }
        out.push(c);
        at_start = false;
        i += 1;
    }
    out
}

/// `&nome;`, `&#123;` ou `&#x1F;` começando aqui (o Markdown trocaria pelo caractere).
fn entity_at(chars: &[char]) -> bool {
    let rest: String = chars.iter().skip(1).take(33).collect();
    let body = rest.split(';').next().unwrap_or("");
    rest.contains(';') && !body.is_empty() && body.chars().all(|c| c.is_ascii_alphanumeric() || c == '#')
}

fn esc_label(s: &str) -> String {
    s.chars()
        .flat_map(|c| if matches!(c, '[' | ']' | '\\' | '*' | '_' | '`' | '<') { vec!['\\', c] } else { vec![c] })
        .collect()
}

// ---------- Markdown → nota ----------

/// Bloco em construção.
enum Frame {
    Doc(Vec<Value>),
    Paragraph(Vec<Piece>),
    Heading(Vec<Piece>),
    List { ordered: Option<u64>, items: Vec<(Option<bool>, Vec<Value>)> },
    Item { task: Option<bool>, content: Vec<Value> },
    Code { lang: String, text: String },
    /// Link ou imagem: o texto de dentro e o endereço.
    Link { url: String, image: bool, inner: Vec<Piece> },
}

/// Pedaço de texto de um parágrafo.
#[derive(Clone)]
enum Piece {
    Text(String, Vec<&'static str>),
    Break,
    Image(String),
    File(String),
}

/// Lê Markdown e devolve o corpo no formato do editor (JSON do TipTap, forma canônica).
pub fn from_markdown(md: &str) -> Value {
    let mut stack: Vec<Frame> = vec![Frame::Doc(Vec::new())];
    let mut marks: Vec<&'static str> = Vec::new();
    for ev in Parser::new_ext(md, Options::ENABLE_TASKLISTS | Options::ENABLE_STRIKETHROUGH) {
        match ev {
            Event::Start(tag) => match tag {
                Tag::Paragraph => stack.push(Frame::Paragraph(Vec::new())),
                Tag::Heading { .. } => stack.push(Frame::Heading(Vec::new())),
                Tag::List(start) => {
                    close_implicit(&mut stack);
                    stack.push(Frame::List { ordered: start, items: Vec::new() })
                }
                Tag::Item => stack.push(Frame::Item { task: None, content: Vec::new() }),
                Tag::CodeBlock(k) => {
                    close_implicit(&mut stack);
                    let lang = match k {
                        CodeBlockKind::Fenced(info) => info.split_whitespace().next().unwrap_or("").to_string(),
                        CodeBlockKind::Indented => String::new(),
                    };
                    stack.push(Frame::Code { lang, text: String::new() })
                }
                Tag::Emphasis => marks.push("italic"),
                Tag::Strong => marks.push("bold"),
                Tag::Link { dest_url, .. } => {
                    open_inline(&mut stack);
                    stack.push(Frame::Link { url: dest_url.to_string(), image: false, inner: Vec::new() })
                }
                Tag::Image { dest_url, .. } => {
                    open_inline(&mut stack);
                    stack.push(Frame::Link { url: dest_url.to_string(), image: true, inner: Vec::new() })
                }
                // citação, tabela, HTML, riscado…: só o conteúdo
                _ => {}
            },
            Event::End(end) => match end {
                TagEnd::Paragraph => {
                    if let Some(Frame::Paragraph(p)) = pop_if(&mut stack, |f| matches!(f, Frame::Paragraph(_))) {
                        let blocks = paragraph_blocks(p);
                        push_blocks(&mut stack, blocks);
                    }
                }
                TagEnd::Heading(_) => {
                    if let Some(Frame::Heading(p)) = pop_if(&mut stack, |f| matches!(f, Frame::Heading(_))) {
                        let node = json!({"type": "heading", "attrs": {"level": 3}, "content": inline_nodes(&p)});
                        push_blocks(&mut stack, vec![node]);
                    }
                }
                TagEnd::Item => {
                    close_implicit(&mut stack);
                    if let Some(Frame::Item { task, content }) = pop_if(&mut stack, |f| matches!(f, Frame::Item { .. })) {
                        if let Some(Frame::List { items, .. }) = stack.last_mut() {
                            items.push((task, content));
                        }
                    }
                }
                TagEnd::List(_) => {
                    if let Some(Frame::List { ordered, items }) = pop_if(&mut stack, |f| matches!(f, Frame::List { .. })) {
                        let node = list_node(ordered, items);
                        push_blocks(&mut stack, vec![node]);
                    }
                }
                TagEnd::CodeBlock => {
                    if let Some(Frame::Code { lang, text }) = pop_if(&mut stack, |f| matches!(f, Frame::Code { .. })) {
                        let text = text.strip_suffix('\n').unwrap_or(&text).to_string();
                        let mut node = json!({"type": "codeBlock"});
                        if !lang.is_empty() {
                            node["attrs"] = json!({"language": lang});
                        }
                        if !text.is_empty() {
                            node["content"] = json!([{"type": "text", "text": text}]);
                        }
                        push_blocks(&mut stack, vec![node]);
                    }
                }
                TagEnd::Emphasis => remove_last(&mut marks, "italic"),
                TagEnd::Strong => remove_last(&mut marks, "bold"),
                TagEnd::Link | TagEnd::Image => {
                    if let Some(Frame::Link { url, image, inner }) = pop_if(&mut stack, |f| matches!(f, Frame::Link { .. })) {
                        let pieces = link_pieces(url, image, inner);
                        for p in pieces {
                            push_piece(&mut stack, p);
                        }
                    }
                }
                _ => {}
            },
            Event::Text(t) => {
                if let Some(Frame::Code { text, .. }) = stack.last_mut() {
                    text.push_str(&t);
                } else {
                    push_text(&mut stack, &t, &marks);
                }
            }
            Event::InlineHtml(t) if is_br(&t) => push_piece(&mut stack, Piece::Break),
            // `código` e HTML no meio do texto: o texto como está
            Event::Code(t) | Event::InlineHtml(t) | Event::InlineMath(t) | Event::DisplayMath(t) => push_text(&mut stack, &t, &marks),
            Event::Html(t) => {
                let t = t.trim_end_matches('\n').to_string();
                push_text(&mut stack, &t, &marks)
            }
            Event::SoftBreak | Event::HardBreak => push_piece(&mut stack, Piece::Break),
            Event::TaskListMarker(done) => {
                if let Some(Frame::Item { task, .. }) = find_item(&mut stack) {
                    *task = Some(done);
                }
            }
            _ => {}
        }
    }
    // Markdown malformado não deixa nada para trás: fecha o que ficou aberto.
    while stack.len() > 1 {
        close_implicit(&mut stack);
        if stack.len() > 1 {
            let top = stack.pop();
            let blocks = match top {
                Some(Frame::Paragraph(p)) => paragraph_blocks(p),
                Some(Frame::Heading(p)) => vec![json!({"type": "heading", "attrs": {"level": 3}, "content": inline_nodes(&p)})],
                Some(Frame::List { ordered, items }) => vec![list_node(ordered, items)],
                Some(Frame::Item { task, content }) => {
                    if let Some(Frame::List { items, .. }) = stack.last_mut() {
                        items.push((task, content));
                    }
                    vec![]
                }
                Some(Frame::Code { text, .. }) => vec![json!({"type": "codeBlock", "content": [{"type": "text", "text": text}]})],
                Some(Frame::Link { url, image, inner }) => {
                    for p in link_pieces(url, image, inner) {
                        push_piece(&mut stack, p);
                    }
                    vec![]
                }
                _ => vec![],
            };
            push_blocks(&mut stack, blocks);
        }
    }
    let content = match stack.pop() {
        Some(Frame::Doc(c)) if !c.is_empty() => c,
        _ => vec![json!({"type": "paragraph"})],
    };
    crate::ydoc::canon(&json!({"type": "doc", "content": content}))
}

fn is_br(html: &str) -> bool {
    let t: String = html.chars().filter(|c| !c.is_whitespace()).collect::<String>().to_ascii_lowercase();
    matches!(t.as_str(), "<br>" | "<br/>")
}

fn remove_last(marks: &mut Vec<&'static str>, m: &str) {
    if let Some(i) = marks.iter().rposition(|x| *x == m) {
        marks.remove(i);
    }
}

fn pop_if(stack: &mut Vec<Frame>, f: impl Fn(&Frame) -> bool) -> Option<Frame> {
    close_implicit_unless(stack, &f);
    if stack.last().is_some_and(&f) {
        stack.pop()
    } else {
        None
    }
}

/// Item de lista "apertada": o texto vem sem parágrafo. Abre um parágrafo implícito para ele.
fn open_inline(stack: &mut Vec<Frame>) {
    if matches!(stack.last(), Some(Frame::Item { .. }) | Some(Frame::Doc(_))) {
        stack.push(Frame::Paragraph(Vec::new()));
    }
}

/// Fecha o parágrafo implícito aberto por `open_inline` (antes de um bloco ou do fim do item).
fn close_implicit(stack: &mut Vec<Frame>) {
    close_implicit_unless(stack, &|_| false)
}

fn close_implicit_unless(stack: &mut Vec<Frame>, keep: &dyn Fn(&Frame) -> bool) {
    let implicit = stack.len() >= 2
        && matches!(stack.last(), Some(Frame::Paragraph(_)))
        && matches!(stack.get(stack.len() - 2), Some(Frame::Item { .. }) | Some(Frame::Doc(_)))
        && !stack.last().is_some_and(keep);
    if implicit {
        if let Some(Frame::Paragraph(p)) = stack.pop() {
            let blocks = paragraph_blocks(p);
            push_blocks(stack, blocks);
        }
    }
}

fn find_item(stack: &mut [Frame]) -> Option<&mut Frame> {
    stack.iter_mut().rev().find(|f| matches!(f, Frame::Item { .. }))
}

fn push_text(stack: &mut Vec<Frame>, t: &str, marks: &[&'static str]) {
    // Linhas dentro de um texto (HTML, código inline com quebra): quebras de linha.
    for (i, line) in t.split('\n').enumerate() {
        if i > 0 {
            push_piece(stack, Piece::Break);
        }
        if !line.is_empty() {
            push_piece(stack, Piece::Text(line.to_string(), marks.to_vec()));
        }
    }
}

fn push_piece(stack: &mut Vec<Frame>, p: Piece) {
    open_inline(stack);
    match stack.last_mut() {
        Some(Frame::Paragraph(v)) | Some(Frame::Heading(v)) | Some(Frame::Link { inner: v, .. }) => v.push(p),
        Some(Frame::Code { text, .. }) => {
            if let Piece::Text(t, _) = p {
                text.push_str(&t)
            }
        }
        _ => {}
    }
}

fn push_blocks(stack: &mut [Frame], blocks: Vec<Value>) {
    match stack.last_mut() {
        Some(Frame::Doc(c)) | Some(Frame::Item { content: c, .. }) => c.extend(blocks),
        // bloco dentro de algo que só leva texto (não acontece com Markdown bem formado): vira texto
        Some(Frame::Paragraph(v)) | Some(Frame::Heading(v)) => {
            for b in blocks {
                let text = plain(&b);
                if !text.is_empty() {
                    v.push(Piece::Text(text, vec![]));
                }
            }
        }
        _ => {}
    }
}

fn plain(node: &Value) -> String {
    match node.get("text").and_then(Value::as_str) {
        Some(t) => t.to_string(),
        None => children(node).iter().map(plain).collect::<Vec<_>>().join(" "),
    }
}

/// Link e imagem: anexo do Ideario vira foto/arquivo; o resto, texto ("texto (endereço)").
fn link_pieces(url: String, image: bool, inner: Vec<Piece>) -> Vec<Piece> {
    if let Some(hash) = url.strip_prefix(ATT) {
        let hash = hash.trim_end_matches('/').to_string();
        return vec![if image { Piece::Image(hash) } else { Piece::File(hash) }];
    }
    let label: String = inner.iter().filter_map(|p| if let Piece::Text(t, _) = p { Some(t.as_str()) } else { None }).collect();
    let mut out: Vec<Piece> = inner.into_iter().filter(|p| !matches!(p, Piece::Image(_) | Piece::File(_))).collect();
    if url.is_empty() || label == url || label.trim_start_matches("mailto:") == url.trim_start_matches("mailto:") {
        if out.is_empty() {
            out.push(Piece::Text(url, vec![]));
        }
    } else if out.is_empty() {
        out.push(Piece::Text(url, vec![]));
    } else {
        out.push(Piece::Text(format!(" ({url})"), vec![]));
    }
    out
}

/// Parágrafo → blocos: fotos e anexos sozinhos viram os blocos deles; texto com foto no meio se divide.
fn paragraph_blocks(pieces: Vec<Piece>) -> Vec<Value> {
    let mut out = Vec::new();
    let mut text: Vec<Piece> = Vec::new();
    let mut images: Vec<String> = Vec::new();
    let flush_text = |text: &mut Vec<Piece>, out: &mut Vec<Value>| {
        // quebras nas pontas (em volta de uma foto) não contam
        while matches!(text.last(), Some(Piece::Break)) {
            text.pop();
        }
        while matches!(text.first(), Some(Piece::Break)) {
            text.remove(0);
        }
        let blank = text.iter().all(|p| matches!(p, Piece::Text(t, _) if t.trim().is_empty()));
        if !text.is_empty() && !blank {
            out.push(json!({"type": "paragraph", "content": inline_nodes(text)}));
        }
        text.clear();
    };
    let flush_images = |images: &mut Vec<String>, out: &mut Vec<Value>| {
        for chunk in images.chunks(4) {
            let imgs: Vec<Value> = chunk.iter().map(|h| json!({"type": "noteImage", "attrs": {"hash": h}})).collect();
            out.push(if imgs.len() == 1 { imgs[0].clone() } else { json!({"type": "imageRow", "content": imgs}) });
        }
        images.clear();
    };
    let only_space = |pieces: &[Piece]| pieces.iter().all(|p| matches!(p, Piece::Break) || matches!(p, Piece::Text(t, _) if t.trim().is_empty()));
    // parágrafo vazio da nota
    if pieces.len() == 1 && matches!(&pieces[0], Piece::Text(t, _) if t == NBSP) {
        return vec![json!({"type": "paragraph"})];
    }
    for p in pieces {
        match p {
            Piece::Image(h) => {
                if !only_space(&text) {
                    flush_text(&mut text, &mut out);
                }
                text.clear();
                images.push(h);
            }
            Piece::File(h) => {
                flush_images(&mut images, &mut out);
                flush_text(&mut text, &mut out);
                out.push(json!({"type": "noteFile", "attrs": {"hash": h}}));
            }
            other => {
                // espaço entre fotos da mesma linha não quebra a linha de fotos
                let space = matches!(&other, Piece::Text(t, _) if t.trim().is_empty());
                if !(space && !images.is_empty()) {
                    flush_images(&mut images, &mut out);
                    text.push(other);
                }
            }
        }
    }
    flush_images(&mut images, &mut out);
    flush_text(&mut text, &mut out);
    if out.is_empty() {
        out.push(json!({"type": "paragraph"}));
    }
    out
}

fn inline_nodes(pieces: &[Piece]) -> Vec<Value> {
    let mut out = Vec::new();
    for p in pieces {
        match p {
            Piece::Text(t, marks) => {
                let t = t.replace(NBSP, " ");
                let mut node = json!({"type": "text", "text": t});
                let mut ms: Vec<&str> = marks.clone();
                ms.sort_unstable();
                ms.dedup();
                if !ms.is_empty() {
                    node["marks"] = Value::Array(ms.iter().map(|m| json!({"type": m})).collect());
                }
                out.push(node);
            }
            Piece::Break => out.push(json!({"type": "hardBreak"})),
            _ => {}
        }
    }
    out
}

fn list_node(ordered: Option<u64>, items: Vec<(Option<bool>, Vec<Value>)>) -> Value {
    // "- [ ]" sem texto não é lido como checklist pelo Markdown: é um item com o texto "[ ]".
    let items: Vec<(Option<bool>, Vec<Value>)> = items
        .into_iter()
        .map(|(done, content)| {
            let bare = match content.as_slice() {
                [p] if kind(p) == "paragraph" && children(p).iter().all(|t| kind(t) == "text") => {
                    match children(p).iter().filter_map(|t| t.get("text").and_then(Value::as_str)).collect::<String>().as_str() {
                        "[ ]" => Some(false),
                        "[x]" | "[X]" => Some(true),
                        _ => None,
                    }
                }
                _ => None,
            };
            match (done, bare) {
                (None, Some(d)) => (Some(d), vec![json!({"type": "paragraph"})]),
                other => (other.0, content),
            }
        })
        .collect();
    let task = items.iter().any(|(t, _)| t.is_some());
    let items: Vec<Value> = items
        .into_iter()
        .map(|(done, mut content)| {
            // o item começa sempre com um parágrafo (o editor exige)
            if content.first().map(kind) != Some("paragraph") {
                content.insert(0, json!({"type": "paragraph"}));
            }
            if task {
                json!({"type": "taskItem", "attrs": {"checked": done.unwrap_or(false)}, "content": content})
            } else {
                json!({"type": "listItem", "content": content})
            }
        })
        .collect();
    match (task, ordered) {
        (true, _) => json!({"type": "taskList", "content": items}),
        (false, Some(start)) => json!({"type": "orderedList", "attrs": {"start": start}, "content": items}),
        (false, None) => json!({"type": "bulletList", "content": items}),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(h: &str) -> Option<String> {
        Some(format!("arquivo-{}", &h[..4.min(h.len())]))
    }

    fn back(body: &Value) -> Value {
        from_markdown(&to_markdown(body, &names))
    }

    #[test]
    fn reads_what_people_write() {
        let md = "Mercado da semana\n\n### Hortifruti\n\n- [ ] Tomate\n- [x] Cebola\n  - [ ] Roxa\n\n1. um\n2. dois\n\n- solto\n\nlinha 1\nlinha 2";
        let doc = from_markdown(md);
        let c = doc["content"].as_array().unwrap();
        assert_eq!(c[0], json!({"type":"paragraph","content":[{"type":"text","text":"Mercado da semana"}]}));
        assert_eq!(c[1], json!({"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"Hortifruti"}]}));
        assert_eq!(c[2]["type"], "taskList");
        assert_eq!(c[2]["content"][1]["attrs"]["checked"], true);
        assert_eq!(c[2]["content"][1]["content"][1]["type"], "taskList", "subitem");
        assert_eq!(c[3], json!({"type":"orderedList","attrs":{"start":1},"content":[
            {"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"um"}]}]},
            {"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"dois"}]}]}]}));
        assert_eq!(c[4]["type"], "bulletList");
        assert_eq!(c[5], json!({"type":"paragraph","content":[{"type":"text","text":"linha 1"},{"type":"hardBreak"},{"type":"text","text":"linha 2"}]}));
    }

    #[test]
    fn photos_and_files_by_hash() {
        let md = "![praia](ideario://att/aaaa1111) ![sol](ideario://att/bbbb2222)\n\n![](ideario://att/cccc3333)\n\n[📎 contrato.pdf](ideario://att/dddd4444)";
        let doc = from_markdown(md);
        assert_eq!(doc["content"][0], json!({"type":"imageRow","content":[{"type":"noteImage","attrs":{"hash":"aaaa1111"}},{"type":"noteImage","attrs":{"hash":"bbbb2222"}}]}));
        assert_eq!(doc["content"][1], json!({"type":"noteImage","attrs":{"hash":"cccc3333"}}));
        assert_eq!(doc["content"][2], json!({"type":"noteFile","attrs":{"hash":"dddd4444"}}));
        assert_eq!(to_markdown(&doc, &names), "![arquivo-aaaa](ideario://att/aaaa1111) ![arquivo-bbbb](ideario://att/bbbb2222)\n\n![arquivo-cccc](ideario://att/cccc3333)\n\n[📎 arquivo-dddd](ideario://att/dddd4444)");
    }

    #[test]
    fn what_the_editor_lacks_becomes_text() {
        let doc = from_markdown("Veja [o site](https://ideario.app) e <https://x.y>\n\n> citação\n\n~~riscado~~ e `código`\n\n---\n\n# Grande");
        let c = doc["content"].as_array().unwrap();
        assert_eq!(c[0]["content"][0]["text"], "Veja o site (https://ideario.app) e https://x.y");
        assert_eq!(c[1]["content"][0]["text"], "citação");
        assert_eq!(c[2]["content"][0]["text"], "riscado e código");
        assert_eq!(c[3], json!({"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"Grande"}]}));
    }

    #[test]
    fn empty_lines_of_the_note_survive() {
        let doc = json!({"type":"doc","content":[
            {"type":"paragraph","content":[{"type":"text","text":"a"}]},{"type":"paragraph"},{"type":"paragraph"},
            {"type":"paragraph","content":[{"type":"text","text":"b"}]}]});
        assert_eq!(to_markdown(&doc, &names), "a\n\n&nbsp;\n\n&nbsp;\n\nb");
        assert_eq!(back(&doc), doc);
    }

    #[test]
    fn text_that_looks_like_markdown_stays_text() {
        for t in ["# não é título", "- nem lista", "1. nem número", "**nem negrito**", "a_b_c", "[x] colchete", "&amp; literal", "> nem citação", "`crase`", "<b>tag</b>", "fim #"] {
            let doc = json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":t}]}]});
            assert_eq!(back(&doc), doc, "{t:?} → {:?}", to_markdown(&doc, &names));
        }
    }

    #[test]
    fn nothing_is_an_empty_note() {
        assert_eq!(from_markdown(""), json!({"type":"doc","content":[{"type":"paragraph"}]}));
        assert_eq!(from_markdown("- [ ]"), json!({"type":"doc","content":[{"type":"taskList","content":[{"type":"taskItem","attrs":{"checked":false},"content":[{"type":"paragraph"}]}]}]}));
    }

    proptest::proptest! {
        #![proptest_config(proptest::prelude::ProptestConfig::with_cases(400))]
        #[test]
        fn note_to_markdown_and_back_is_the_same_note(doc in crate::testdoc::doc(true)) {
            let md = to_markdown(&doc, &names);
            proptest::prop_assert_eq!(from_markdown(&md), crate::ydoc::canon(&doc), "\n--- markdown ---\n{}\n---", md);
        }

        #[test]
        fn any_text_reads_without_panicking(md in "(?s).{0,300}") {
            let doc = from_markdown(&md);
            proptest::prop_assert_eq!(doc["type"].as_str(), Some("doc"));
            proptest::prop_assert!(!doc["content"].as_array().unwrap().is_empty());
        }
    }
}
