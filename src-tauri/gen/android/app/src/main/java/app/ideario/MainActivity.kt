package app.ideario

import android.os.Bundle
import androidx.activity.enableEdgeToEdge

// Tela toda em todas as versões (do Android 15 em diante é obrigatório): o SystemBarsPlugin deixa a página só na área
// livre entre as barras do sistema e pinta a área atrás delas com a cor do tema.
class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }
}
