//! "Compartilhar" do Android para o Ideario (`SharePlugin.kt` em `gen/android`): texto, link, fotos e arquivos que
//! outro app mandou viram uma nota nova. A página pergunta ao abrir e ao voltar para a frente. No desktop não há.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

/// O que chegou: assunto (vira o título), texto e os caminhos das cópias dos arquivos.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Shared {
    subject: Option<String>,
    text: Option<String>,
    #[serde(default)]
    files: Vec<String>,
    /// Tocou na notificação de um lembrete: a nota a abrir.
    note: Option<String>,
}

#[cfg(target_os = "android")]
mod android {
    use tauri::plugin::{PluginHandle, TauriPlugin};
    use tauri::{Manager, Wry};

    pub(crate) struct Share(pub PluginHandle<Wry>);

    #[derive(serde::Deserialize)]
    pub(crate) struct Taken {
        pub shared: Option<super::Shared>,
    }

    pub(crate) fn plugin() -> TauriPlugin<Wry> {
        tauri::plugin::Builder::<Wry>::new("share")
            .setup(|app, api| {
                app.manage(Share(api.register_android_plugin("app.ideario", "SharePlugin")?));
                Ok(())
            })
            .build()
    }
}

#[cfg(target_os = "android")]
pub(crate) use android::plugin;

/// O que outro app compartilhou e ainda não virou nota (uma vez só).
#[tauri::command]
pub async fn take_shared(app: AppHandle) -> Result<Option<Shared>, String> {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        return tauri::async_runtime::spawn_blocking(move || {
            app.state::<android::Share>()
                .0
                .run_mobile_plugin::<android::Taken>("take", ())
                .map(|t| t.shared)
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(None)
    }
}
