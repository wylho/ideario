package app.ideario

import android.app.Activity
import android.graphics.Color
import android.view.View
import android.webkit.WebView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@InvokeArg
class BarsArgs {
  /** Tema claro: ícones escuros nas barras do sistema. */
  var light: Boolean = false
  /** Cor de fundo do app ("#rrggbb"), que pinta a área atrás das barras. */
  var color: String? = null
}

/**
 * Barras do sistema (status em cima, gestos/navegação embaixo). A partir do Android 15 o app ocupa a tela toda por
 * baixo delas; aqui a página fica só na área livre (o conteúdo ganha margem do tamanho das barras e do teclado, como
 * se a janela encolhesse) e a área atrás das barras tem a cor do tema, com os ícones legíveis no claro e no escuro.
 * Assim nada da interface (barra de cima, "+", abas, editor) precisa saber das barras.
 */
@TauriPlugin
class SystemBarsPlugin(private val activity: Activity) : Plugin(activity) {
  override fun load(webView: WebView) {
    super.load(webView)
    val root = activity.findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      // Com o teclado aberto, a parte de baixo é a do teclado (o texto digitado não fica escondido atrás dele).
      v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
      WindowInsetsCompat.CONSUMED
    }
    ViewCompat.requestApplyInsets(root)
  }

  @Command
  fun setBars(invoke: Invoke) {
    val args = invoke.parseArgs(BarsArgs::class.java)
    activity.runOnUiThread {
      val window = activity.window
      args.color?.let { c -> runCatching { Color.parseColor(c) }.getOrNull() }?.let { color ->
        activity.findViewById<View>(android.R.id.content).setBackgroundColor(color)
        window.decorView.setBackgroundColor(color)
      }
      WindowCompat.getInsetsController(window, window.decorView).apply {
        isAppearanceLightStatusBars = args.light
        isAppearanceLightNavigationBars = args.light
      }
      invoke.resolve()
    }
  }
}
