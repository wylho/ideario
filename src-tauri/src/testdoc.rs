//! Documentos aleatórios no formato do editor (JSON do TipTap), para os testes de propriedade do corpo da nota
//! (troca mínima no Y.Doc, ida e volta pelo Markdown do MCP).

use proptest::prelude::*;
use serde_json::{json, Value};

/// Palavras com letras, acentos e emoji; com `nasty`, também os sinais que o Markdown usa.
fn word(nasty: bool) -> BoxedStrategy<String> {
    if nasty {
        prop_oneof![
            3 => "[a-zA-Z0-9çãéõ]{1,8}",
            1 => r"[*_#\[\]\\`<>!+.()&|~=-]{1,3}[a-z]{0,3}",
            1 => r"[a-z]{1,3}[*_#\[\]\\`<>!+.()&|~=-]{1,3}",
            1 => Just("🌎".to_string()),
            1 => Just("1.".to_string()),
            1 => Just("-".to_string()),
            1 => Just("&nbsp;".to_string()),
        ]
        .boxed()
    } else {
        "[a-zA-Zçã0-9]{1,8}".boxed()
    }
}

fn words(nasty: bool) -> BoxedStrategy<String> {
    prop::collection::vec(word(nasty), 1..5).prop_map(|w| w.join(" ")).boxed()
}

/// Conteúdo de um parágrafo: trechos com ou sem negrito/itálico/tachado/código, separados por espaço sem marca, e às
/// vezes uma quebra de linha.
fn inline(nasty: bool) -> BoxedStrategy<Vec<Value>> {
    let marks = (any::<bool>(), any::<bool>(), prop::bool::weighted(0.15), prop::bool::weighted(0.15));
    let run = (words(nasty), marks, prop::bool::weighted(0.1));
    prop::collection::vec(run, 1..4)
        .prop_map(|runs| {
            let mut out: Vec<Value> = Vec::new();
            for (i, (text, (bold, italic, strike, code), br)) in runs.into_iter().enumerate() {
                if i > 0 {
                    if br {
                        out.push(json!({"type": "hardBreak"}));
                    } else {
                        out.push(json!({"type": "text", "text": " "}));
                    }
                }
                let mut marks = Vec::new();
                if bold {
                    marks.push(json!({"type": "bold"}));
                }
                if italic {
                    marks.push(json!({"type": "italic"}));
                }
                if strike {
                    marks.push(json!({"type": "strike"}));
                }
                if code {
                    marks.push(json!({"type": "code"}));
                }
                let mut t = json!({"type": "text", "text": text});
                if !marks.is_empty() {
                    t["marks"] = Value::Array(marks);
                }
                out.push(t);
            }
            out
        })
        .boxed()
}

fn paragraph(nasty: bool) -> BoxedStrategy<Value> {
    inline(nasty).prop_map(|c| json!({"type": "paragraph", "content": c})).boxed()
}

fn hash() -> impl Strategy<Value = String> {
    "[0-9a-f]{16}"
}

/// Item de lista (`listItem` ou `taskItem`) com subitens até `depth` níveis.
fn item(kind: &'static str, depth: u32, nasty: bool) -> BoxedStrategy<Value> {
    let leaf = (paragraph(nasty), any::<bool>()).prop_map(move |(p, checked)| make_item(kind, p, checked, None));
    if depth == 0 {
        return leaf.boxed();
    }
    (paragraph(nasty), any::<bool>(), prop::option::weighted(0.4, list(kind, depth - 1, nasty)))
        .prop_map(move |(p, checked, sub)| make_item(kind, p, checked, sub))
        .boxed()
}

fn make_item(kind: &str, p: Value, checked: bool, sub: Option<Value>) -> Value {
    let mut content = vec![p];
    content.extend(sub);
    if kind == "taskItem" {
        json!({"type": "taskItem", "attrs": {"checked": checked}, "content": content})
    } else {
        json!({"type": "listItem", "content": content})
    }
}

fn list(item_kind: &'static str, depth: u32, nasty: bool) -> BoxedStrategy<Value> {
    let items = prop::collection::vec(item(item_kind, depth, nasty), 1..4);
    match item_kind {
        "taskItem" => items.prop_map(|c| json!({"type": "taskList", "content": c})).boxed(),
        _ => (items, any::<bool>(), 1..4i64)
            .prop_map(|(c, ordered, start)| {
                if ordered {
                    json!({"type": "orderedList", "attrs": {"start": start}, "content": c})
                } else {
                    json!({"type": "bulletList", "content": c})
                }
            })
            .boxed(),
    }
}

/// Tabela retangular; a primeira linha é o cabeçalho (como a tabela do Markdown). Célula vazia às vezes.
fn table(nasty: bool) -> BoxedStrategy<Value> {
    (1..4usize, 1..4usize)
        .prop_flat_map(move |(rows, cols)| prop::collection::vec(prop::collection::vec(prop::option::weighted(0.85, inline(nasty)), cols), rows + 1))
        .prop_map(|rows| {
            let rows: Vec<Value> = rows
                .into_iter()
                .enumerate()
                .map(|(i, cells)| {
                    let cells: Vec<Value> = cells
                        .into_iter()
                        .map(|c| {
                            let p = match c {
                                Some(c) => json!({"type": "paragraph", "content": c}),
                                None => json!({"type": "paragraph"}),
                            };
                            json!({"type": if i == 0 { "tableHeader" } else { "tableCell" }, "attrs": {"colspan": 1, "rowspan": 1}, "content": [p]})
                        })
                        .collect();
                    json!({"type": "tableRow", "content": cells})
                })
                .collect();
            json!({"type": "table", "content": rows})
        })
        .boxed()
}

fn block(nasty: bool) -> BoxedStrategy<Value> {
    prop_oneof![
        4 => paragraph(nasty),
        1 => Just(json!({"type": "paragraph"})),
        1 => (inline(nasty), 1..=3u8).prop_map(|(c, level)| json!({"type": "heading", "attrs": {"level": level}, "content": c})),
        1 => prop::collection::vec(prop_oneof![3 => paragraph(nasty), 1 => list("listItem", 1, nasty)], 1..3)
            .prop_map(|c| json!({"type": "blockquote", "content": c})),
        1 => Just(json!({"type": "horizontalRule"})),
        1 => table(nasty),
        2 => list("taskItem", 2, nasty),
        2 => list("listItem", 2, nasty),
        1 => prop::collection::vec("[a-zA-Z0-9 (){};=*_#<>-]{0,20}", 1..4)
            .prop_map(|lines| json!({"type": "codeBlock", "content": [{"type": "text", "text": lines.join("\n")}]})),
        1 => hash().prop_map(|h| json!({"type": "noteImage", "attrs": {"hash": h}})),
        1 => prop::collection::vec(hash(), 2..5)
            .prop_map(|hs| json!({"type": "imageRow", "content": hs.iter().map(|h| json!({"type": "noteImage", "attrs": {"hash": h}})).collect::<Vec<_>>()})),
        1 => hash().prop_map(|h| json!({"type": "noteFile", "attrs": {"hash": h}})),
        1 => ("https://[a-z]{1,8}\\.com/[a-z0-9_-]{0,8}", prop::option::of(words(nasty))).prop_map(|(url, title)| {
            let mut attrs = json!({"url": url});
            if let Some(t) = title {
                attrs["title"] = json!(t);
            }
            json!({"type": "linkCard", "attrs": attrs})
        }),
    ]
    .boxed()
}

/// Documento com 1 a 6 blocos. `nasty`: textos com os sinais do Markdown.
pub fn doc(nasty: bool) -> BoxedStrategy<Value> {
    prop::collection::vec(block(nasty), 1..7).prop_map(|c| json!({"type": "doc", "content": c})).boxed()
}
