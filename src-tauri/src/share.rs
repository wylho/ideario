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
    /// Número da notificação tocada (o plugin de notificação não devolve a nota): `take_shared` troca pela nota.
    #[serde(default, skip_serializing)]
    #[cfg_attr(not(target_os = "android"), allow(dead_code))]
    notification: Option<i32>,
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
            let mut shared = app
                .state::<android::Share>()
                .0
                .run_mobile_plugin::<android::Taken>("take", ())
                .map(|t| t.shared)
                .map_err(|e| e.to_string())?;
            if let Some(s) = shared.as_mut().filter(|s| s.note.is_none()) {
                if let Some(key) = s.notification {
                    s.note = app
                        .state::<crate::commands::Core>()
                        .with(|st| crate::reminders::note_for_key(st, key))
                        .ok()
                        .flatten();
                }
            }
            Ok(shared)
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
