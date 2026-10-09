// Tema (paleta de cores) e aparência (claro, escuro ou automático), escolhidos pelo usuário.
// Ficam no aparelho (cada computador ou celular tem o seu) e são aplicados antes da primeira pintura.
// Aplicar é só gravar ~25 variáveis CSS no <html>: nenhum componente muda, nada roda em segundo plano.
import { isTauri } from '@tauri-apps/api/core'
import { cssVars, DESKTOPS, fitAccent, PALETTES, type Colors, type DesktopId, type Mode, type PaletteId } from './palettes'

/** Aparência: claro, escuro ou acompanhar o sistema. */
export type ThemePref = 'system' | 'light' | 'dark'

/** O que o núcleo Rust leu da área de trabalho (src-tauri/src/system_theme.rs). */
export interface SystemTheme {
  desktop?: DesktopId | null
  /** Cor de destaque do sistema, se houver. */
  accent?: string | null
  /** KDE: o esquema de cores em uso (claro ou escuro) — fundo, superfície, texto. */
  scheme?: { mode: Mode; colors: Partial<Colors> } | null
}

declare global {
  interface Window {
    __IDEARIO_SYSTEM_THEME__?: SystemTheme
  }
}

const MODE_KEY = 'ideario.theme'
const PALETTE_KEY = 'ideario.palette'
const SIM_KEY = 'ideario.simDesktop'

const load = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const store = (key: string, v: string) => {
  try {
    localStorage.setItem(key, v)
  } catch {
    // sem armazenamento: vale só nesta sessão
  }
}

const readMode = (): ThemePref => {
  const v = load(MODE_KEY)
  return v === 'light' || v === 'dark' ? v : 'system'
}
const readPalette = (): PaletteId => {
  const v = load(PALETTE_KEY)
  return v === 'system' || (v && v in PALETTES) ? (v as PaletteId) : 'system'
}

/** No navegador (prévia), adivinha a área de trabalho pelo user agent; dá para trocar nas Configurações. */
function guessDesktop(): DesktopId {
  const saved = load(SIM_KEY)
  if (saved && saved in DESKTOPS) return saved as DesktopId
  const ua = navigator.userAgent
  return /Mac/.test(ua) ? 'macos' : /Windows/.test(ua) ? 'windows' : 'gnome'
}

const darkQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null

/** Cores do tema Sistema: paleta da área de trabalho + destaque do sistema (+ esquema do KDE, se houver). */
export function systemColors(sys: SystemTheme, mode: Mode): Colors {
  const d = DESKTOPS[sys.desktop ?? 'gnome']
  const base = { ...d[mode] }
  if (sys.scheme?.mode === mode) Object.assign(base, sys.scheme.colors)
  const accent = sys.accent ?? (mode === 'light' ? d.light.accent : d.dark.accent)
  base.accent = fitAccent(accent, mode, base.surface)
  delete base.accentSoft
  delete base.onAccent
  return base
}

export function paletteColors(id: PaletteId, mode: Mode, sys: SystemTheme): Colors {
  return id === 'system' ? systemColors(sys, mode) : PALETTES[id][mode]
}

class Theme {
  /** Aparência. O nome `pref` fica por compatibilidade com o que já está gravado. */
  pref = $state<ThemePref>(readMode())
  palette = $state<PaletteId>(readPalette())
  /** Só na prévia do navegador: qual área de trabalho o tema Sistema imita. */
  simDesktop = $state<DesktopId>(guessDesktop())
  private osDark = $state(darkQuery?.matches ?? false)

  readonly native = isTauri()

  get mode(): Mode {
    return this.pref === 'system' ? (this.osDark ? 'dark' : 'light') : this.pref
  }

  get system(): SystemTheme {
    return this.native ? (window.__IDEARIO_SYSTEM_THEME__ ?? {}) : { desktop: this.simDesktop }
  }

  constructor() {
    darkQuery?.addEventListener('change', (e) => {
      this.osDark = e.matches
      this.apply()
    })
    this.apply()
  }

  set(pref: ThemePref) {
    this.pref = pref
    store(MODE_KEY, pref)
    this.apply()
  }

  setPalette(id: PaletteId) {
    this.palette = id
    store(PALETTE_KEY, id)
    this.apply()
  }

  setSimDesktop(id: DesktopId) {
    this.simDesktop = id
    store(SIM_KEY, id)
    this.apply()
  }

  private apply() {
    const root = document.documentElement
    const mode = this.mode
    for (const [k, v] of Object.entries(cssVars(paletteColors(this.palette, mode, this.system), mode))) root.style.setProperty(k, v)
    // color-scheme (barras de rolagem, campos nativos) e o seletor [data-theme] do CSS.
    if (this.pref === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', this.pref)
    root.style.colorScheme = mode
    // Barra de título e controles nativos da janela acompanham a aparência.
    if (this.native) {
      const pref = this.pref
      import('@tauri-apps/api/window')
        .then(({ getCurrentWindow }) => getCurrentWindow().setTheme(pref === 'system' ? null : pref))
        .catch(() => {})
    }
  }
}

export const theme = new Theme()
