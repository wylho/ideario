package app.ideario

import android.os.Bundle

// Sem "edge-to-edge": a barra de status e a de navegação do sistema ficam fora da página (a interface não precisa
// abrir espaço para elas).
class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
  }
}
