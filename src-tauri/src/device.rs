//! Arquivos no Android (`FilesPlugin.kt` em `gen/android`): lá não há "salvar em" com um caminho (o diálogo do sistema
//! devolve um content://). Baixar um anexo vai para Downloads; exportar uma nota abre o "Compartilhar" do sistema;
//! imprimir abre a impressão do sistema (que também salva em PDF). No desktop nada disso passa por aqui.

#[cfg(target_os = "android")]
mod android {
    use serde::de::DeserializeOwned;
    use tauri::plugin::{PluginHandle, TauriPlugin};
    use tauri::{AppHandle, Manager, Wry};

    pub(crate) struct Files(PluginHandle<Wry>);

    pub(crate) fn plugin() -> TauriPlugin<Wry> {
        tauri::plugin::Builder::<Wry>::new("files")
            .setup(|app, api| {
                app.manage(Files(api.register_android_plugin("app.ideario", "FilesPlugin")?));
                Ok(())
            })
            .build()
    }

    /// Chama o plugin numa linha à parte: a chamada espera a linha principal do Android, nunca pode partir dela.
    pub(crate) async fn call<T: DeserializeOwned + Send + 'static>(app: &AppHandle, cmd: &'static str, args: serde_json::Value) -> Result<T, String> {
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || app.state::<Files>().0.run_mobile_plugin::<T>(cmd, args).map_err(|e| e.to_string()))
            .await
            .map_err(|e| e.to_string())?
    }
}

#[cfg(target_os = "android")]
pub(crate) use android::{call, plugin};

/// Tipo do arquivo exportado, para o "Compartilhar" oferecer os apps certos.
#[cfg_attr(not(any(target_os = "android", test)), allow(dead_code))]
pub(crate) fn mime_of_export(name: &str) -> &'static str {
    match name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).as_deref() {
        Some("zip") => "application/zip",
        Some("md") => "text/markdown",
        Some("html") => "text/html",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn export_mime() {
        assert_eq!(super::mime_of_export("Nota.ZIP"), "application/zip");
        assert_eq!(super::mime_of_export("a.b.md"), "text/markdown");
        assert_eq!(super::mime_of_export("pagina.html"), "text/html");
        assert_eq!(super::mime_of_export("sem extensão"), "application/octet-stream");
    }
}
