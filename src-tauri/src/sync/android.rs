//! Login Google no Android (SPEC §6): a conta do aparelho, pelo Google Play Services (plugin Kotlin
//! `GoogleAuthPlugin`, em `gen/android`). Não há token de renovação no app: o sistema guarda a permissão e entrega um
//! token de acesso quando o sync pede. O cliente OAuth "Android" (pacote + SHA-1 da chave do APK) autoriza o app.

use serde::{Deserialize, Serialize};
use tauri::plugin::{PluginHandle, TauriPlugin};
use tauri::{Manager, Wry};

use super::drive::Tokens;
use super::{SResult, SyncError};

const USERINFO_URL: &str = "https://openidconnect.googleapis.com/v1/userinfo";

/// Ponte para o plugin Kotlin (gerenciada pelo Tauri).
pub(crate) struct GoogleAuth(PluginHandle<Wry>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthorizeArgs {
    interactive: bool,
    stale: Option<String>,
}

#[derive(Deserialize)]
struct Authorized {
    access: String,
}

impl GoogleAuth {
    /// Token de acesso. `interactive` deixa o Android mostrar a escolha da conta e a permissão; `stale` é o token que
    /// o Drive recusou (sai do cache do sistema). Bloqueia: nunca chamar na linha principal.
    fn authorize(&self, interactive: bool, stale: Option<String>) -> SResult<String> {
        self.0
            .run_mobile_plugin::<Authorized>("authorize", AuthorizeArgs { interactive, stale })
            .map(|a| a.access)
            .map_err(|e| match e {
                tauri::plugin::mobile::PluginInvokeError::InvokeRejected(r) => match r.code.as_deref() {
                    Some("needs-consent") => SyncError::Unauthorized,
                    _ => SyncError::Other(r.message.unwrap_or_else(|| "Não foi possível entrar com o Google.".into())),
                },
                e => SyncError::Other(e.to_string()),
            })
    }
}

pub(crate) fn plugin() -> TauriPlugin<Wry> {
    tauri::plugin::Builder::<Wry>::new("google-auth")
        .setup(|app, api| {
            app.manage(GoogleAuth(api.register_android_plugin("app.ideario", "GoogleAuthPlugin")?));
            Ok(())
        })
        .build()
}

/// Login ativo no Android: guarda o último token e pede outro ao sistema quando o Drive recusa.
pub(crate) struct AndroidSession {
    app: tauri::AppHandle,
    access: Option<String>,
}

impl AndroidSession {
    pub fn new(app: tauri::AppHandle, access: Option<String>) -> Self {
        AndroidSession { app, access }
    }
}

impl Tokens for AndroidSession {
    fn access(&mut self, renew: bool) -> SResult<String> {
        if !renew {
            if let Some(t) = &self.access {
                return Ok(t.clone());
            }
        }
        let stale = if renew { self.access.take() } else { None };
        let token = self.app.state::<GoogleAuth>().authorize(false, stale)?;
        self.access = Some(token.clone());
        Ok(token)
    }
}

/// "Entrar com o Google": mostra a conta e a permissão; devolve o token e o e-mail da conta.
pub(crate) fn sign_in(app: &tauri::AppHandle) -> SResult<(String, String)> {
    let token = app.state::<GoogleAuth>().authorize(true, None)?;
    let email = super::drive::agent()
        .get(USERINFO_URL)
        .set("Authorization", &format!("Bearer {token}"))
        .call()
        .ok()
        .and_then(|r| r.into_json::<serde_json::Value>().ok())
        .and_then(|v| v["email"].as_str().map(str::to_string))
        .unwrap_or_default();
    Ok((token, email))
}
