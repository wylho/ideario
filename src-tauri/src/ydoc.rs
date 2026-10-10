//! Nota como Y.Doc (Fase 2, SPEC §5): `Y.Map("meta")` com título, cor, categoria, fixada, arquivo, lixeira, lembrete e
//! tags, e `Y.XmlFragment("body")` com o conteúdo do editor, no mesmo formato do y-prosemirror (o editor usa o TipTap
//! Collaboration): cada nó vira um `XmlElement` com o nome do tipo e os atributos não nulos; textos seguidos viram um
//! `XmlText` com as marcas como formatação (`{ bold: {} }`, `{ link: { href } }`).
//!
//! O estado binário é a fonte da verdade da nota. O JSON do TipTap e as colunas SQL saem dele (projeção).

use std::collections::HashMap;
use std::sync::Arc;

use serde_json::{json, Map, Value};
use yrs::types::text::Diff;
use yrs::types::Attrs;
use yrs::updates::decoder::Decode;
use yrs::{
    Any, Doc, Number, Map as _, MapRef, OffsetKind, Options, Out, ReadTxn, StateVector, Text, Transact, TransactionMut, Update, Xml,
    XmlElementPrelim, XmlFragment, XmlFragmentRef, XmlOut, XmlTextPrelim,
};

use crate::store::{Millis, NoteInput};

const META: &str = "meta";
const BODY: &str = "body";

type Result<T> = std::result::Result<T, String>;

fn new_doc() -> Doc {
    // Posições em UTF-16, como no Yjs do editor.
    Doc::with_options(Options { offset_kind: OffsetKind::Utf16, ..Options::default() })
}

fn load(state: &[u8]) -> Result<Doc> {
    let doc = new_doc();
    if !state.is_empty() {
        let update = Update::decode_v1(state).map_err(|e| format!("estado da nota ilegível: {e}"))?;
        doc.transact_mut().apply_update(update).map_err(|e| e.to_string())?;
    }
    Ok(doc)
}

fn encode(doc: &Doc) -> Vec<u8> {
    doc.transact().encode_state_as_update_v1(&StateVector::default())
}

/// Estado novo a partir de uma nota (migração do JSON da Fase 1, nota de boas-vindas, cópia).
pub(crate) fn from_note(n: &NoteInput) -> Vec<u8> {
    let doc = new_doc();
    {
        let meta = doc.get_or_insert_map(META);
        let body = doc.get_or_insert_xml_fragment(BODY);
        let mut txn = doc.transact_mut();
        write_meta(&meta, &mut txn, n, None);
        write_body(&body, &mut txn, &n.body);
    }
    encode(&doc)
}

/// Aplica uma atualização (do editor ou de outro aparelho) e devolve o estado novo.
pub(crate) fn apply(state: &[u8], update: &[u8]) -> Result<Vec<u8>> {
    let doc = load(state)?;
    let u = Update::decode_v1(update).map_err(|e| format!("atualização ilegível: {e}"))?;
    doc.transact_mut().apply_update(u).map_err(|e| e.to_string())?;
    Ok(encode(&doc))
}

/// Lê a nota do estado: metadados e o corpo em JSON do TipTap.
pub(crate) fn to_note(id: &str, state: &[u8]) -> Result<NoteInput> {
    let doc = load(state)?;
    let meta = doc.get_or_insert_map(META);
    let body = doc.get_or_insert_xml_fragment(BODY);
    let txn = doc.transact();
    let get = |k: &str| meta.get(&txn, k);
    let s = |k: &str| match get(k) {
        Some(Out::Any(Any::String(s))) => Some(s.to_string()),
        _ => None,
    };
    let b = |k: &str| matches!(get(k), Some(Out::Any(Any::Bool(true))));
    let ms = |k: &str| match get(k) {
        Some(Out::Any(Any::Number(Number::Int(n)))) => Some(n),
        Some(Out::Any(Any::Number(Number::Float(n)))) => Some(n as Millis),
        _ => None,
    };
    let tags = match get("tags") {
        Some(Out::Any(Any::Array(a))) => a
            .iter()
            .filter_map(|t| if let Any::String(s) = t { Some(s.to_string()) } else { None })
            .collect(),
        _ => Vec::new(),
    };
    Ok(NoteInput {
        id: id.to_string(),
        title: s("title").unwrap_or_default(),
        body: read_body(&body, &txn),
        category_id: s("categoryId"),
        color: s("color").unwrap_or_else(|| "none".into()),
        pinned: b("pinned"),
        archived: b("archived"),
        trashed_at: ms("trashedAt"),
        reminder_at: ms("reminderAt"),
        reminder_done: b("reminderDone"),
        reminder_repeat: s("reminderRepeat"),
        tags,
    })
}

/// Grava no estado só os metadados que mudaram (cada chave faz merge sozinha) e, se `body` vier, troca o corpo.
pub(crate) fn update(state: &[u8], n: &NoteInput, body: bool) -> Result<Vec<u8>> {
    let doc = load(state)?;
    let prev = to_note(&n.id, state)?;
    {
        let meta = doc.get_or_insert_map(META);
        let frag = doc.get_or_insert_xml_fragment(BODY);
        let mut txn = doc.transact_mut();
        write_meta(&meta, &mut txn, n, Some(&prev));
        if body && prev.body != n.body {
            let len = frag.len(&txn);
            if len > 0 {
                frag.remove_range(&mut txn, 0, len);
            }
            write_body(&frag, &mut txn, &n.body);
        }
    }
    Ok(encode(&doc))
}

// ---------- metadados ----------

/// Números como no Yjs do editor (float64), nunca BigInt: o JS leria um BigInt.
fn num(v: Option<Millis>) -> Any {
    v.map(|n| Any::Number(Number::Float(n as f64))).unwrap_or(Any::Null)
}

fn opt_str(v: &Option<String>) -> Any {
    v.as_deref().map(Any::from).unwrap_or(Any::Null)
}

fn write_meta(meta: &MapRef, txn: &mut TransactionMut, n: &NoteInput, prev: Option<&NoteInput>) {
    let mut set = |k: &str, v: Any, changed: bool| {
        if prev.is_none() || changed {
            meta.insert(txn, k, v);
        }
    };
    let p = prev;
    set("title", Any::from(n.title.as_str()), p.is_some_and(|p| p.title != n.title));
    set("categoryId", opt_str(&n.category_id), p.is_some_and(|p| p.category_id != n.category_id));
    set("color", Any::from(n.color.as_str()), p.is_some_and(|p| p.color != n.color));
    set("pinned", Any::Bool(n.pinned), p.is_some_and(|p| p.pinned != n.pinned));
    set("archived", Any::Bool(n.archived), p.is_some_and(|p| p.archived != n.archived));
    set("trashedAt", num(n.trashed_at), p.is_some_and(|p| p.trashed_at != n.trashed_at));
    set("reminderAt", num(n.reminder_at), p.is_some_and(|p| p.reminder_at != n.reminder_at));
    set("reminderDone", Any::Bool(n.reminder_done), p.is_some_and(|p| p.reminder_done != n.reminder_done));
    set("reminderRepeat", opt_str(&n.reminder_repeat), p.is_some_and(|p| p.reminder_repeat != n.reminder_repeat));
    let tags: Vec<Any> = n.tags.iter().map(|t| Any::from(t.as_str())).collect();
    set("tags", Any::Array(tags.into()), p.is_some_and(|p| p.tags != n.tags));
}

// ---------- corpo: JSON do TipTap → Y ----------

fn any_of(v: &Value) -> Any {
    match v {
        // Inteiros também como float64, como o JS grava números grandes.
        Value::Number(n) => Any::Number(Number::Float(n.as_f64().unwrap_or(0.0))),
        other => serde_json::from_value(other.clone()).unwrap_or(Any::Null),
    }
}

fn write_body(frag: &XmlFragmentRef, txn: &mut TransactionMut, body: &Value) {
    let empty = vec![];
    let content = body.get("content").and_then(Value::as_array).unwrap_or(&empty);
    write_children(frag, txn, content);
}

fn write_children<F: XmlFragment>(parent: &F, txn: &mut TransactionMut, nodes: &[Value]) {
    let mut i = 0;
    while i < nodes.len() {
        if nodes[i].get("type").and_then(Value::as_str) == Some("text") {
            // Textos seguidos (com marcas diferentes) formam um só XmlText.
            let text = parent.push_back(txn, XmlTextPrelim::new(""));
            while i < nodes.len() && nodes[i].get("type").and_then(Value::as_str) == Some("text") {
                let chunk = nodes[i].get("text").and_then(Value::as_str).unwrap_or("");
                // Sempre no fim do que já entrou (marcas explícitas: o trecho não herda as do anterior).
                let end = text.len(txn);
                text.insert_with_attributes(txn, end, chunk, marks_to_attrs(&nodes[i]));
                i += 1;
            }
            continue;
        }
        let node = &nodes[i];
        let tag = node.get("type").and_then(Value::as_str).unwrap_or("paragraph");
        let el = parent.push_back(txn, XmlElementPrelim::empty(tag));
        if let Some(attrs) = node.get("attrs").and_then(Value::as_object) {
            for (k, v) in attrs {
                if !v.is_null() {
                    el.insert_attribute(txn, k.as_str(), any_of(v));
                }
            }
        }
        if let Some(children) = node.get("content").and_then(Value::as_array) {
            write_children(&el, txn, children);
        }
        i += 1;
    }
}

fn marks_to_attrs(node: &Value) -> Attrs {
    let mut attrs: Attrs = HashMap::new();
    for m in node.get("marks").and_then(Value::as_array).into_iter().flatten() {
        let Some(name) = m.get("type").and_then(Value::as_str) else { continue };
        let value = m.get("attrs").map(any_of).unwrap_or_else(|| Any::Map(Arc::new(HashMap::<String, Any>::new())));
        attrs.insert(Arc::from(name), value);
    }
    attrs
}

// ---------- corpo: Y → JSON do TipTap ----------

fn json_of(out: &Out) -> Value {
    match out {
        Out::Any(a) => serde_json::to_value(a).unwrap_or(Value::Null),
        _ => Value::Null,
    }
}

fn read_body<T: ReadTxn>(frag: &XmlFragmentRef, txn: &T) -> Value {
    let content = read_children(frag, txn);
    if content.is_empty() {
        json!({ "type": "doc", "content": [{ "type": "paragraph" }] })
    } else {
        json!({ "type": "doc", "content": content })
    }
}

fn read_children<F: XmlFragment, T: ReadTxn>(parent: &F, txn: &T) -> Vec<Value> {
    let mut out = Vec::new();
    for child in parent.children(txn) {
        match child {
            XmlOut::Element(el) => {
                let mut node = Map::new();
                node.insert("type".into(), Value::from(el.tag().as_ref()));
                let attrs: Map<String, Value> =
                    el.attributes(txn).map(|(k, v)| (k.to_string(), json_of(&v))).filter(|(_, v)| !v.is_null()).collect();
                if !attrs.is_empty() {
                    node.insert("attrs".into(), Value::Object(attrs));
                }
                let content = read_children(&el, txn);
                if !content.is_empty() {
                    node.insert("content".into(), Value::Array(content));
                }
                out.push(Value::Object(node));
            }
            XmlOut::Text(text) => {
                for d in text.diff(txn, |_| ()) {
                    if let Some(node) = text_node(&d) {
                        out.push(node);
                    }
                }
            }
            XmlOut::Fragment(f) => out.extend(read_children(&f, txn)),
        }
    }
    out
}

fn text_node(d: &Diff<()>) -> Option<Value> {
    let s = match &d.insert {
        Out::Any(Any::String(s)) => s.to_string(),
        _ => return None,
    };
    if s.is_empty() {
        return None;
    }
    let mut node = json!({ "type": "text", "text": s });
    let mut marks: Vec<Value> = Vec::new();
    for (k, v) in d.attributes.iter().flat_map(|a| a.iter()) {
        if matches!(v, Any::Null) {
            continue;
        }
        // Marcas que se repetem levam um sufixo "--hash" no y-prosemirror.
        let name = match k.rsplit_once("--") {
            Some((n, h)) if h.len() == 8 => n,
            _ => k.as_ref(),
        };
        let attrs = serde_json::to_value(v).unwrap_or(Value::Null);
        let mut mark = json!({ "type": name });
        if attrs.as_object().is_some_and(|o| !o.is_empty()) {
            mark["attrs"] = attrs;
        }
        marks.push(mark);
    }
    if !marks.is_empty() {
        marks.sort_by(|a, b| a["type"].as_str().cmp(&b["type"].as_str()));
        node["marks"] = Value::Array(marks);
    }
    Some(node)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(body: Value) -> NoteInput {
        NoteInput {
            id: "n1".into(),
            title: "Mercado".into(),
            body,
            category_id: Some("c1".into()),
            color: "butter".into(),
            pinned: true,
            archived: false,
            trashed_at: None,
            reminder_at: Some(1_791_573_277_130),
            reminder_done: false,
            reminder_repeat: None,
            tags: vec!["casa".into()],
        }
    }

    fn rich() -> Value {
        json!({"type":"doc","content":[
            {"type":"paragraph","content":[
                {"type":"text","text":"Olá "},
                {"type":"text","text":"mundo","marks":[{"type":"bold"}]},
                {"type":"text","text":" 🌎 e "},
                {"type":"text","text":"link","marks":[{"type":"link","attrs":{"href":"https://a.b","target":"_blank"}}]},
                {"type":"text","text":" #tag"}
            ]},
            {"type":"taskList","content":[
                {"type":"taskItem","attrs":{"checked":true},"content":[{"type":"paragraph","content":[{"type":"text","text":"Arroz"}]}]},
                {"type":"taskItem","attrs":{"checked":false},"content":[{"type":"paragraph","content":[{"type":"text","text":"Café"}]}]}
            ]},
            {"type":"imageRow","content":[{"type":"noteImage","attrs":{"hash":"abc"}},{"type":"noteImage","attrs":{"hash":"def"}}]},
            {"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"Título"},{"type":"hardBreak"},{"type":"text","text":"linha"}]},
            {"type":"paragraph"}
        ]})
    }

    #[test]
    fn round_trip_keeps_meta_and_body() {
        let n = note(rich());
        let state = from_note(&n);
        let back = to_note("n1", &state).unwrap();
        assert_eq!(back.title, "Mercado");
        assert_eq!(back.category_id.as_deref(), Some("c1"));
        assert!(back.pinned && !back.archived);
        assert_eq!(back.reminder_at, Some(1_791_573_277_130));
        assert_eq!(back.tags, vec!["casa"]);
        assert_eq!(back.body, rich(), "{}", serde_json::to_string_pretty(&back.body).unwrap());
    }

    #[test]
    fn concurrent_edits_merge() {
        // Duas cópias da mesma nota editadas em separado (dois aparelhos) e juntadas nos dois sentidos.
        let base = from_note(&note(rich()));
        let mut a = to_note("n1", &base).unwrap();
        a.title = "Mercado da semana".into();
        let sa = update(&base, &a, false).unwrap();
        let mut b = to_note("n1", &base).unwrap();
        b.pinned = false;
        b.color = "sky".into();
        let sb = update(&base, &b, false).unwrap();
        let ab = apply(&sa, &sb).unwrap();
        let ba = apply(&sb, &sa).unwrap();
        let (x, y) = (to_note("n1", &ab).unwrap(), to_note("n1", &ba).unwrap());
        assert_eq!(x.title, "Mercado da semana");
        assert_eq!((x.pinned, x.color.as_str()), (false, "sky"));
        assert_eq!(x.title, y.title);
        assert_eq!(x.body, y.body);
    }

    #[test]
    fn replacing_the_body() {
        let base = from_note(&note(rich()));
        let mut n = to_note("n1", &base).unwrap();
        n.body = json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"novo"}]}]});
        let s = update(&base, &n, true).unwrap();
        assert_eq!(to_note("n1", &s).unwrap().body, n.body);
    }

    #[test]
    fn empty_state_is_an_empty_note() {
        let n = to_note("x", &[]).unwrap();
        assert_eq!(n.title, "");
        assert_eq!(n.color, "none");
        assert_eq!(n.body, json!({"type":"doc","content":[{"type":"paragraph"}]}));
    }
}

#[cfg(test)]
mod dump {
    /// `IDEARIO_DUMP=/caminho cargo test dump_state -- --ignored`: grava o estado da nota de exemplo para o Yjs ler.
    #[test]
    #[ignore]
    fn dump_state() {
        let path = std::env::var("IDEARIO_DUMP").unwrap();
        let n = super::tests_note();
        std::fs::write(path, super::from_note(&n)).unwrap();
    }
}

#[cfg(test)]
pub(crate) fn tests_note() -> NoteInput {
    NoteInput {
        id: "n1".into(),
        title: "T".into(),
        body: json!({"type":"doc","content":[
            {"type":"paragraph","content":[{"type":"text","text":"Olá "},{"type":"text","text":"mundo","marks":[{"type":"bold"}]}]},
            {"type":"taskList","content":[{"type":"taskItem","attrs":{"checked":false},"content":[{"type":"paragraph","content":[{"type":"text","text":"Arroz"}]}]}]}
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
    }
}

#[cfg(test)]
mod props {
    //! Propriedades do formato: valem para qualquer nota, não só para os exemplos acima.
    use super::*;
    use proptest::prelude::*;

    /// Texto com acentos, emoji (fora do BMP, 2 unidades UTF-16) e #tags.
    fn chunk() -> impl Strategy<Value = String> {
        "[a-zA-Zàéíõçã #🌎👍🏽\\-]{1,12}"
    }

    fn marks() -> impl Strategy<Value = Vec<&'static str>> {
        proptest::sample::subsequence(vec!["bold", "code", "italic"], 0..=3)
    }

    /// Parágrafo com trechos de marcas diferentes. Trechos vizinhos com as mesmas marcas são juntados, como o
    /// ProseMirror faz (no Yjs eles viram um trecho só).
    fn paragraph() -> impl Strategy<Value = Value> {
        prop::collection::vec((chunk(), marks()), 0..5).prop_map(|parts| {
            let mut content: Vec<(String, Vec<&str>)> = Vec::new();
            for (t, m) in parts {
                match content.last_mut() {
                    Some((prev, pm)) if *pm == m => prev.push_str(&t),
                    _ => content.push((t, m)),
                }
            }
            let nodes: Vec<Value> = content
                .into_iter()
                .map(|(t, m)| {
                    if m.is_empty() {
                        json!({"type":"text","text":t})
                    } else {
                        json!({"type":"text","text":t,"marks":m.iter().map(|k| json!({"type":k})).collect::<Vec<_>>()})
                    }
                })
                .collect();
            if nodes.is_empty() { json!({"type":"paragraph"}) } else { json!({"type":"paragraph","content":nodes}) }
        })
    }

    fn task() -> impl Strategy<Value = Value> {
        (any::<bool>(), chunk()).prop_map(|(c, t)| {
            json!({"type":"taskItem","attrs":{"checked":c},"content":[{"type":"paragraph","content":[{"type":"text","text":t}]}]})
        })
    }

    fn body() -> impl Strategy<Value = Value> {
        let block = prop_oneof![
            paragraph(),
            prop::collection::vec(task(), 1..4).prop_map(|items| json!({"type":"taskList","content":items})),
            "[a-f0-9]{8}".prop_map(|h| json!({"type":"noteImage","attrs":{"hash":h}})),
        ];
        prop::collection::vec(block, 1..6).prop_map(|c| json!({"type":"doc","content":c}))
    }

    fn meta_note(body: Value, title: String, pinned: bool, when: Option<i64>, tags: Vec<String>) -> NoteInput {
        NoteInput {
            id: "p".into(),
            title,
            body,
            category_id: None,
            color: "sky".into(),
            pinned,
            archived: false,
            trashed_at: when,
            reminder_at: when,
            reminder_done: false,
            reminder_repeat: None,
            tags,
        }
    }

    proptest! {
        #[test]
        fn any_note_round_trips(
            body in body(),
            title in "[a-zA-Zçã 🌎]{0,20}",
            pinned in any::<bool>(),
            when in proptest::option::of(0i64..4_102_444_800_000),
            tags in prop::collection::vec("[a-z]{1,8}", 0..4),
        ) {
            let n = meta_note(body, title, pinned, when, tags);
            let back = to_note("p", &from_note(&n)).unwrap();
            prop_assert_eq!(&back.body, &n.body);
            prop_assert_eq!(&back.title, &n.title);
            prop_assert_eq!(back.pinned, n.pinned);
            prop_assert_eq!(back.reminder_at, n.reminder_at);
            prop_assert_eq!(&back.tags, &n.tags);
        }

        #[test]
        fn edits_on_two_devices_converge(
            body in body(),
            title_a in "[a-z ]{0,12}",
            color_b in prop::sample::select(vec!["none", "sky", "butter", "rose"]),
            pin_b in any::<bool>(),
        ) {
            let base = from_note(&meta_note(body, "base".into(), false, None, vec![]));
            let mut a = to_note("p", &base).unwrap();
            a.title = title_a.clone();
            let sa = update(&base, &a, false).unwrap();
            let mut b = to_note("p", &base).unwrap();
            b.color = color_b.to_string();
            b.pinned = pin_b;
            let sb = update(&base, &b, false).unwrap();
            let (ab, ba) = (to_note("p", &apply(&sa, &sb).unwrap()).unwrap(), to_note("p", &apply(&sb, &sa).unwrap()).unwrap());
            // As duas ordens dão o mesmo resultado, e nenhuma edição se perde.
            prop_assert_eq!(&ab.title, &ba.title);
            prop_assert_eq!(&ab.body, &ba.body);
            prop_assert_eq!(&ab.title, &title_a);
            prop_assert_eq!(ab.color.as_str(), color_b);
            prop_assert_eq!(ab.pinned, pin_b);
        }

        #[test]
        fn applying_the_same_update_twice_changes_nothing(body in body()) {
            let s = from_note(&meta_note(body, "x".into(), true, None, vec![]));
            let twice = apply(&s, &s).unwrap();
            prop_assert_eq!(to_note("p", &twice).unwrap().body, to_note("p", &s).unwrap().body);
        }
    }

    #[test]
    fn garbage_is_an_error_not_a_crash() {
        assert!(apply(&[], &[1, 2, 3, 255]).is_err());
        assert!(to_note("x", &[9, 9, 9]).is_err());
    }
}
