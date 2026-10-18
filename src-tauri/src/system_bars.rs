//! Android: cor e ícones das barras do sistema acompanham o tema do app (`SystemBarsPlugin.kt`, que também deixa a
//! página só na área livre entre as barras). No desktop não há o que fazer.

use tauri::AppHandle;

#[cfg(target_os = "android")]
mod android {
    use tauri::plugin::{PluginHandle, TauriPlugin};
    use tauri::{Manager, Wry};

    pub(crate) struct Bars(pub PluginHandle<Wry>);

    pub(crate) fn plugin() -> TauriPlugin<Wry> {
        tauri::plugin::Builder::<Wry>::new("system-bars")
            .setup(|app, api| {
                app.manage(Bars(api.register_android_plugin("app.ideario", "SystemBarsPlugin")?));
                Ok(())
            })
            .build()
    }
}

#[cfg(target_os = "android")]
pub(crate) use android::plugin;

/// Tema claro → ícones escuros; `color` pinta a área atrás das barras (o fundo do app).
#[tauri::command]
pub async fn set_system_bars(app: AppHandle, light: bool, color: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        return tauri::async_runtime::spawn_blocking(move || {
            app.state::<android::Bars>()
                .0
                .run_mobile_plugin::<serde_json::Value>("setBars", serde_json::json!({ "light": light, "color": color }))
                .map(|_| ())
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, light, color);
        Ok(())
    }
}
