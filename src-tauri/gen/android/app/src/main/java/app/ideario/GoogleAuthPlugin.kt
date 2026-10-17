package app.ideario

import android.app.Activity
import androidx.activity.result.ActivityResult
import androidx.activity.result.IntentSenderRequest
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.android.gms.auth.GoogleAuthUtil
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.Scope

@InvokeArg
class AuthorizeArgs {
  /** Pode mostrar a tela de escolher a conta e dar permissão (no "Entrar com o Google"); no sync, nunca. */
  var interactive: Boolean = false
  /** Token que o Drive recusou: sai do cache do Google Play para o próximo ser novo. */
  var stale: String? = null
}

/**
 * Login do Google no Android (sync com o Drive, SPEC §6). Usa a conta do aparelho pelo Google Play Services
 * (AuthorizationClient): sem navegador e sem token de renovação no app; o próprio sistema guarda a permissão e
 * entrega um token de acesso novo quando o núcleo pede. O cliente OAuth "Android" do projeto (pacote + SHA-1 da
 * chave que assina o APK) é o que autoriza este app.
 */
@TauriPlugin
class GoogleAuthPlugin(private val activity: Activity) : Plugin(activity) {
  private val scopes = listOf(
    Scope("https://www.googleapis.com/auth/drive.appdata"),
    Scope("email"),
    Scope("openid"),
  )

  @Command
  fun authorize(invoke: Invoke) {
    val args = invoke.parseArgs(AuthorizeArgs::class.java)
    // clearToken não pode rodar na linha principal.
    Thread {
      args.stale?.let { runCatching { GoogleAuthUtil.clearToken(activity, it) } }
      activity.runOnUiThread { request(invoke, args.interactive) }
    }.start()
  }

  private fun request(invoke: Invoke, interactive: Boolean) {
    val req = AuthorizationRequest.builder().setRequestedScopes(scopes).build()
    Identity.getAuthorizationClient(activity).authorize(req)
      .addOnSuccessListener { result ->
        val pending = result.pendingIntent
        if (result.hasResolution() && pending != null) {
          if (!interactive) {
            invoke.reject("Entre de novo com o Google nas Configurações.", "needs-consent")
          } else {
            startIntentSenderForResult(invoke, IntentSenderRequest.Builder(pending.intentSender).build(), "onConsent")
          }
        } else {
          resolve(invoke, result)
        }
      }
      .addOnFailureListener { e -> invoke.reject(e.message ?: "Não foi possível entrar com o Google.", "failed") }
  }

  @ActivityCallback
  private fun onConsent(invoke: Invoke, result: ActivityResult) {
    try {
      val auth = Identity.getAuthorizationClient(activity).getAuthorizationResultFromIntent(result.data)
      resolve(invoke, auth)
    } catch (e: Exception) {
      invoke.reject("Login cancelado.", "cancelled")
    }
  }

  private fun resolve(invoke: Invoke, result: AuthorizationResult) {
    val token = result.accessToken
    if (token == null) {
      invoke.reject("O Google não devolveu o acesso.", "failed")
      return
    }
    val ret = JSObject()
    ret.put("access", token)
    invoke.resolve(ret)
  }
}
