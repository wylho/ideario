//! Servidor MCP do Ideario: `ideario --mcp` conversa com o Claude (Desktop, Code…) por stdin/stdout, em JSON-RPC
//! (uma mensagem por linha), e mexe nas notas pelo mesmo núcleo do app, no mesmo banco local.
//!
//! Funciona com o app aberto ou fechado. Cada mudança fica anotada no banco (`external_changes`); o app aberto vê e
//! atualiza a tela na hora (`watch`), inclusive a nota aberta no editor (o Y.Doc junta as duas edições). O sync do
//! app leva tudo para o Drive como se tivesse sido feito nele.
//!
//! Apagar manda para a Lixeira; apagar para sempre, só o que já está lá (decisão do usuário).

pub mod setup;
mod tools;
pub mod watch;

use std::io::{BufRead, Write};
use std::path::PathBuf;

use serde_json::{json, Value};

use crate::commands::Core;

/// O mesmo `identifier` do tauri.conf.json: a pasta de dados é `<dados do usuário>/<identifier>`, como no app.
const IDENTIFIER: &str = "app.ideario.desktop";
/// Versões do protocolo que este servidor fala (a mais nova primeiro).
const PROTOCOLS: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];

/// Pasta de dados do app (a mesma que o Tauri usa: `app_data_dir`).
pub fn data_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|d| d.join(IDENTIFIER))
}

/// Roda o servidor até o cliente fechar a entrada. Devolve o código de saída do processo.
pub fn serve() -> i32 {
    let Some(data) = data_dir() else {
        eprintln!("ideario --mcp: não achei a pasta de dados do usuário");
        return 1;
    };
    let core = match Core::open(data) {
        Ok(core) => core,
        Err(e) => {
            eprintln!("ideario --mcp: não foi possível abrir o banco: {e}");
            return 1;
        }
    };
    let stdin = std::io::stdin();
    let mut out = std::io::stdout().lock();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if let Some(reply) = handle(&core, &line) {
            if writeln!(out, "{reply}").and_then(|_| out.flush()).is_err() {
                break;
            }
        }
    }
    0
}

/// Uma linha que chegou → a resposta (nenhuma para notificações).
pub(crate) fn handle(core: &Core, line: &str) -> Option<String> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }
    let msg: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(e) => return Some(error(Value::Null, -32700, &format!("JSON inválido: {e}")).to_string()),
    };
    // Lote (protocolo antigo): uma resposta com a lista.
    if let Value::Array(batch) = msg {
        let replies: Vec<Value> = batch.iter().filter_map(|m| respond(core, m)).collect();
        return (!replies.is_empty()).then(|| Value::Array(replies).to_string());
    }
    respond(core, &msg).map(|v| v.to_string())
}

fn respond(core: &Core, msg: &Value) -> Option<Value> {
    let method = msg.get("method").and_then(Value::as_str);
    let id = msg.get("id").cloned();
    let params = msg.get("params").cloned().unwrap_or(Value::Null);
    // Sem id: notificação (initialized, cancelled…), não tem resposta. Resposta a um pedido nosso: idem.
    let id = id?;
    let Some(method) = method else { return Some(error(id, -32600, "pedido sem método")) };
    let result = match method {
        "initialize" => Ok(initialize(&params)),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tools::list() })),
        "tools/call" => {
            let name = params.get("name").and_then(Value::as_str).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
            Ok(tools::call(core, name, &args))
        }
        "resources/list" => Ok(json!({ "resources": [] })),
        "resources/templates/list" => Ok(json!({ "resourceTemplates": [] })),
        "prompts/list" => Ok(json!({ "prompts": [] })),
        other => Err((-32601, format!("método desconhecido: {other}"))),
    };
    Some(match result {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err((code, message)) => error(id, code, &message),
    })
}

fn error(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn initialize(params: &Value) -> Value {
    let asked = params.get("protocolVersion").and_then(Value::as_str).unwrap_or("");
    let version = PROTOCOLS.iter().find(|v| **v == asked).copied().unwrap_or(PROTOCOLS[0]);
    json!({
        "protocolVersion": version,
        "capabilities": { "tools": { "listChanged": false } },
        "serverInfo": { "name": "ideario", "title": "Ideario", "version": env!("CARGO_PKG_VERSION") },
        "instructions": INSTRUCTIONS,
    })
}

const INSTRUCTIONS: &str = "Ideario é o app de notas do usuário (estilo Google Keep), local no computador dele e \
sincronizado pelo Google Drive. Notas têm título, corpo, categoria (só cor), tags, cor, fixada, arquivo/lixeira e \
lembrete (que pode se repetir). O corpo entra e sai em Markdown: `### título`, **negrito**, *itálico*, listas, \
checklist `- [ ]`/`- [x]` com subitens recuados (2 espaços), blocos de código; fotos `![nome](ideario://att/<hash>)` \
(várias na mesma linha ficam lado a lado) e anexos `[📎 nome](ideario://att/<hash>)` — mantenha essas linhas ao \
reescrever uma nota, senão a foto/anexo sai da nota. `#palavra` no texto vira tag. Para mudanças pequenas prefira \
edit_note_text, set_checklist_items e add_checklist_items (não reescrevem a nota inteira). Datas em ISO 8601 no fuso \
do usuário (ex.: 2026-10-11T09:00); app_overview diz a data e a hora de agora. Apagar manda para a Lixeira (30 dias); \
apagar para sempre só funciona para o que já está lá. A interface do app é em português do Brasil: escreva as notas \
no idioma do usuário.";

#[cfg(test)]
mod tests;
