//! Atualização no Android (pedido do usuário: "autoatualizar no android também"). O atualizador do Tauri (`updates.rs`)
//! não existe no celular, então o app faz o mesmo à mão: pergunta ao `latest.json` do último Release qual é a versão
//! nova (o mesmo arquivo do desktop), baixa o `Ideario_<versão>_android.apk` desse Release para o cache e entrega ao
//! instalador do Android (`UpdatePlugin.kt`, pelo `PackageInstaller`). O Android só aceita o APK por cima se ele for
//! assinado pela mesma chave do app instalado: um arquivo trocado no caminho não instala. A pessoa confirma no aviso do
//! sistema (na primeira vez, permite "instalar apps desta fonte"); do Android 12 em diante, as seguintes podem entrar
//! sem confirmação, quando o próprio Ideario foi quem instalou a anterior.
//!
//! A UI é a mesma do desktop: os comandos têm os mesmos nomes (`update_check`, `update_install`) e o progresso vai
//! no mesmo evento (`update-progress`).

use serde::Serialize;
use serde_json::Value;

const REPO: &str = "https://github.com/wylho/ideario/releases";

/// O `latest.json` do último Release publicado (o GitHub só aponta para Releases publicados, nunca para rascunhos).
#[cfg_attr(not(any(target_os = "android", test)), allow(dead_code))]
fn latest_url() -> String {
    format!("{REPO}/latest/download/latest.json")
}

/// O APK de uma versão, com o nome que o workflow Release dá a ele.
#[cfg_attr(not(any(target_os = "android", test)), allow(dead_code))]
fn apk_url(version: &str) -> String {
    format!("{REPO}/download/v{version}/Ideario_{version}_android.apk")
}

/// "0.8.2" → (0, 8, 2). Aceita o "v" na frente e ignora o que vem depois de "-" ou "+".
fn parts(version: &str) -> Option<(u64, u64, u64)> {
    let core = version.trim().trim_start_matches('v').split(['-', '+']).next()?;
    let mut it = core.split('.').map(|p| p.parse::<u64>().ok());
    let v = (it.next()??, it.next().unwrap_or(Some(0))?, it.next().unwrap_or(Some(0))?);
    it.next().is_none().then_some(v)
}

/// `latest` é mais nova que `current`? Versão que não dá para ler nunca é "mais nova".
#[cfg_attr(not(any(target_os = "android", test)), allow(dead_code))]
fn newer(current: &str, latest: &str) -> bool {
    matches!((parts(current), parts(latest)), (Some(c), Some(l)) if l > c)
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateInfo {
    version: String,
    notes: Option<String>,
}

/// Versão e notas do `latest.json`.
#[cfg_attr(not(any(target_os = "android", test)), allow(dead_code))]
fn read_latest(json: &Value) -> Option<UpdateInfo> {
    let version = json.get("version")?.as_str()?.trim().trim_start_matches('v').to_string();
    parts(&version)?;
    let notes = json.get("notes").and_then(Value::as_str).map(str::to_string).filter(|n| !n.trim().is_empty());
    Some(UpdateInfo { version, notes })
}

#[cfg(target_os = "android")]
mod android {
    use std::io::{Read, Write};
    use std::sync::Mutex;

    use tauri::plugin::{PluginHandle, TauriPlugin};
    use tauri::{AppHandle, Emitter, Manager, State, Wry};

    use super::UpdateInfo;

    pub(crate) struct Installer(PluginHandle<Wry>);

    /// A versão achada pela última consulta, até a pessoa pedir para instalar.
    #[derive(Default)]
    pub(crate) struct Found(Mutex<Option<String>>);

    pub(crate) fn plugin() -> TauriPlugin<Wry> {
        tauri::plugin::Builder::<Wry>::new("apkupdate")
            .setup(|app, api| {
                app.manage(Installer(api.register_android_plugin("app.ideario", "UpdatePlugin")?));
                app.manage(Found::default());
                Ok(())
            })
            .build()
    }

    fn agent() -> ureq::Agent {
        ureq::AgentBuilder::new().timeout_connect(std::time::Duration::from_secs(15)).build()
    }

    /// Há versão nova? Sem rede ou sem Release, `None` (tenta de novo na próxima abertura).
    #[tauri::command]
    pub(crate) async fn update_check(app: AppHandle, found: State<'_, Found>) -> Result<Option<UpdateInfo>, String> {
        let current = app.package_info().version.to_string();
        let latest = tauri::async_runtime::spawn_blocking(|| -> Result<Option<UpdateInfo>, String> {
            let json: serde_json::Value =
                agent().get(&super::latest_url()).call().map_err(|e| e.to_string())?.into_json().map_err(|e| e.to_string())?;
            Ok(super::read_latest(&json))
        })
        .await
        .map_err(|e| e.to_string())??;
        let info = latest.filter(|l| super::newer(&current, &l.version));
        *found.0.lock().map_err(|e| e.to_string())? = info.as_ref().map(|i| i.version.clone());
        Ok(info)
    }

    /// Baixa o APK (evento `update-progress` = `[baixados, total]`) e entrega ao instalador do Android. Volta quando a
    /// instalação termina ou é recusada; se der certo, o Android fecha o app para trocar a versão.
    #[tauri::command]
    pub(crate) async fn update_install(app: AppHandle, found: State<'_, Found>) -> Result<(), String> {
        let version = found.0.lock().map_err(|e| e.to_string())?.clone().ok_or("Nenhuma atualização encontrada.")?;
        let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("updates");
        let path = dir.join(format!("Ideario_{version}_android.apk"));
        let emitter = app.clone();
        let file = path.clone();
        tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
            // Só o APK desta versão fica no cache (um download que parou no meio recomeça).
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            let res = agent().get(&super::apk_url(&version)).call().map_err(|e| e.to_string())?;
            let total: u64 = res.header("Content-Length").and_then(|v| v.parse().ok()).unwrap_or(0);
            let mut body = res.into_reader();
            let part = file.with_extension("part");
            let mut out = std::fs::File::create(&part).map_err(|e| e.to_string())?;
            let mut buf = vec![0u8; 64 * 1024];
            let mut done = 0u64;
            loop {
                let n = body.read(&mut buf).map_err(|e| e.to_string())?;
                if n == 0 {
                    break;
                }
                out.write_all(&buf[..n]).map_err(|e| e.to_string())?;
                done += n as u64;
                let _ = emitter.emit("update-progress", (done, total));
            }
            out.sync_all().map_err(|e| e.to_string())?;
            if total > 0 && done != total {
                return Err("O download parou no meio.".into());
            }
            std::fs::rename(&part, &file).map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())??;
        let app2 = app.clone();
        let apk = path.to_string_lossy().into_owned();
        tauri::async_runtime::spawn_blocking(move || {
            app2.state::<Installer>()
                .0
                .run_mobile_plugin::<serde_json::Value>("install", serde_json::json!({ "path": apk }))
                .map(|_| ())
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }
}

#[cfg(target_os = "android")]
pub(crate) use android::{plugin, update_check, update_install};

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn only_a_higher_version_is_newer() {
        assert!(newer("0.8.2", "0.8.3"));
        assert!(newer("0.8.2", "0.9.0"));
        assert!(newer("0.8.9", "0.8.10"), "número, não texto");
        assert!(newer("0.8.2", "v1.0.0"));
        assert!(!newer("0.8.2", "0.8.2"));
        assert!(!newer("0.8.3", "0.8.2"));
        assert!(!newer("0.8.2", "lixo"));
        assert!(!newer("0.8.2", ""));
        assert!(!newer("0.8.2", "0.8.2.1"), "versão com quatro partes não é lida");
        assert!(newer("0.8.2", "0.9.0-beta"), "o que vem depois do - não conta");
    }

    #[test]
    fn reads_version_and_notes_of_latest_json() {
        let j = json!({"version": "v0.9.0", "notes": "Novidades", "platforms": {}});
        assert_eq!(read_latest(&j), Some(UpdateInfo { version: "0.9.0".into(), notes: Some("Novidades".into()) }));
        assert_eq!(read_latest(&json!({"version": "0.9.0", "notes": "  "})).unwrap().notes, None);
        assert_eq!(read_latest(&json!({"notes": "sem versão"})), None);
        assert_eq!(read_latest(&json!({"version": "nova"})), None);
    }

    #[test]
    fn apk_is_the_one_the_release_workflow_uploads() {
        assert_eq!(apk_url("0.9.0"), "https://github.com/wylho/ideario/releases/download/v0.9.0/Ideario_0.9.0_android.apk");
        assert_eq!(latest_url(), "https://github.com/wylho/ideario/releases/latest/download/latest.json");
        // O nome do APK no Release sai do workflow: se mudar lá, tem que mudar aqui.
        let workflow = include_str!("../../.github/workflows/release.yml");
        assert!(workflow.contains("Ideario_${version}_android.apk"), "o release.yml não sobe mais o APK com esse nome");
    }
}
