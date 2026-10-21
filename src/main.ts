import '@wylho/atrio/atrio.css'
import { mount } from 'svelte'
import App from './App.svelte'
import { applySystemFonts } from './lib/system-fonts'
import { setNotifier } from '@wylho/atrio'
import { app } from './lib/app.svelte'
import './lib/theme.svelte'
import './lib/background.svelte'
import './lib/share.svelte'
import './lib/backbutton.svelte'

applySystemFonts()
// Os avisos das peças do Atrio (microfone, câmera…) aparecem no toast do Ideario.
setNotifier((msg) => app.say(msg))

// Um app, não um site: sem o menu do navegador (Voltar, Recarregar, Inspecionar).
// Campos de texto e o editor mantêm o menu nativo (copiar, colar, corretor ortográfico).
// Os menus do Ideario tratam o evento antes, no próprio elemento.
document.addEventListener('contextmenu', (e) => {
  if ((e.target as Element).closest?.('input, textarea, [contenteditable="true"]')) return
  e.preventDefault()
})

export default mount(App, { target: document.getElementById('app')! })

// macOS: em tela cheia o sistema esconde os botões da janela; o espaço guardado para eles some junto.
if (document.documentElement.dataset.titlebar === 'overlay') {
  void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
    const w = getCurrentWindow()
    const sync = () =>
      w.isFullscreen().then((f) => document.documentElement.toggleAttribute('data-fullscreen', f)).catch(() => {})
    void sync()
    void w.onResized(sync)
  })
  // Lateral recolhida da largura do canto dos botões da janela, com a mesma folga dos dois lados (medida no núcleo).
  void import('@tauri-apps/api/core').then(({ invoke }) =>
    invoke<number | null>('mac_lights_width')
      .then((px) => {
        if (px) document.documentElement.style.setProperty('--rail-w', `${Math.round(px)}px`)
      })
      .catch(() => {}),
  )
}
