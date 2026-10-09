//! Núcleo do Ideário (SPEC §4). Na Fase 0 só abre a janela; a UI usa dados de exemplo.
//! Próximos módulos: `db` (SQLite + FTS5), `notes` (Y.Doc via yrs), `media`, `sync`, `reminders`, `import`.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![app_version])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Ideário");
}

/// Versão do núcleo, para a UI confirmar que o IPC está de pé.
#[tauri::command]
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
