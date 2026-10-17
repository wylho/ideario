//! Atualização automática (desktop). O app pergunta ao `latest.json` do último Release do GitHub se há versão nova;
//! a UI mostra o aviso e, quando a pessoa aceita, baixa, confere a assinatura (chave pública no `tauri.conf.json`),
//! instala e reinicia. No Linux só vale para o AppImage: quem instalou o `.deb` ou o `.rpm` atualiza pelo `apt`/`dnf`
//! (repositório do Ideario), e o app não mexe no que o gerenciador de pacotes instalou.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// A versão encontrada na última consulta, guardada até a pessoa pedir para instalar.
#[derive(Default)]
pub struct Updates(Mutex<Option<Update>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    version: String,
    notes: Option<String>,
}

/// Este jeito de instalar se atualiza sozinho? (No Linux, só o AppImage; ele avisa onde está pelo `APPIMAGE`.)
fn self_updating() -> bool {
    !cfg!(target_os = "linux") || std::env::var_os("APPIMAGE").is_some()
}

/// Há versão nova? `None` também quando este jeito de instalar não se atualiza sozinho.
#[tauri::command]
pub async fn update_check(app: AppHandle, state: State<'_, Updates>) -> Result<Option<UpdateInfo>, String> {
    if !self_updating() {
        return Ok(None);
    }
    let found = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    let info = found.as_ref().map(|u| UpdateInfo { version: u.version.clone(), notes: u.body.clone() });
    *state.0.lock().map_err(|e| e.to_string())? = found;
    Ok(info)
}

/// Baixa (evento `update-progress` = `[baixados, total]`, total 0 se o servidor não disser), instala e reinicia o app. No Windows o instalador fecha o app sozinho.
#[tauri::command]
pub async fn update_install(app: AppHandle, state: State<'_, Updates>) -> Result<(), String> {
    let update = state.0.lock().map_err(|e| e.to_string())?.take().ok_or("Nenhuma atualização encontrada.")?;
    let mut done = 0u64;
    let emitter = app.clone();
    update
        .download_and_install(
            move |chunk, total| {
                done += chunk as u64;
                let _ = emitter.emit("update-progress", (done, total.unwrap_or(0)));
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
    app.restart()
}

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    app.plugin(tauri_plugin_updater::Builder::new().build())?;
    app.manage(Updates::default());
    Ok(())
}
