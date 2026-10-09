// Tema escolhido pelo usuário: claro, escuro ou seguir o sistema.
// Fica no aparelho (cada computador ou celular tem o seu) e é aplicado antes da primeira pintura.
import { isTauri } from '@tauri-apps/api/core'

export type ThemePref = 'system' | 'light' | 'dark'

const KEY = 'ideario.theme'

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

function apply(pref: ThemePref) {
  const root = document.documentElement
  if (pref === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', pref)
  // Barra de título e controles nativos da janela acompanham o tema.
  if (isTauri()) {
    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => getCurrentWindow().setTheme(pref === 'system' ? null : pref))
      .catch(() => {})
  }
}

class Theme {
  pref = $state<ThemePref>(read())

  constructor() {
    apply(this.pref)
  }

  set(pref: ThemePref) {
    this.pref = pref
    apply(pref)
    try {
      localStorage.setItem(KEY, pref)
    } catch {
      // sem armazenamento: vale só nesta sessão
    }
  }
}

export const theme = new Theme()
