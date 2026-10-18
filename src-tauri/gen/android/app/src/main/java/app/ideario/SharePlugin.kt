package app.ideario

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.webkit.WebView
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import org.json.JSONObject

private const val HANDLED = "ideario.handled"

/**
 * "Compartilhar" do Android para o Ideario: texto, link, fotos e arquivos viram uma nota nova. Os arquivos chegam
 * como content:// (só este app pode ler, e só agora): são copiados para uma pasta temporária e a página os anexa
 * pelo caminho, como os arrastados no desktop. A página busca o que chegou ao abrir e ao voltar para a frente.
 */
@TauriPlugin
class SharePlugin(private val activity: Activity) : Plugin(activity) {
  private var pending: JSObject? = null

  override fun load(webView: WebView) {
    super.load(webView)
    handle(activity.intent)
  }

  override fun onNewIntent(intent: Intent) {
    handle(intent)
  }

  @Command
  fun take(invoke: Invoke) {
    val ret = JSObject()
    pending?.let { ret.put("shared", it) }
    pending = null
    invoke.resolve(ret)
  }

  private fun handle(intent: Intent?) {
    if (intent != null && noteFromNotification(intent)) return
    if (intent == null || (intent.action != Intent.ACTION_SEND && intent.action != Intent.ACTION_SEND_MULTIPLE)) return
    val data = JSObject()
    intent.getStringExtra(Intent.EXTRA_SUBJECT)?.let { data.put("subject", it) }
    intent.getStringExtra(Intent.EXTRA_TEXT)?.let { data.put("text", it) }
    val dir = File(activity.cacheDir, "compartilhado")
    dir.deleteRecursively()
    dir.mkdirs()
    val files = JSArray()
    for ((i, uri) in streams(intent).withIndex()) {
      runCatching {
        val out = File(dir, "$i-${nameOf(uri)}")
        activity.contentResolver.openInputStream(uri)?.use { input -> out.outputStream().use { input.copyTo(it) } }
        if (out.exists()) files.put(out.absolutePath)
      }
    }
    data.put("files", files)
    // Já tratado: girar a tela ou voltar ao app não cria a mesma nota de novo.
    intent.action = null
    pending = data
  }

  /** Tocou na notificação de um lembrete (agendada pelo plugin de notificação, com a nota em `extra.note`). */
  private fun noteFromNotification(intent: Intent): Boolean {
    if (intent.getBooleanExtra(HANDLED, false)) return false
    val json = intent.getStringExtra("LocalNotficationObject") ?: return false
    val note = runCatching { JSONObject(json).optJSONObject("extra")?.optString("note") }.getOrNull()
    if (note.isNullOrEmpty()) return false
    // Já tratado: voltar ao app ou girar a tela não abre a nota de novo.
    intent.putExtra(HANDLED, true)
    val data = JSObject()
    data.put("note", note)
    data.put("files", JSArray())
    pending = data
    return true
  }

  @Suppress("DEPRECATION")
  private fun streams(intent: Intent): List<Uri> =
    if (intent.action == Intent.ACTION_SEND_MULTIPLE) {
      if (Build.VERSION.SDK_INT >= 33) intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java) ?: emptyList()
      else intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM) ?: emptyList()
    } else {
      val uri = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
      else intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
      listOfNotNull(uri)
    }

  private fun nameOf(uri: Uri): String {
    activity.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
      if (c.moveToFirst()) c.getString(0)?.let { return it.replace('/', '_') }
    }
    return uri.lastPathSegment?.substringAfterLast('/') ?: "arquivo"
  }
}
