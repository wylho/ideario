//! Núcleo do Ideario (SPEC §4). Na Fase 0 só abre a janela; a UI usa dados de exemplo.
//! Próximos módulos: `db` (SQLite + FTS5), `notes` (Y.Doc via yrs), `media`, `sync`, `reminders`, `import`.

mod system_fonts;
mod system_theme;

use tauri::WebviewWindowBuilder;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // A janela é criada aqui (e não pelo tauri.conf.json) para receber as fontes e as cores do
            // sistema antes de a página carregar, sem troca visível de fonte ou de cor.
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == "main")
                .cloned()
                .expect("janela main ausente no tauri.conf.json");
            WebviewWindowBuilder::from_config(app.handle(), &config)?
                .initialization_script(format!("{}\n{}", system_fonts::init_script(), system_theme::init_script()))
                .build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![app_version])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Ideario");
}

/// Versão do núcleo, para a UI confirmar que o IPC está de pé.
#[tauri::command]
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
