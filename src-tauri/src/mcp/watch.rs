//! App aberto: percebe o que o MCP (outro processo, `ideario --mcp`) mudou no banco e atualiza a tela na hora,
//! com os mesmos eventos do sync (a nota aberta no editor junta a mudança no Y.Doc dela).

use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

use crate::commands::Core;
use crate::store::ExternalChange;

/// De quanto em quanto tempo olha (só um `PRAGMA data_version`: não custa nada).
const EVERY: Duration = Duration::from_millis(400);

pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let core = app.state::<Core>();
        // O que o MCP fez com o app fechado já está no banco: a tela abre com tudo, não precisa avisar.
        let _ = core.with(|s| s.forget_external(i64::MAX));
        let mut version = core.with(|s| s.data_version()).unwrap_or(0);
        loop {
            std::thread::sleep(EVERY);
            // Muda quando outra conexão grava (o MCP; as gravações do próprio app não contam).
            let Ok(v) = core.with(|s| s.data_version()) else { continue };
            if v == version {
                continue;
            }
            version = v;
            let Ok(changes) = core.with(|s| s.external_after(0)) else { continue };
            let Some(last) = changes.last().map(|c| c.seq) else { continue };
            let _ = core.with(|s| s.forget_external(last));
            let (changed, removed) = split(&changes);
            if !removed.is_empty() {
                let _ = app.emit("notes-removed", &removed);
            }
            if !changed.is_empty() {
                let _ = app.emit("notes-synced", &changed);
            }
            let _ = app.emit("core-changed", ());
        }
    });
}

/// Notas mudadas e notas apagadas (sem repetir; a apagada não volta como mudada).
pub(crate) fn split(changes: &[ExternalChange]) -> (Vec<String>, Vec<String>) {
    let mut changed: Vec<String> = Vec::new();
    let mut removed: Vec<String> = Vec::new();
    for c in changes {
        let Some(id) = &c.note_id else { continue };
        if c.removed {
            changed.retain(|x| x != id);
            if !removed.contains(id) {
                removed.push(id.clone());
            }
        } else if !changed.contains(id) && !removed.contains(id) {
            changed.push(id.clone());
        }
    }
    (changed, removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ch(seq: i64, id: Option<&str>, removed: bool) -> ExternalChange {
        ExternalChange { seq, note_id: id.map(str::to_string), removed }
    }

    #[test]
    fn changed_and_removed_without_repeats() {
        let (changed, removed) = split(&[ch(1, Some("a"), false), ch(2, Some("b"), false), ch(3, Some("a"), false), ch(4, None, false), ch(5, Some("b"), true)]);
        assert_eq!(changed, vec!["a"]);
        assert_eq!(removed, vec!["b"]);
    }
}
