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
    Any, Doc, Number, Map as _, MapPrelim, MapRef, OffsetKind, Options, Out, ReadTxn, StateVector, Text, Transact, TransactionMut, Update, Xml,
    XmlElementPrelim, XmlFragment, XmlFragmentRef, XmlOut, XmlTextPrelim,
};

use sha2::{Digest, Sha256};

use crate::store::{CategoryRow, Millis, NoteInput};

const META: &str = "meta";
const BODY: &str = "body";

type Result<T> = std::result::Result<T, String>;

fn new_doc() -> Doc {
    // Posições em UTF-16, como no Yjs do editor.
    Doc::with_options(Options { offset_kind: OffsetKind::Utf16, ..Options::default() })
}

fn doc_with_client(client: u64) -> Doc {
    Doc::with_options(Options { offset_kind: OffsetKind::Utf16, ..Options::with_client_id(yrs::block::ClientID::new(client)) })
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

/// Estado novo a partir de uma nota (migração do JSON da Fase 1, nota de boas-vindas, cópia, importação).
///
/// O mesmo conteúdo dá sempre o mesmo estado: o "autor" (client id do Yjs) da criação sai do próprio conteúdo. Assim
/// a mesma nota criada em dois aparelhos sem sync (o mesmo Takeout importado nos dois) junta sem duplicar o texto;
/// conteúdos diferentes têm autores diferentes e nunca se confundem. As edições seguintes usam autores aleatórios.
pub(crate) fn from_note(n: &NoteInput) -> Vec<u8> {
    let key = json!([n.id, n.title, n.body, n.category_id, n.color, n.pinned, n.archived, n.trashed_at, n.reminder_at, n.reminder_done, n.reminder_repeat, n.tags]);
    let digest = Sha256::digest(key.to_string());
    let client = u32::from_le_bytes([digest[0], digest[1], digest[2], digest[3]]).max(2);
    build(n, u64::from(client))
}

fn build(n: &NoteInput, client: u64) -> Vec<u8> {
    let doc = doc_with_client(client);
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
            let empty = vec![];
            patch_children(&frag, &mut txn, n.body.get("content").and_then(Value::as_array).unwrap_or(&empty));
        }
    }
    Ok(encode(&doc))
}

/// O estado local tem algo que o remoto não tem? (conteúdo novo de algum aparelho, ou algo apagado aqui e ainda
/// não lá). Decide se a nota continua precisando subir depois de juntar a versão do Drive.
pub(crate) fn has_more_than(local: &[u8], remote: &[u8]) -> Result<bool> {
    let (l, r) = (load(local)?, load(remote)?);
    let (ls, rs) = (l.transact().snapshot(), r.transact().snapshot());
    if ls.state_map.iter().any(|(client, clock)| *clock > rs.state_map.get(client)) {
        return Ok(true);
    }
    for (client, ranges) in ls.delete_set.iter() {
        for range in ranges.iter() {
            if range.clone().any(|clock| !rs.delete_set.contains(&yrs::ID::new(*client, clock))) {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

/// Como o editor faz: insere `text` no bloco `block`, na posição `at` (limitada ao tamanho), ou um parágrafo novo no
/// fim se o bloco não existir. Devolve o estado novo (serve como atualização). Para testes de sync.
#[cfg(test)]
pub(crate) fn type_text(state: &[u8], block: u32, at: u32, text: &str) -> Vec<u8> {
    let doc = load(state).unwrap_or_else(|_| new_doc());
    let frag = doc.get_or_insert_xml_fragment(BODY);
    {
        let mut txn = doc.transact_mut();
        match frag.get(&txn, block) {
            Some(XmlOut::Element(p)) => {
                let t = match p.get(&txn, 0) {
                    Some(XmlOut::Text(t)) => t,
                    _ => p.insert(&mut txn, 0, XmlTextPrelim::new("")),
                };
                let at = at.min(t.len(&txn));
                t.insert(&mut txn, at, text);
            }
            _ => {
                let len = frag.len(&txn);
                let p = frag.insert(&mut txn, len, XmlElementPrelim::empty("paragraph"));
                p.insert(&mut txn, 0, XmlTextPrelim::new(text));
            }
        }
    }
    encode(&doc)
}

// ---------- categorias ----------

/// Categorias como um Y.Doc (`categories.ydoc` no Drive): `Y.Map("categories")` com um `Y.Map` por id (nome, cor,
/// ordem, apagada). Cada campo faz merge sozinho: renomear num aparelho e mudar a cor no outro preserva os dois.
const CATEGORIES: &str = "categories";

/// Grava no estado só os campos que mudaram nas categorias locais.
pub(crate) fn write_categories(state: &[u8], rows: &[CategoryRow]) -> Result<Vec<u8>> {
    let doc = load(state)?;
    let root = doc.get_or_insert_map(CATEGORIES);
    {
        let mut txn = doc.transact_mut();
        for c in rows {
            let fields: [(&str, Any); 6] = [
                ("name", Any::from(c.name.as_str())),
                ("color", Any::from(c.color.as_str())),
                ("sort", Any::Number(Number::Float(c.sort as f64))),
                ("deleted", Any::Bool(c.deleted)),
                ("hidden", Any::Bool(c.hidden)),
                ("pin", opt_str(&c.pin)),
            ];
            match root.get(&txn, &c.id) {
                Some(Out::YMap(m)) => {
                    for (k, v) in fields {
                        if m.get(&txn, k) != Some(Out::Any(v.clone())) {
                            m.insert(&mut txn, k, v);
                        }
                    }
                }
                _ => {
                    root.insert(&mut txn, c.id.as_str(), MapPrelim::from(fields));
                }
            }
        }
    }
    Ok(encode(&doc))
}

pub(crate) fn read_categories(state: &[u8]) -> Result<Vec<CategoryRow>> {
    let doc = load(state)?;
    let root = doc.get_or_insert_map(CATEGORIES);
    let txn = doc.transact();
    let mut rows: Vec<CategoryRow> = root
        .iter(&txn)
        .filter_map(|(id, v)| {
            let Out::YMap(m) = v else { return None };
            let s = |k: &str| match m.get(&txn, k) {
                Some(Out::Any(Any::String(s))) => Some(s.to_string()),
                _ => None,
            };
            let sort = match m.get(&txn, "sort") {
                Some(Out::Any(Any::Number(Number::Float(n)))) => n as i64,
                Some(Out::Any(Any::Number(Number::Int(n)))) => n,
                _ => 0,
            };
            Some(CategoryRow {
                id: id.to_string(),
                name: s("name")?,
                color: s("color").unwrap_or_default(),
                sort,
                deleted: matches!(m.get(&txn, "deleted"), Some(Out::Any(Any::Bool(true)))),
                // (categorias de antes da migração 7 não têm estes campos)
                hidden: matches!(m.get(&txn, "hidden"), Some(Out::Any(Any::Bool(true)))),
                pin: s("pin"),
            })
        })
        .collect();
    rows.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(rows)
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

// ---------- corpo: troca mínima ----------

/// Filho do corpo como o Y guarda: um elemento, ou um texto (os nós de texto seguidos do JSON viram um só).
enum Unit<'a> {
    Text(&'a [Value]),
    El(&'a Value),
}

fn units(nodes: &[Value]) -> Vec<Unit<'_>> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < nodes.len() {
        if nodes[i].get("type").and_then(Value::as_str) == Some("text") {
            let start = i;
            while i < nodes.len() && nodes[i].get("type").and_then(Value::as_str) == Some("text") {
                i += 1;
            }
            out.push(Unit::Text(&nodes[start..i]));
        } else {
            out.push(Unit::El(&nodes[i]));
            i += 1;
        }
    }
    out
}

/// Forma canônica para comparar um filho do JSON com um do Y: sem atributos nulos, marcas em ordem, textos com as
/// mesmas marcas juntos e sem textos vazios (como a leitura do Y devolve).
fn canon_unit(u: &Unit) -> Value {
    match u {
        Unit::Text(nodes) => Value::Array(canon_texts(nodes)),
        Unit::El(node) => canon_el(node),
    }
}

fn canon_texts(nodes: &[Value]) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    for n in nodes {
        let text = n.get("text").and_then(Value::as_str).unwrap_or("");
        if text.is_empty() {
            continue;
        }
        let mut marks: Vec<Value> = n
            .get("marks")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .map(|m| {
                let mut m = m.clone();
                if let Some(o) = m.as_object_mut() {
                    if o.get("attrs").is_some_and(|a| a.is_null() || a.as_object().is_some_and(|a| a.is_empty())) {
                        o.remove("attrs");
                    }
                }
                m
            })
            .collect();
        marks.sort_by(|a, b| a["type"].as_str().cmp(&b["type"].as_str()));
        match out.last_mut() {
            Some(last) if last.get("marks").cloned().unwrap_or(Value::Array(vec![])) == Value::Array(marks.clone()) => {
                let joined = format!("{}{text}", last["text"].as_str().unwrap_or(""));
                last["text"] = Value::from(joined);
            }
            _ => {
                let mut t = json!({ "type": "text", "text": text });
                if !marks.is_empty() {
                    t["marks"] = Value::Array(marks);
                }
                out.push(t);
            }
        }
    }
    out
}

/// O corpo na forma canônica (para comparar dois corpos que o editor mostra igual).
pub(crate) fn canon(body: &Value) -> Value {
    canon_el(body)
}

fn canon_el(node: &Value) -> Value {
    let mut out = Map::new();
    out.insert("type".into(), node.get("type").cloned().unwrap_or_else(|| Value::from("paragraph")));
    let attrs: Map<String, Value> =
        node.get("attrs").and_then(Value::as_object).into_iter().flatten().filter(|(_, v)| !v.is_null()).map(|(k, v)| (k.clone(), v.clone())).collect();
    if !attrs.is_empty() {
        out.insert("attrs".into(), Value::Object(attrs));
    }
    let empty = vec![];
    let content: Vec<Value> = units(node.get("content").and_then(Value::as_array).unwrap_or(&empty))
        .iter()
        .flat_map(|u| match canon_unit(u) {
            Value::Array(texts) => texts,
            el => vec![el],
        })
        .collect();
    if !content.is_empty() {
        out.insert("content".into(), Value::Array(content));
    }
    Value::Object(out)
}

/// O filho `i` do Y na forma canônica (texto: a lista dos trechos).
fn canon_child<T: ReadTxn>(child: &XmlOut, txn: &T) -> Value {
    match child {
        XmlOut::Text(text) => Value::Array(text.diff(txn, |_| ()).iter().filter_map(text_node).collect()),
        XmlOut::Element(el) => canon_el(&element_json(el, txn)),
        XmlOut::Fragment(_) => Value::Null,
    }
}

/// Grava `new` como filhos de `parent` mexendo só no que mudou: o começo e o fim iguais ficam; no meio, elemento do
/// mesmo tipo recebe só os atributos e os filhos diferentes; o resto é trocado. Assim marcar um item ou acrescentar
/// uma linha (o MCP, um sync) não recria a nota inteira, e quem está com ela aberta não perde o cursor.
fn patch_children<F: XmlFragment>(parent: &F, txn: &mut TransactionMut, new: &[Value]) {
    let new: Vec<Unit> = units(new).into_iter().filter(|u| !matches!(u, Unit::Text(t) if canon_texts(t).is_empty())).collect();
    let want: Vec<Value> = new.iter().map(canon_unit).collect();
    let have: Vec<Value> = parent.children(txn).map(|c| canon_child(&c, txn)).collect();
    let mut pre = 0;
    while pre < have.len() && pre < want.len() && have[pre] == want[pre] {
        pre += 1;
    }
    let mut suf = 0;
    while suf < have.len() - pre && suf < want.len() - pre && have[have.len() - 1 - suf] == want[want.len() - 1 - suf] {
        suf += 1;
    }
    let (old_mid, new_mid) = (have.len() - pre - suf, want.len() - pre - suf);
    if old_mid == new_mid {
        for (i, unit) in new.iter().enumerate().skip(pre).take(new_mid) {
            match (parent.get(txn, i as u32), unit) {
                (Some(XmlOut::Element(el)), Unit::El(node)) if node.get("type").and_then(Value::as_str) == Some(el.tag().as_ref()) => {
                    patch_attrs(&el, txn, node);
                    let empty = vec![];
                    patch_children(&el, txn, node.get("content").and_then(Value::as_array).unwrap_or(&empty));
                }
                _ => {
                    parent.remove_range(txn, i as u32, 1);
                    insert_unit(parent, txn, i as u32, unit);
                }
            }
        }
    } else {
        if old_mid > 0 {
            parent.remove_range(txn, pre as u32, old_mid as u32);
        }
        for (i, unit) in new.iter().enumerate().skip(pre).take(new_mid) {
            insert_unit(parent, txn, i as u32, unit);
        }
    }
}

fn patch_attrs(el: &yrs::XmlElementRef, txn: &mut TransactionMut, node: &Value) {
    let want: Map<String, Value> =
        node.get("attrs").and_then(Value::as_object).into_iter().flatten().filter(|(_, v)| !v.is_null()).map(|(k, v)| (k.clone(), v.clone())).collect();
    let have: Map<String, Value> = el.attributes(txn).map(|(k, v)| (k.to_string(), json_of(&v))).collect();
    for k in have.keys().filter(|k| !want.contains_key(*k)) {
        el.remove_attribute(txn, k);
    }
    for (k, v) in want.iter().filter(|(k, v)| have.get(*k) != Some(v)) {
        el.insert_attribute(txn, k.as_str(), any_of(v));
    }
}

fn insert_unit<F: XmlFragment>(parent: &F, txn: &mut TransactionMut, index: u32, unit: &Unit) {
    match unit {
        Unit::Text(nodes) => {
            let text = parent.insert(txn, index, XmlTextPrelim::new(""));
            for n in nodes.iter() {
                let chunk = n.get("text").and_then(Value::as_str).unwrap_or("");
                let end = text.len(txn);
                text.insert_with_attributes(txn, end, chunk, marks_to_attrs(n));
            }
        }
        Unit::El(node) => {
            let tag = node.get("type").and_then(Value::as_str).unwrap_or("paragraph");
            let el = parent.insert(txn, index, XmlElementPrelim::empty(tag));
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
        }
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
            XmlOut::Element(el) => out.push(element_json(&el, txn)),
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

fn element_json<T: ReadTxn>(el: &yrs::XmlElementRef, txn: &T) -> Value {
    let mut node = Map::new();
    node.insert("type".into(), Value::from(el.tag().as_ref()));
    let attrs: Map<String, Value> = el.attributes(txn).map(|(k, v)| (k.to_string(), json_of(&v))).filter(|(_, v)| !v.is_null()).collect();
    if !attrs.is_empty() {
        node.insert("attrs".into(), Value::Object(attrs));
    }
    let content = read_children(el, txn);
    if !content.is_empty() {
        node.insert("content".into(), Value::Array(content));
    }
    Value::Object(node)
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
    fn knows_when_local_has_something_the_remote_lacks() {
        let base = from_note(&note(rich()));
        assert!(!has_more_than(&base, &base).unwrap());
        // título novo aqui
        let mut n = to_note("n1", &base).unwrap();
        n.title = "Outro".into();
        let edited = update(&base, &n, false).unwrap();
        assert!(has_more_than(&edited, &base).unwrap());
        assert!(!has_more_than(&base, &edited).unwrap(), "o remoto já tem tudo do base");
        // só apagar duas letras (nenhum conteúdo novo, só exclusão) também conta
        let doc = load(&base).unwrap();
        let frag = doc.get_or_insert_xml_fragment(BODY);
        {
            let mut t = doc.transact_mut();
            let Some(XmlOut::Element(p)) = frag.get(&t, 0) else { panic!("parágrafo") };
            let Some(XmlOut::Text(x)) = p.get(&t, 0) else { panic!("texto") };
            x.remove_range(&mut t, 0, 2);
        }
        let deleted_only = encode(&doc);
        assert_eq!(doc.transact().state_vector(), load(&base).unwrap().transact().state_vector(), "nada novo");
        assert!(has_more_than(&deleted_only, &base).unwrap());
        // depois de juntar, nenhum lado tem mais nada
        let merged = apply(&edited, &base).unwrap();
        assert!(!has_more_than(&merged, &edited).unwrap());
    }

    #[test]
    fn same_note_created_on_two_devices_merges_without_duplicating() {
        let a = from_note(&note(rich()));
        let b = from_note(&note(rich()));
        // (os bytes podem variar na ordem dos atributos de um mapa; os itens e os autores são os mesmos)
        assert_eq!(load(&a).unwrap().transact().state_vector(), load(&b).unwrap().transact().state_vector(), "mesmo conteúdo, mesmo autor");
        assert_eq!(to_note("n1", &apply(&a, &b).unwrap()).unwrap().body, note(rich()).body);
        assert!(!has_more_than(&apply(&a, &b).unwrap(), &a).unwrap());
        // conteúdo diferente: autores diferentes, o merge guarda os dois (nada some, nada se confunde)
        let mut other = note(rich());
        other.title = "Feira".into();
        let c = from_note(&other);
        let merged = to_note("n1", &apply(&a, &c).unwrap()).unwrap();
        let count = |v: &Value| v.to_string().matches("Arroz").count();
        assert_eq!(count(&merged.body), 2);
    }

    fn cat(id: &str, name: &str, color: &str) -> CategoryRow {
        CategoryRow { id: id.into(), name: name.into(), color: color.into(), sort: 0, deleted: false, hidden: false, pin: None }
    }

    #[test]
    fn categories_merge_field_by_field() {
        let base = write_categories(&[], &[cat("c1", "Casa", "#C26A3D"), cat("c2", "Trabalho", "#3D63D6")]).unwrap();
        assert_eq!(read_categories(&base).unwrap(), vec![cat("c1", "Casa", "#C26A3D"), cat("c2", "Trabalho", "#3D63D6")]);
        assert_eq!(write_categories(&base, &read_categories(&base).unwrap()).unwrap(), base, "sem mudança, o estado fica igual");
        // um aparelho renomeia, o outro muda a cor e apaga a outra
        let a = write_categories(&base, &[cat("c1", "Lar", "#C26A3D")]).unwrap();
        let mut gone = cat("c2", "Trabalho", "#3D63D6");
        gone.deleted = true;
        let b = write_categories(&base, &[cat("c1", "Casa", "#4F8A3E"), gone.clone()]).unwrap();
        let merged = apply(&a, &b).unwrap();
        assert_eq!(read_categories(&merged).unwrap(), vec![cat("c1", "Lar", "#4F8A3E"), gone]);
        assert_eq!(read_categories(&merged).unwrap(), read_categories(&apply(&b, &a).unwrap()).unwrap());
        // ocultar num aparelho e pôr PIN no outro: os dois ficam
        let mut hidden = cat("c1", "Lar", "#4F8A3E");
        hidden.hidden = true;
        let x = write_categories(&merged, &[hidden]).unwrap();
        let mut locked = cat("c1", "Lar", "#4F8A3E");
        locked.pin = Some("abc".into());
        let y = write_categories(&merged, &[locked]).unwrap();
        let both = read_categories(&apply(&x, &y).unwrap()).unwrap();
        assert!(both[0].hidden && both[0].pin.as_deref() == Some("abc"), "{both:?}");
    }

    #[test]
    fn checking_an_item_only_touches_that_item() {
        // A nota aberta no editor (outra cópia) recebe só a mudança do item, não o corpo de novo.
        let base = from_note(&note(rich()));
        let mut n = to_note("n1", &base).unwrap();
        n.body["content"][1]["content"][1]["attrs"]["checked"] = json!(true);
        let after = update(&base, &n, true).unwrap();
        assert_eq!(to_note("n1", &after).unwrap().body, n.body);
        let diff = {
            let doc = load(&after).unwrap();
            let sv = load(&base).unwrap().transact().state_vector();
            let d = doc.transact().encode_state_as_update_v1(&sv);
            d
        };
        let text = String::from_utf8_lossy(&diff);
        assert!(!text.contains("Arroz") && !text.contains("Café") && !text.contains("mundo"), "o texto não foi regravado");
        // e a mudança é pequena (só o atributo)
        assert!(diff.len() < 60, "{} bytes", diff.len());
    }

    #[test]
    fn edit_while_someone_types_keeps_both() {
        // O editor digita no 1º parágrafo enquanto, ao mesmo tempo, o MCP marca um item e põe uma linha no fim.
        let base = from_note(&note(rich()));
        let typed = type_text(&base, 0, 0, "Oi! ");
        let mut n = to_note("n1", &base).unwrap();
        n.body["content"][1]["content"][1]["attrs"]["checked"] = json!(true);
        n.body["content"].as_array_mut().unwrap().push(json!({"type":"paragraph","content":[{"type":"text","text":"fim"}]}));
        let mcp = update(&base, &n, true).unwrap();
        let merged = to_note("n1", &apply(&typed, &mcp).unwrap()).unwrap().body;
        let s = merged.to_string();
        assert_eq!(s.matches("Arroz").count(), 1, "nada duplicado: {s}");
        assert!(s.contains("Oi! Olá"), "{s}");
        assert_eq!(merged["content"][1]["content"][1]["attrs"]["checked"], json!(true));
        assert_eq!(merged["content"].as_array().unwrap().last().unwrap()["content"][0]["text"], json!("fim"));
    }

    #[test]
    fn adding_an_item_in_the_middle_inserts_only_it() {
        let base = from_note(&note(rich()));
        let mut n = to_note("n1", &base).unwrap();
        let item = json!({"type":"taskItem","attrs":{"checked":false},"content":[{"type":"paragraph","content":[{"type":"text","text":"Feijão"}]}]});
        n.body["content"][1]["content"].as_array_mut().unwrap().insert(1, item);
        let after = update(&base, &n, true).unwrap();
        assert_eq!(to_note("n1", &after).unwrap().body, n.body);
        let sv = load(&base).unwrap().transact().state_vector();
        let diff = load(&after).unwrap().transact().encode_state_as_update_v1(&sv);
        let text = String::from_utf8_lossy(&diff);
        assert!(text.contains("Feijão") && !text.contains("Arroz") && !text.contains("Café"));
    }

    #[test]
    fn attribute_that_went_away_is_removed() {
        let code = |attrs: Value| json!({"type":"doc","content":[{"type":"codeBlock","attrs":attrs,"content":[{"type":"text","text":"x = 1"}]}]});
        let base = from_note(&note(code(json!({"language":"rust"}))));
        let mut n = to_note("n1", &base).unwrap();
        n.body = code(json!({"language":null}));
        let after = update(&base, &n, true).unwrap();
        assert_eq!(to_note("n1", &after).unwrap().body, json!({"type":"doc","content":[{"type":"codeBlock","content":[{"type":"text","text":"x = 1"}]}]}));
    }

    proptest::proptest! {
        #![proptest_config(proptest::prelude::ProptestConfig::with_cases(200))]
        #[test]
        fn update_writes_exactly_the_new_body(a in crate::testdoc::doc(false), b in crate::testdoc::doc(false)) {
            let base = from_note(&note(a));
            let mut n = to_note("n1", &base).unwrap();
            n.body = b.clone();
            let after = update(&base, &n, true).unwrap();
            proptest::prop_assert_eq!(canon(&to_note("n1", &after).unwrap().body), canon(&b));
            // gravar o mesmo de novo não muda nada
            let again = update(&after, &n, true).unwrap();
            let sv = load(&after).unwrap().transact().state_vector();
            proptest::prop_assert_eq!(load(&again).unwrap().transact().state_vector(), sv);
        }
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
