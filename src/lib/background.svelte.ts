// Segundo plano: ao fechar a janela, o Ideario continua aberto com ícone na bandeja (ou na barra de menus do Mac).
// É uma escolha do aparelho (fica nele, como o tema). O núcleo Rust cuida do ícone e de esconder a janela.
import { invoke, isTauri } from '@tauri-apps/api/core'
import { app } from './app.svelte'

const KEY = 'ideario.background'

const read = () => {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

class Background {
  enabled = $state(read())

  constructor() {
    if (!isTauri()) return
    void invoke('set_background', { enabled: this.enabled }).catch(() => {})
    // "Nova nota" no menu do ícone da bandeja.
    void import('@tauri-apps/api/event').then(({ listen }) => listen('new-note', () => app.openNew()))
  }

  set(v: boolean) {
    this.enabled = v
    try {
      localStorage.setItem(KEY, v ? '1' : '0')
    } catch {
      // sem armazenamento: vale só nesta sessão
    }
    if (isTauri()) void invoke('set_background', { enabled: v }).catch(() => app.say('Não foi possível criar o ícone na bandeja'))
  }
}

export const background = new Background()
