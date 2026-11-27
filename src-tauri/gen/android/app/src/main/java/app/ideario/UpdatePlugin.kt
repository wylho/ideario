package app.ideario

import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class InstallArgs {
  /** O APK já baixado (no cache do app). */
  var path: String = ""
}

/**
 * Instala a versão nova do Ideario (`apk_update.rs` baixa o APK do Release). Vai pelo `PackageInstaller`, e não pelo
 * "abrir o APK": assim o próprio Ideario fica sendo quem instalou o app, e do Android 12 em diante as próximas
 * atualizações podem entrar sem pedir confirmação. Quando o sistema precisa da pessoa (a primeira vez, ou quando
 * não dá para pular), mostra o aviso de instalar dele. O Android só aceita o APK se for assinado pela mesma chave do
 * app instalado.
 */
@TauriPlugin
class UpdatePlugin(private val activity: Activity) : Plugin(activity) {

  @Command
  fun install(invoke: Invoke) {
    val args = invoke.parseArgs(InstallArgs::class.java)
    val pm = activity.packageManager
    // "Instalar apps desta fonte" ainda não foi permitido para o Ideario: abre a tela do sistema e pede para tentar
    // de novo depois (a UI mostra o recado pelo código "install-permission").
    if (Build.VERSION.SDK_INT >= 26 && !pm.canRequestPackageInstalls()) {
      activity.runOnUiThread {
        try {
          activity.startActivity(
            Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}"))
          )
        } catch (_: Exception) {
        }
      }
      invoke.reject("install-permission")
      return
    }
    // Gravar o APK na sessão leva um tempo: fora da linha principal.
    Thread {
      try {
        val installer = pm.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setAppPackageName(activity.packageName)
        if (Build.VERSION.SDK_INT >= 31) {
          params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        }
        val id = installer.createSession(params)
        val session = installer.openSession(id)
        try {
          val file = File(args.path)
          session.openWrite("ideario.apk", 0, file.length()).use { out ->
            file.inputStream().use { it.copyTo(out) }
            session.fsync(out)
          }
          val action = "${activity.packageName}.UPDATE_STATUS.$id"
          val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
              when (val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
                PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                  val confirm: Intent? =
                    if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                    else @Suppress("DEPRECATION") intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
                  if (confirm == null) {
                    finish(this)
                    invoke.reject("O Android não mostrou o aviso de instalar.")
                  } else {
                    // O aviso do sistema; o resultado (instalou ou não) chega aqui de novo depois.
                    confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    activity.startActivity(confirm)
                  }
                }
                PackageInstaller.STATUS_SUCCESS -> {
                  finish(this)
                  invoke.resolve()
                }
                else -> {
                  finish(this)
                  val msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
                  invoke.reject(
                    if (status == PackageInstaller.STATUS_FAILURE_ABORTED) "install-cancelled"
                    else msg ?: "A instalação não terminou (código $status)."
                  )
                }
              }
            }
          }
          ContextCompat.registerReceiver(activity, receiver, IntentFilter(action), ContextCompat.RECEIVER_NOT_EXPORTED)
          val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
          val pending = PendingIntent.getBroadcast(activity, id, Intent(action).setPackage(activity.packageName), flags)
          session.commit(pending.intentSender)
        } finally {
          session.close()
        }
      } catch (e: Exception) {
        invoke.reject(e.message ?: "Não foi possível instalar a atualização.")
      }
    }.start()
  }

  private fun finish(receiver: BroadcastReceiver) {
    try {
      activity.unregisterReceiver(receiver)
    } catch (_: Exception) {
    }
  }
}
