//! Projeção do corpo da nota (JSON do TipTap) nas colunas derivadas: texto para a busca, prévia estruturada do
//! card, capa, anexos e `#tags`. É o mesmo cálculo de `project()` em src/lib/api/mock — a UI nunca parseia o corpo.
//! Na Fase 2 o corpo passa a ser um Y.Doc; a projeção continua igual, lendo do Y.XmlFragment.

use serde::Serialize;
use serde_json::Value;

use crate::text::{clean, hash_tags};

// A prévia vai além do que cabe no card; o card corta na altura máxima e esmaece o fim.
const MAX_BLOCKS: usize = 24;
const MAX_TASKS: usize = 12;
const MAX_CHARS: usize = 1200;
const MAX_CODE_LINES: usize = 8;

/// Bloco da prévia do card, na ordem do documento (o mesmo formato de `PreviewBlock` em src/lib/types.ts).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Block {
    Heading { text: String },
    Text { text: String },
    Bullet { text: String, depth: u32 },
    Ordered { text: String, n: i64, depth: u32 },
    Task { text: String, done: bool, depth: u32 },
    #[serde(rename_all = "camelCase")]
    File { text: String, file_kind: String },
    Code { text: String },
    More { count: usize },
}

impl Block {
    fn text(&self) -> Option<&str> {
        match self {
            Block::Heading { text } | Block::Text { text } | Block::Bullet { text, .. } | Block::Ordered { text, .. } => Some(text),
            Block::Task { text, .. } | Block::File { text, .. } | Block::Code { text } => Some(text),
            Block::More { .. } => None,
        }
    }
}

#[derive(Debug, Default)]
pub struct Projection {
    /// Texto puro (busca e trecho).
    pub text: String,
    /// Todas as fotos do corpo, na ordem.
    pub images: Vec<String>,
    /// Capa: a primeira foto, ou a primeira linha de fotos lado a lado (até 4).
    pub cover: Vec<String>,
    /// Anexos que não são foto (vídeo, áudio, documentos), na ordem.
    pub files: Vec<String>,
    /// Todos os blocos de texto, na ordem.
    pub blocks: Vec<Block>,
    pub preview: Vec<Block>,
    pub hash_tags: Vec<String>,
}

/// `file` resolve um anexo pelo hash: (nome, tipo). Anexos desconhecidos ficam de fora da prévia.
pub fn project(body: &Value, file: &dyn Fn(&str) -> Option<(String, String)>) -> Projection {
    let mut p = Projection::default();
    if let Some(content) = body.get("content").and_then(Value::as_array) {
        for n in content {
            block(n, 0, &mut p, file);
        }
    }
    p.text = p.blocks.iter().filter_map(Block::text).collect::<Vec<_>>().join(" ").split_whitespace().collect::<Vec<_>>().join(" ");
    p.preview = preview_of(&p.blocks);
    p.hash_tags = hash_tags(&p.text);
    p
}

fn kind(n: &Value) -> &str {
    n.get("type").and_then(Value::as_str).unwrap_or("")
}

fn children(n: &Value) -> &[Value] {
    n.get("content").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[])
}

fn hash_attr(n: &Value) -> Option<String> {
    n.get("attrs").and_then(|a| a.get("hash")).and_then(Value::as_str).map(str::to_string)
}

fn inline(n: &Value) -> String {
    match kind(n) {
        "text" => n.get("text").and_then(Value::as_str).unwrap_or("").to_string(),
        "hardBreak" => "\n".into(),
        _ => children(n).iter().map(inline).collect(),
    }
}

fn list_items(list: &Value, depth: u32, p: &mut Projection, file: &dyn Fn(&str) -> Option<(String, String)>) {
    let start = list.get("attrs").and_then(|a| a.get("start")).and_then(Value::as_i64).unwrap_or(1);
    for (i, item) in children(list).iter().enumerate() {
        let parts = children(item);
        let text = parts.first().map(|f| clean(&inline(f))).unwrap_or_default();
        match kind(list) {
            "taskList" => {
                let done = item.get("attrs").and_then(|a| a.get("checked")).and_then(Value::as_bool).unwrap_or(false);
                p.blocks.push(Block::Task { text, done, depth });
            }
            "orderedList" if !text.is_empty() => p.blocks.push(Block::Ordered { text, n: start + i as i64, depth }),
            "bulletList" if !text.is_empty() => p.blocks.push(Block::Bullet { text, depth }),
            _ => {}
        }
        for rest in parts.iter().skip(1) {
            block(rest, depth + 1, p, file);
        }
    }
}

fn block(n: &Value, depth: u32, p: &mut Projection, file: &dyn Fn(&str) -> Option<(String, String)>) {
    match kind(n) {
        "paragraph" => {
            let text = clean(&inline(n));
            if !text.is_empty() {
                p.blocks.push(Block::Text { text });
            }
        }
        "heading" => {
            let text = clean(&inline(n));
            if !text.is_empty() {
                p.blocks.push(Block::Heading { text });
            }
        }
        "bulletList" | "orderedList" | "taskList" => list_items(n, depth, p, file),
        "codeBlock" => {
            let raw = inline(n);
            let text = raw.trim_end().lines().take(MAX_CODE_LINES).collect::<Vec<_>>().join("\n");
            if !text.trim().is_empty() {
                p.blocks.push(Block::Code { text });
            }
        }
        "noteImage" => {
            if let Some(h) = hash_attr(n) {
                if p.cover.is_empty() {
                    p.cover = vec![h.clone()];
                }
                p.images.push(h);
            }
        }
        "imageRow" => {
            let row: Vec<String> = children(n).iter().filter_map(hash_attr).collect();
            if p.cover.is_empty() {
                p.cover = row.iter().take(4).cloned().collect();
            }
            p.images.extend(row);
        }
        "noteFile" => {
            if let Some(h) = hash_attr(n) {
                if let Some((name, file_kind)) = file(&h) {
                    p.files.push(h);
                    p.blocks.push(Block::File { text: name, file_kind });
                }
            }
        }
        _ => {
            for c in children(n) {
                block(c, depth, p, file);
            }
        }
    }
}

/// Prévia do card, na ordem do documento, com limites folgados (o card corta pela altura).
fn preview_of(blocks: &[Block]) -> Vec<Block> {
    let mut out: Vec<Block> = Vec::new();
    let (mut tasks, mut chars, mut hidden) = (0usize, 0usize, 0usize);
    let mut after_last_task: Option<usize> = None;
    for b in blocks {
        let len = b.text().map(|t| t.chars().count()).unwrap_or(0);
        let full = out.len() >= MAX_BLOCKS || chars >= MAX_CHARS;
        if matches!(b, Block::Task { .. }) {
            if tasks >= MAX_TASKS || full {
                hidden += 1;
                continue;
            }
            tasks += 1;
            out.push(b.clone());
            after_last_task = Some(out.len());
        } else if !full {
            out.push(b.clone());
        }
        chars += len;
    }
    if hidden > 0 {
        out.insert(after_last_task.unwrap_or(out.len()), Block::More { count: hidden });
    }
    out
}

/// Título, ou a primeira linha do texto (sem código nem anexos); "Sem título" se não houver.
pub fn label(title: &str, p: &Projection) -> String {
    if !title.trim().is_empty() {
        return title.to_string();
    }
    p.blocks
        .iter()
        .find(|b| !matches!(b, Block::Code { .. } | Block::File { .. }) && b.text().is_some_and(|t| !t.is_empty()))
        .and_then(Block::text)
        .map(|t| t.lines().next().unwrap_or("").chars().take(90).collect())
        .unwrap_or_else(|| "Sem título".into())
}

/// Texto da nota para copiar, com a estrutura em texto simples (tópicos, tarefas).
pub fn plain_text(title: &str, p: &Projection) -> String {
    let mut lines: Vec<String> = Vec::new();
    if !title.is_empty() {
        lines.push(title.to_string());
    }
    for b in &p.blocks {
        let line = match b {
            Block::Task { text, done, depth } => format!("{}{} {text}", "  ".repeat(*depth as usize), if *done { '☑' } else { '☐' }),
            Block::Bullet { text, depth } => format!("{}• {text}", "  ".repeat(*depth as usize)),
            Block::Ordered { text, n, depth } => format!("{}{n}. {text}", "  ".repeat(*depth as usize)),
            other => other.text().unwrap_or("").to_string(),
        };
        if !line.is_empty() {
            lines.push(line);
        }
    }
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn none(_: &str) -> Option<(String, String)> {
        None
    }

    #[test]
    fn structured_preview_in_document_order() {
        let body = json!({"type":"doc","content":[
            {"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"Ingredientes"}]},
            {"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"farinha"}]}]}]},
            {"type":"taskList","content":[{"type":"taskItem","attrs":{"checked":true},"content":[{"type":"paragraph","content":[{"type":"text","text":"comprar #casa"}]}]}]},
            {"type":"paragraph","content":[{"type":"text","text":"  fim  "}]}
        ]});
        let p = project(&body, &none);
        assert_eq!(
            p.preview,
            vec![
                Block::Heading { text: "Ingredientes".into() },
                Block::Bullet { text: "farinha".into(), depth: 0 },
                Block::Task { text: "comprar #casa".into(), done: true, depth: 0 },
                Block::Text { text: "fim".into() },
            ]
        );
        assert_eq!(p.hash_tags, vec!["casa"]);
        assert_eq!(p.text, "Ingredientes farinha comprar #casa fim");
        assert_eq!(label("", &p), "Ingredientes");
    }

    #[test]
    fn cover_is_first_photo_or_first_row() {
        let img = |h: &str| json!({"type":"noteImage","attrs":{"hash":h}});
        let body = json!({"type":"doc","content":[{"type":"imageRow","content":[img("a"), img("b")]}, img("c")]});
        let p = project(&body, &none);
        assert_eq!(p.cover, vec!["a", "b"]);
        assert_eq!(p.images, vec!["a", "b", "c"]);
    }

    #[test]
    fn files_need_a_known_attachment_and_tasks_are_capped() {
        let file = |h: &str| (h == "pdf").then(|| ("Roteiro.pdf".to_string(), "pdf".to_string()));
        let tasks: Vec<Value> = (0..15)
            .map(|i| json!({"type":"taskItem","attrs":{"checked":false},"content":[{"type":"paragraph","content":[{"type":"text","text":format!("t{i}")}]}]}))
            .collect();
        let body = json!({"type":"doc","content":[
            {"type":"taskList","content":tasks},
            {"type":"noteFile","attrs":{"hash":"pdf"}},
            {"type":"noteFile","attrs":{"hash":"sumiu"}}
        ]});
        let p = project(&body, &file);
        assert_eq!(p.files, vec!["pdf"]);
        assert_eq!(p.preview.iter().filter(|b| matches!(b, Block::Task { .. })).count(), 12);
        assert_eq!(p.preview[12], Block::More { count: 3 });
        assert_eq!(p.preview.last(), Some(&Block::File { text: "Roteiro.pdf".into(), file_kind: "pdf".into() }));
        assert_eq!(serde_json::to_value(&p.preview[13]).unwrap(), json!({"kind":"file","text":"Roteiro.pdf","fileKind":"pdf"}));
    }
}
