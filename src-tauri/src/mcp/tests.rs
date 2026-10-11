//! O MCP de ponta a ponta: mensagens JSON-RPC como o Claude manda, num banco de verdade (pasta temporária).

use std::path::PathBuf;

use serde_json::{json, Value};

use super::handle;
use crate::commands::Core;

struct Tmp(PathBuf);

impl Drop for Tmp {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn setup() -> (Core, Tmp) {
    let dir = std::env::temp_dir().join(format!("ideario-mcp-{}", uuid::Uuid::now_v7()));
    (Core::open(dir.clone()).unwrap(), Tmp(dir))
}

fn rpc(core: &Core, method: &str, params: Value) -> Value {
    let line = json!({ "jsonrpc": "2.0", "id": 7, "method": method, "params": params }).to_string();
    let reply: Value = serde_json::from_str(&handle(core, &line).expect("resposta")).unwrap();
    assert_eq!(reply["id"], 7);
    reply
}

/// Chama a ferramenta e devolve o texto; `ok` diz se deve dar certo.
fn tool(core: &Core, name: &str, args: Value, ok: bool) -> String {
    let r = rpc(core, "tools/call", json!({ "name": name, "arguments": args }));
    let res = &r["result"];
    assert_eq!(res["isError"].as_bool().unwrap_or(false), !ok, "{name}: {res}");
    res["content"].as_array().unwrap().iter().filter_map(|c| c["text"].as_str()).collect::<Vec<_>>().join("\n")
}

fn json_of(text: &str) -> Value {
    serde_json::from_str(text).unwrap()
}

/// O id que vem na primeira linha "id: …" de uma nota.
fn id_in(text: &str) -> String {
    text.lines().find_map(|l| l.strip_prefix("id: ")).unwrap().to_string()
}

fn body_md(text: &str) -> String {
    text.splitn(3, "---\n").nth(2).unwrap_or("").to_string()
}

#[test]
fn speaks_the_protocol() {
    let (core, _t) = setup();
    let init = rpc(&core, "initialize", json!({ "protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": { "name": "t", "version": "1" } }));
    assert_eq!(init["result"]["protocolVersion"], "2025-03-26");
    assert_eq!(init["result"]["serverInfo"]["name"], "ideario");
    assert!(init["result"]["capabilities"]["tools"].is_object());
    // versão que não conhecemos: a nossa mais nova
    assert_eq!(rpc(&core, "initialize", json!({ "protocolVersion": "1999-01-01" }))["result"]["protocolVersion"], "2025-06-18");
    // notificação não tem resposta
    assert!(handle(&core, r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#).is_none());
    assert_eq!(rpc(&core, "ping", json!({}))["result"], json!({}));
    assert_eq!(rpc(&core, "nada/disso", json!({}))["error"]["code"], -32601);
    let bad: Value = serde_json::from_str(&handle(&core, "{ quebrado").unwrap()).unwrap();
    assert_eq!(bad["error"]["code"], -32700);
    // ferramentas: todas com esquema de objeto e as dicas de só-leitura
    let tools = rpc(&core, "tools/list", json!({}))["result"]["tools"].as_array().unwrap().clone();
    assert!(tools.len() >= 30, "{}", tools.len());
    for t in &tools {
        assert_eq!(t["inputSchema"]["type"], "object", "{}", t["name"]);
        for r in t["inputSchema"]["required"].as_array().unwrap() {
            assert!(t["inputSchema"]["properties"].get(r.as_str().unwrap()).is_some(), "{}: {r} sem definição", t["name"]);
        }
    }
    let read_only: Vec<&str> = tools.iter().filter(|t| t["annotations"]["readOnlyHint"] == true).map(|t| t["name"].as_str().unwrap()).collect();
    assert!(read_only.contains(&"search_notes") && !read_only.contains(&"create_note"));
    assert!(tool(&core, "nao_existe", json!({}), false).contains("desconhecida"));
}

#[test]
fn create_read_search_and_edit() {
    let (core, _t) = setup();
    tool(&core, "create_category", json!({ "name": "Casa", "color": "Verde" }), true);
    let created = tool(
        &core,
        "create_note",
        json!({
            "title": "Mercado",
            "content": "Para sábado:\n\n- [ ] Leite\n- [ ] Pão\n  - [ ] Integral\n- [x] Café #compras",
            "category": "casa",
            "tags": ["semana", "#Semana"],
            "color": "sky",
        }),
        true,
    );
    let id = id_in(&created);
    assert!(created.contains("categoria: Casa") && created.contains("cor: sky"), "{created}");
    assert!(created.contains("tags: compras, semana"), "tags manuais (sem repetir) e a #tag do texto: {created}");
    assert_eq!(body_md(&created), "Para sábado:\n\n- [ ] Leite\n- [ ] Pão\n  - [ ] Integral\n- [x] Café #compras");
    // busca sem acento, por prefixo
    let found = json_of(&tool(&core, "search_notes", json!({ "query": "cafe" }), true));
    assert_eq!(found["total"], 1);
    assert_eq!(found["notes"][0]["id"], id);
    assert_eq!(found["notes"][0]["category"], "Casa");
    assert!(json_of(&tool(&core, "search_notes", json!({ "tag": "semana" }), true))["total"] == 1);
    // sem categoria / sem tags: a nota de boas-vindas (a do mercado tem as duas coisas... até tirar a categoria)
    let orphans = json_of(&tool(&core, "search_notes", json!({ "no_category": true, "no_tags": true }), true));
    assert!(orphans["notes"].as_array().unwrap().iter().all(|n| n["id"] != id));
    assert!(tool(&core, "search_notes", json!({ "category": "Trabalho" }), false).contains("Existem: Casa"));
    // trocar um trecho: só aquele
    tool(&core, "edit_note_text", json!({ "id": id, "find": "Para sábado:", "replace": "Para **domingo**:" }), true);
    let note = tool(&core, "get_note", json!({ "id": id }), true);
    assert!(note.contains("Para **domingo**:"), "{note}");
    assert!(tool(&core, "edit_note_text", json!({ "id": id, "find": "não tem isso", "replace": "x" }), false).contains("O Markdown atual"));
    assert!(tool(&core, "edit_note_text", json!({ "id": id, "find": "- [ ] ", "replace": "- [x] " }), false).contains("aparece 3 vezes"));
    // acrescentar e reescrever
    tool(&core, "append_to_note", json!({ "id": id, "content": "### Depois\n\nver preços" }), true);
    assert!(body_md(&tool(&core, "get_note", json!({ "id": id }), true)).ends_with("### Depois\n\nver preços"));
    tool(&core, "update_note", json!({ "id": id, "title": "Feira", "pinned": true, "category": "" }), true);
    let n = tool(&core, "get_note", json!({ "id": id }), true);
    assert!(n.contains("título: Feira") && n.contains("fixada: sim") && !n.contains("categoria:"), "{n}");
    assert!(tool(&core, "get_note", json!({ "id": "x" }), false).contains("search_notes"));
}

#[test]
fn cover_emoji() {
    let (core, _t) = setup();
    let created = tool(&core, "create_note", json!({ "title": "Receitas", "content": "bolo", "emoji": "🍰" }), true);
    let id = id_in(&created);
    assert!(created.contains("emoji: 🍰"), "{created}");
    let found = json_of(&tool(&core, "search_notes", json!({ "query": "receitas" }), true));
    assert_eq!(found["notes"][0]["emoji"], "🍰");
    tool(&core, "update_note", json!({ "id": id, "emoji": "🇧🇷" }), true);
    assert!(tool(&core, "get_note", json!({ "id": id }), true).contains("emoji: 🇧🇷"));
    assert!(tool(&core, "update_note", json!({ "id": id, "emoji": "bolo" }), false).contains("não é um emoji"));
    tool(&core, "update_note", json!({ "id": id, "emoji": "" }), true);
    assert!(!tool(&core, "get_note", json!({ "id": id }), true).contains("emoji:"));
}

#[test]
fn checklist_tools() {
    let (core, _t) = setup();
    let id = id_in(&tool(&core, "create_note", json!({ "title": "Viagem", "content": "- [ ] Documentos\n  - [ ] Passaporte\n  - [ ] RG\n- [ ] Mala" }), true));
    // marcar o pai marca os filhos (como no app); sem acento e maiúsculas tanto faz
    let r = tool(&core, "set_checklist_items", json!({ "id": id, "items": [{ "text": "documentos", "checked": true }] }), true);
    assert!(r.contains("- [x] Documentos\n  - [x] Passaporte\n  - [x] RG\n- [ ] Mala"), "{r}");
    // pedaço que só um item tem
    tool(&core, "set_checklist_items", json!({ "id": id, "items": [{ "text": "porte", "checked": false }] }), true);
    assert!(tool(&core, "get_note", json!({ "id": id }), true).contains("- [ ] Passaporte"));
    assert!(tool(&core, "set_checklist_items", json!({ "id": id, "items": [{ "text": "a", "checked": true }] }), false).contains("combina com"));
    assert!(tool(&core, "set_checklist_items", json!({ "id": id, "items": [{ "text": "Escova", "checked": true }] }), false).contains("Itens:"));
    // acrescentar no fim e como subitem
    tool(&core, "add_checklist_items", json!({ "id": id, "items": ["Carregador", "**Remédios**"] }), true);
    tool(&core, "add_checklist_items", json!({ "id": id, "items": ["Roupas de frio"], "under": "Mala" }), true);
    let md = body_md(&tool(&core, "get_note", json!({ "id": id }), true));
    assert!(md.ends_with("- [ ] Mala\n  - [ ] Roupas de frio\n- [ ] Carregador\n- [ ] **Remédios**"), "{md}");
    // tirar os marcados (com os subitens) e um pelo nome
    tool(&core, "set_checklist_items", json!({ "id": id, "items": [{ "text": "Documentos", "checked": true }] }), true);
    tool(&core, "remove_checklist_items", json!({ "id": id, "checked_only": true }), true);
    tool(&core, "remove_checklist_items", json!({ "id": id, "items": ["carregador"] }), true);
    let md = body_md(&tool(&core, "get_note", json!({ "id": id }), true));
    assert_eq!(md, "- [ ] Mala\n  - [ ] Roupas de frio\n- [ ] **Remédios**");
    // nota sem checklist ganha um
    let plain = id_in(&tool(&core, "create_note", json!({ "title": "Vazia" }), true));
    tool(&core, "add_checklist_items", json!({ "id": plain, "items": ["um"] }), true);
    assert_eq!(body_md(&tool(&core, "get_note", json!({ "id": plain }), true)), "- [ ] um");
    // tirar tudo: a nota fica com um parágrafo vazio, não com um checklist vazio
    tool(&core, "remove_checklist_items", json!({ "id": plain, "items": ["um"] }), true);
    assert_eq!(body_md(&tool(&core, "get_note", json!({ "id": plain }), true)), "&nbsp;");
}

#[test]
fn archive_trash_and_delete_forever_only_from_trash() {
    let (core, _t) = setup();
    let id = id_in(&tool(&core, "create_note", json!({ "title": "Rascunho" }), true));
    assert!(tool(&core, "delete_note_forever", json!({ "id": id }), false).contains("Lixeira"));
    tool(&core, "move_note", json!({ "id": id, "to": "archived" }), true);
    assert_eq!(json_of(&tool(&core, "search_notes", json!({ "where": "archived" }), true))["total"], 1);
    tool(&core, "move_note", json!({ "id": id, "to": "trash" }), true);
    assert_eq!(json_of(&tool(&core, "search_notes", json!({ "where": "trash" }), true))["total"], 1);
    tool(&core, "move_note", json!({ "id": id, "to": "active" }), true);
    assert!(tool(&core, "get_note", json!({ "id": id }), true).contains("onde: Notas"));
    tool(&core, "move_note", json!({ "id": id, "to": "trash" }), true);
    tool(&core, "delete_note_forever", json!({ "id": id }), true);
    assert!(tool(&core, "get_note", json!({ "id": id }), false).contains("não existe"));
    // o app aberto fica sabendo (apagada)
    let changes = core.with(|s| s.external_after(0)).unwrap();
    assert!(changes.iter().any(|c| c.note_id.as_deref() == Some(id.as_str()) && c.removed));
}

#[test]
fn reminders() {
    let (core, _t) = setup();
    let id = id_in(&tool(&core, "create_note", json!({ "title": "Remédio", "reminder": "2030-01-06T08:00", "repeat": "week" }), true));
    let n = tool(&core, "get_note", json!({ "id": id }), true);
    assert!(n.contains("lembrete: 2030-01-06T08:00:00") && n.contains("(domingo), toda semana"), "{n}");
    let done = tool(&core, "complete_reminder", json!({ "id": id }), true);
    assert!(done.contains("próximo é 2030-01-13T08:00:00"), "o que se repete pula uma semana: {done}");
    tool(&core, "snooze_reminder", json!({ "id": id, "minutes": 10 }), true);
    let list = json_of(&tool(&core, "list_reminders", json!({}), true));
    assert_eq!(list["reminders"][0]["id"], id);
    tool(&core, "set_reminder", json!({ "id": id, "at": "2031-02-03" }), true);
    assert!(tool(&core, "get_note", json!({ "id": id }), true).contains("lembrete: 2031-02-03T09:00:00"), "só a data = 9h");
    tool(&core, "clear_reminder", json!({ "id": id }), true);
    assert!(!tool(&core, "get_note", json!({ "id": id }), true).contains("lembrete:"));
    assert!(tool(&core, "set_reminder", json!({ "id": id, "at": "amanhã" }), false).contains("ISO 8601"));
    assert!(tool(&core, "complete_reminder", json!({ "id": id }), false).contains("não tem lembrete"));
}

#[test]
fn categories_and_tags() {
    let (core, _t) = setup();
    tool(&core, "create_category", json!({ "name": "Trabalho" }), true);
    assert!(tool(&core, "create_category", json!({ "name": "trabalho" }), false).contains("já existe"));
    let id = id_in(&tool(&core, "create_note", json!({ "title": "Pauta", "content": "falar com #rh", "category": "Trabalho", "tags": ["reuniao"] }), true));
    tool(&core, "update_category", json!({ "category": "Trabalho", "name": "Escritório", "color": "#3D63D6" }), true);
    let cats = json_of(&tool(&core, "list_categories", json!({}), true));
    assert_eq!(cats[0]["name"], "Escritório");
    assert_eq!(cats[0]["colorName"], "Azul");
    assert_eq!(cats[0]["notes"], 1);
    tool(&core, "rename_tag", json!({ "from": "rh", "to": "pessoas" }), true);
    assert!(tool(&core, "get_note", json!({ "id": id }), true).contains("falar com #pessoas"), "a #tag do texto muda também");
    tool(&core, "delete_tag", json!({ "name": "reuniao" }), true);
    let tags = json_of(&tool(&core, "list_tags", json!({}), true));
    let names: Vec<&str> = tags.as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect();
    // (a nota de boas-vindas tem #tags no texto)
    assert!(names.contains(&"pessoas") && !names.contains(&"reuniao") && !names.contains(&"rh"), "{names:?}");
    tool(&core, "delete_category", json!({ "category": "escritorio" }), true);
    assert!(!tool(&core, "get_note", json!({ "id": id }), true).contains("categoria:"));
}

#[test]
fn attachments_in_and_out() {
    let (core, t) = setup();
    let id = id_in(&tool(&core, "create_note", json!({ "title": "Fotos", "content": "Viagem" }), true));
    // uma foto de verdade (PNG) e um texto
    let png = t.0.join("praia.png");
    image::RgbImage::from_fn(64, 48, |x, _| image::Rgb([(x * 4) as u8, 120, 200])).save(&png).unwrap();
    let txt = t.0.join("roteiro.md");
    std::fs::write(&txt, "# Dia 1\nPraia").unwrap();
    let a = json_of(&tool(&core, "attach_file", json!({ "id": id, "path": png.display().to_string() }), true));
    let hash = a["attached"]["hash"].as_str().unwrap().to_string();
    assert_eq!(a["attached"]["kind"], "image");
    tool(&core, "attach_file", json!({ "id": id, "path": txt.display().to_string() }), true);
    let md = body_md(&tool(&core, "get_note", json!({ "id": id }), true));
    assert!(md.starts_with("Viagem\n\n![praia.webp](ideario://att/") || md.starts_with("Viagem\n\n![praia"), "{md}");
    assert!(md.contains("[📎 roteiro.md](ideario://att/"), "{md}");
    // a foto volta como imagem
    let r = rpc(&core, "tools/call", json!({ "name": "get_attachment", "arguments": { "hash": hash } }));
    let content = r["result"]["content"].as_array().unwrap();
    assert_eq!(content[0]["type"], "image");
    assert!(content[0]["mimeType"].as_str().unwrap().starts_with("image/"));
    // o texto volta como texto
    let files = json_of(&tool(&core, "list_attachments", json!({ "note_id": id }), true));
    let doc = files.as_array().unwrap().iter().find(|f| f["kind"] == "doc").unwrap()["hash"].as_str().unwrap().to_string();
    assert!(tool(&core, "get_attachment", json!({ "hash": doc }), true).contains("# Dia 1\nPraia"));
    // salvar uma cópia numa pasta
    let out = t.0.join("saida");
    let saved = tool(&core, "export_attachment", json!({ "hash": doc, "folder": out.display().to_string() }), true);
    assert!(saved.contains("roteiro.md") && out.join("roteiro.md").exists());
    // reescrever a nota sem a linha da foto tira a foto do corpo; com a linha, ela fica
    let keep = md.replace("Viagem", "Viagem de verão");
    tool(&core, "update_note", json!({ "id": id, "content": keep }), true);
    assert!(body_md(&tool(&core, "get_note", json!({ "id": id }), true)).contains(&format!("ideario://att/{hash}")));
}

#[test]
fn pin_protected_categories_are_off_limits() {
    let (core, _t) = setup();
    let cat = core.with(|s| s.create_category("Senhas", "#C0392B")).unwrap();
    let id = id_in(&tool(&core, "create_note", json!({ "title": "Banco", "content": "agência 1234", "category": "Senhas" }), true));
    core.with(|s| s.set_category_pin(&cat.id, Some("2468"))).unwrap();
    // (o processo do MCP é outro: nunca está desbloqueado)
    core.with(|s| s.lock_category(&cat.id)).unwrap();
    assert!(tool(&core, "get_note", json!({ "id": id }), false).contains("protegida por PIN"));
    assert!(tool(&core, "edit_note_text", json!({ "id": id, "find": "1234", "replace": "x" }), false).contains("protegida"));
    assert!(tool(&core, "move_note", json!({ "id": id, "to": "trash" }), false).contains("protegida"));
    assert_eq!(json_of(&tool(&core, "search_notes", json!({ "query": "agencia" }), true))["total"], 0);
    assert_eq!(json_of(&tool(&core, "search_notes", json!({ "category": "Senhas" }), true))["total"], 0);
    assert!(tool(&core, "delete_category", json!({ "category": "Senhas" }), false).contains("protegida"));
    let cats = json_of(&tool(&core, "list_categories", json!({}), true));
    assert_eq!(cats[0]["protectedByPin"], true);
}

#[test]
fn export_from_the_mcp() {
    let (core, t) = setup();
    let id = id_in(&tool(&core, "create_note", json!({ "title": "Receita", "content": "- [ ] farinha" }), true));
    let out = json_of(&tool(&core, "export_note", json!({ "id": id, "format": "html", "folder": t.0.join("ex").display().to_string() }), true));
    let path = out["path"].as_str().unwrap();
    assert!(path.ends_with("Receita.html"), "sem anexo: um arquivo só");
    assert!(std::fs::read_to_string(path).unwrap().contains("<h1>Receita</h1>"));
}

#[test]
fn backup_from_the_mcp() {
    let (core, t) = setup();
    let out = json_of(&tool(&core, "create_backup", json!({ "folder": t.0.join("bk").display().to_string() }), true));
    assert_eq!(out["notes"], 1);
    assert!(std::path::Path::new(out["path"].as_str().unwrap()).is_file());
}

#[test]
fn overview_says_what_time_it_is() {
    let (core, _t) = setup();
    let o = json_of(&tool(&core, "app_overview", json!({}), true));
    assert!(o["agora"].as_str().unwrap().contains('T'));
    assert_eq!(o["notas"], 1, "a nota de boas-vindas");
}

/// O app (uma conexão) e o MCP (outra, outro processo) no mesmo banco: o app percebe e sabe o que mudou.
#[test]
fn the_open_app_notices_what_the_mcp_did() {
    let (app, t) = setup();
    let mcp = Core::open(t.0.clone()).unwrap();
    let v0 = app.with(|s| s.data_version()).unwrap();
    let id = id_in(&tool(&mcp, "create_note", json!({ "title": "Do Claude", "content": "- [ ] a" }), true));
    assert_ne!(app.with(|s| s.data_version()).unwrap(), v0, "o app vê que outro gravou");
    let changes = app.with(|s| s.external_after(0)).unwrap();
    let (changed, removed) = super::watch::split(&changes);
    assert_eq!(changed, vec![id.clone()]);
    assert!(removed.is_empty());
    // a nota aberta no app (editor digitando) e o MCP marcando o item ao mesmo tempo: as duas mudanças ficam
    let state = app.with(|s| s.ydoc(&id)).unwrap().unwrap();
    let seen = changes.last().unwrap().seq;
    tool(&mcp, "set_checklist_items", json!({ "id": id, "items": [{ "text": "a", "checked": true }] }), true);
    let after = app.with(|s| s.external_after(seen)).unwrap();
    assert_eq!(super::watch::split(&after).0, vec![id.clone()], "editar também avisa o app");
    let typed = crate::ydoc::type_text(&state, 9, 0, "do editor");
    app.with(|s| s.apply_update(&id, &typed)).unwrap();
    let md = body_md(&tool(&mcp, "get_note", json!({ "id": id }), true));
    assert_eq!(md, "- [x] a\n\ndo editor");
}

/// O app no meio de uma gravação e o MCP gravando ao mesmo tempo: o MCP espera a vez em vez de falhar.
#[test]
fn writing_while_the_app_writes_waits_instead_of_failing() {
    let (app, t) = setup();
    let mcp = Core::open(t.0.clone()).unwrap();
    app.with(|s| s.conn.execute_batch("BEGIN IMMEDIATE; UPDATE notes SET color = color;").map_err(|e| e.to_string())).unwrap();
    let done = std::thread::scope(|sc| {
        let h = sc.spawn(|| tool(&mcp, "create_note", json!({ "title": "Na fila" }), true));
        std::thread::sleep(std::time::Duration::from_millis(300));
        app.with(|s| s.conn.execute_batch("COMMIT").map_err(|e| e.to_string())).unwrap();
        h.join().unwrap()
    });
    assert!(done.contains("título: Na fila"));
}
