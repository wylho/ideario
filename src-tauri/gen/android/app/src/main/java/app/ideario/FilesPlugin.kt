package app.ideario

import android.app.Activity
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Environment
import android.print.PrintAttributes
import android.print.PrintManager
import android.provider.MediaStore
import android.webkit.WebView
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class SaveArgs {
  /** Arquivo pronto (na pasta do app). */
  var path: String = ""
  /** Nome que ele terá em Downloads. */
  var name: String = ""
  var mime: String? = null
}

@InvokeArg
class ShareArgs {
  var path: String = ""
  var mime: String? = null
  var title: String? = null
}

@InvokeArg
class PrintArgs {
  var title: String = "Nota"
}

/**
 * Arquivos no Android, onde não há "salvar em" com um caminho: o diálogo do sistema devolve um content://, que o
 * núcleo não sabe gravar. Então: baixar um anexo vai para Downloads (pelo MediaStore, sem pedir permissão); exportar
 * uma nota abre o "Compartilhar" do sistema (Arquivos, Drive, e-mail…); imprimir abre a impressão do sistema, que
 * também salva em PDF.
 */
@TauriPlugin
class FilesPlugin(private val activity: Activity) : Plugin(activity) {
  private var webView: WebView? = null

  override fun load(webView: WebView) {
    super.load(webView)
    this.webView = webView
  }

  @Command
  fun saveToDownloads(invoke: Invoke) {
    val args = invoke.parseArgs(SaveArgs::class.java)
    try {
      val src = File(args.path)
      val mime = args.mime ?: "application/octet-stream"
      val name =
        if (Build.VERSION.SDK_INT >= 29) {
          val resolver = activity.contentResolver
          val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, args.name)
            put(MediaStore.Downloads.MIME_TYPE, mime)
            put(MediaStore.Downloads.IS_PENDING, 1)
          }
          val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: throw IllegalStateException("Downloads indisponível")
          resolver.openOutputStream(uri)?.use { out -> src.inputStream().use { it.copyTo(out) } }
            ?: throw IllegalStateException("Downloads indisponível")
          resolver.update(uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
          // O sistema renomeia se já houver um arquivo com o mesmo nome ("foto (1).jpg").
          resolver.query(uri, arrayOf(MediaStore.Downloads.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null
          } ?: args.name
        } else {
          @Suppress("DEPRECATION")
          val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
          dir.mkdirs()
          val dot = args.name.lastIndexOf('.')
          val (stem, ext) = if (dot > 0) args.name.substring(0, dot) to args.name.substring(dot) else args.name to ""
          var dest = File(dir, args.name)
          var i = 1
          while (dest.exists()) dest = File(dir, "$stem (${i++})$ext")
          src.copyTo(dest)
          dest.name
        }
      val ret = JSObject()
      ret.put("name", name)
      invoke.resolve(ret)
    } catch (e: Exception) {
      invoke.reject(e.message ?: "Não foi possível salvar em Downloads")
    }
  }

  @Command
  fun share(invoke: Invoke) {
    val args = invoke.parseArgs(ShareArgs::class.java)
    activity.runOnUiThread {
      try {
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", File(args.path))
        val send = Intent(Intent.ACTION_SEND).apply {
          type = args.mime ?: "application/octet-stream"
          putExtra(Intent.EXTRA_STREAM, uri)
          args.title?.let { putExtra(Intent.EXTRA_SUBJECT, it) }
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        activity.startActivity(Intent.createChooser(send, args.title))
        invoke.resolve()
      } catch (e: Exception) {
        invoke.reject(e.message ?: "Não foi possível compartilhar")
      }
    }
  }

  @Command
  fun print(invoke: Invoke) {
    val args = invoke.parseArgs(PrintArgs::class.java)
    activity.runOnUiThread {
      val wv = webView
      if (wv == null) {
        invoke.reject("Página indisponível")
        return@runOnUiThread
      }
      try {
        val pm = activity.getSystemService(Context.PRINT_SERVICE) as PrintManager
        pm.print(args.title, wv.createPrintDocumentAdapter(args.title), PrintAttributes.Builder().build())
        invoke.resolve()
      } catch (e: Exception) {
        invoke.reject(e.message ?: "Não foi possível imprimir")
      }
    }
  }
}
