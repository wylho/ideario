// Android: o botão Voltar faz o que o Esc faz (fecha a nota, a gaveta, as configurações, o visualizador, o diálogo,
// a seleção), uma camada por vez. Enquanto houver algo aberto, há uma entrada a mais no histórico da página: o Voltar
// a consome (popstate) em vez de fechar o app. Sem nada aberto, o Voltar sai do app, como em qualquer outro.
import { app } from './app.svelte'

const open = () => !!(app.editor || app.settingsOpen || app.drawerOpen || app.lightbox || app.dialog || app.selected.size)

if (document.documentElement.dataset.platform === 'android') {
  let armed = false
  /** O próximo popstate é nosso (a camada fechou pela tela e a entrada extra saiu): ignora. */
  let ours = false
  $effect.root(() => {
    $effect(() => {
      const now = open()
      if (now && !armed) {
        history.pushState({ ideario: 'layer' }, '')
        armed = true
      } else if (!now && armed) {
        armed = false
        ours = true
        history.back()
      }
    })
  })
  window.addEventListener('popstate', () => {
    if (ours) {
      ours = false
      return
    }
    armed = false
    const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))
    // Ainda há camada aberta: volta a guardar a entrada para o próximo Voltar.
    queueMicrotask(() => {
      if (open() && !armed) {
        history.pushState({ ideario: 'layer' }, '')
        armed = true
      }
    })
  })
}
