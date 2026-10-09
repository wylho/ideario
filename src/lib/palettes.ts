// Temas de cor. Um tema só troca as variáveis de cor de app.css; nada além disso muda.
// Cada tema tem a versão clara e a escura. O tema "Sistema" parte da paleta da área de trabalho
// (GNOME, KDE, Windows, macOS) e usa a cor de destaque que o núcleo Rust lê do sistema.

export type PaletteId = 'system' | 'ideario' | 'papel' | 'grafite' | 'floresta'
export type Mode = 'light' | 'dark'
export type DesktopId = 'gnome' | 'kde' | 'windows' | 'macos'

/** Cores que um tema define. As demais (sombras, destaque suave…) são derivadas. */
export interface Colors {
  bg: string
  stage: string
  surface: string
  raised: string
  fg: string
  muted: string
  line: string
  accent: string
  late: string
  good: string
  /** Cores das notas: areia, sálvia, céu, rosa, lilás, manteiga. */
  notes: [string, string, string, string, string, string]
  /** Opcionais: quando ausentes, saem do destaque e do fundo. */
  accentSoft?: string
  onAccent?: string
}

type Pair = Record<Mode, Colors>

const NOTES_LIGHT: Colors['notes'] = ['#f6e9d6', '#e1eedd', '#dde8f8', '#f8e0e4', '#e9e2f6', '#f8f0c8']
const NOTES_DARK: Colors['notes'] = ['#3a3125', '#26352a', '#22304a', '#3d262c', '#2f2842', '#39351e']

export const PALETTES: Record<Exclude<PaletteId, 'system'>, { label: string; hint: string } & Pair> = {
  ideario: {
    label: 'Ideario',
    hint: 'Frio, destaque azul',
    light: {
      bg: '#eef1ef', stage: '#dfe4e1', surface: '#ffffff', raised: '#f7f9f8', fg: '#16201c', muted: '#5d6a65', line: '#d6ddd9',
      accent: '#2547c9', accentSoft: '#e2e8fb', onAccent: '#ffffff', late: '#c03b2b', good: '#217a4b', notes: NOTES_LIGHT,
    },
    dark: {
      bg: '#101513', stage: '#0a0e0d', surface: '#19211e', raised: '#1f2825', fg: '#e5ebe8', muted: '#93a19b', line: '#2b3632',
      accent: '#8ea4ff', accentSoft: '#232c4d', onAccent: '#0d1430', late: '#ff8a78', good: '#6fd09a', notes: NOTES_DARK,
    },
  },
  papel: {
    label: 'Papel',
    hint: 'Quente, destaque terracota',
    light: {
      bg: '#f4efe6', stage: '#e8e0d2', surface: '#fffdf8', raised: '#faf6ee', fg: '#2a221b', muted: '#76695b', line: '#e2d8c8',
      accent: '#b4532a', accentSoft: '#f5e1d4', onAccent: '#ffffff', late: '#b3261e', good: '#3f7a3a',
      notes: ['#f3e3c7', '#e3e8d0', '#dfe6ea', '#f4dcd6', '#e8dfe9', '#f6ecc0'],
    },
    dark: {
      bg: '#1b1714', stage: '#120f0d', surface: '#25201b', raised: '#2c2620', fg: '#eee5da', muted: '#a8998a', line: '#3a3129',
      accent: '#e8916a', accentSoft: '#43291d', onAccent: '#2a130a', late: '#ff8a78', good: '#8fca7f',
      notes: ['#3d3122', '#2f3424', '#262f35', '#3e2723', '#33283a', '#3b351c'],
    },
  },
  grafite: {
    label: 'Grafite',
    hint: 'Neutro, sem cor no fundo',
    light: {
      bg: '#f2f2f2', stage: '#e4e4e4', surface: '#ffffff', raised: '#f7f7f7', fg: '#171717', muted: '#636363', line: '#dcdcdc',
      accent: '#1f1f1f', accentSoft: '#e6e6e6', onAccent: '#ffffff', late: '#c03b2b', good: '#217a4b',
      notes: ['#f1e8db', '#e3ebe0', '#e0e7f1', '#f3e1e4', '#e7e3f0', '#f3eed2'],
    },
    dark: {
      bg: '#121212', stage: '#0a0a0a', surface: '#1c1c1c', raised: '#232323', fg: '#ececec', muted: '#9a9a9a', line: '#2e2e2e',
      accent: '#f0f0f0', accentSoft: '#333333', onAccent: '#111111', late: '#ff8a78', good: '#6fd09a',
      notes: ['#35302a', '#2a312b', '#283039', '#382b2e', '#302c38', '#34321f'],
    },
  },
  floresta: {
    label: 'Floresta',
    hint: 'Verde profundo',
    light: {
      bg: '#edf2ec', stage: '#dde6db', surface: '#fbfdfa', raised: '#f3f7f2', fg: '#15241a', muted: '#56695c', line: '#d3dfd2',
      accent: '#2f6b45', accentSoft: '#dbeadf', onAccent: '#ffffff', late: '#b8402c', good: '#2f6b45',
      notes: ['#f1e7d2', '#d9ead2', '#d8e6ec', '#f1dfdc', '#e3e0ee', '#f0eec6'],
    },
    dark: {
      bg: '#0f1611', stage: '#08100b', surface: '#172119', raised: '#1d2920', fg: '#e1ece3', muted: '#8fa595', line: '#26352a',
      accent: '#7cc79a', accentSoft: '#1f3a29', onAccent: '#08210f', late: '#ff8a78', good: '#7cc79a',
      notes: ['#352f22', '#213526', '#1f2f36', '#382628', '#2a2838', '#33331c'],
    },
  },
}

/** Paleta base de cada área de trabalho (cores padrão do Adwaita, Breeze, Windows 11 e macOS). */
export const DESKTOPS: Record<DesktopId, { label: string; accent: string } & Pair> = {
  gnome: {
    label: 'GNOME',
    accent: '#3584e4',
    light: {
      bg: '#fafafb', stage: '#ebebed', surface: '#ffffff', raised: '#f4f4f5', fg: '#2e2e33', muted: '#6e6e75', line: '#dededf',
      accent: '#3584e4', late: '#c01c28', good: '#26a269', notes: NOTES_LIGHT,
    },
    dark: {
      bg: '#222226', stage: '#1a1a1d', surface: '#2e2e32', raised: '#36363a', fg: '#ffffff', muted: '#a3a3a8', line: '#3b3b40',
      accent: '#78aeed', late: '#ff7b63', good: '#8ff0a4', notes: NOTES_DARK,
    },
  },
  kde: {
    label: 'KDE Plasma',
    accent: '#3daee9',
    light: {
      bg: '#eff0f1', stage: '#e3e5e7', surface: '#ffffff', raised: '#f7f7f8', fg: '#232629', muted: '#6b7178', line: '#d4d6d8',
      accent: '#3daee9', late: '#da4453', good: '#27ae60', notes: NOTES_LIGHT,
    },
    dark: {
      bg: '#202326', stage: '#17191b', surface: '#292c30', raised: '#31363b', fg: '#fcfcfc', muted: '#a1a9b1', line: '#3b4045',
      accent: '#3daee9', late: '#da4453', good: '#27ae60', notes: NOTES_DARK,
    },
  },
  windows: {
    label: 'Windows',
    accent: '#0078d4',
    light: {
      bg: '#f3f3f3', stage: '#e6e6e6', surface: '#ffffff', raised: '#f9f9f9', fg: '#1b1b1b', muted: '#5f5f5f', line: '#e0e0e0',
      accent: '#005fb8', late: '#c42b1c', good: '#0f7b0f', notes: NOTES_LIGHT,
    },
    dark: {
      bg: '#202020', stage: '#191919', surface: '#2b2b2b', raised: '#323232', fg: '#ffffff', muted: '#a6a6a6', line: '#3a3a3a',
      accent: '#60cdff', late: '#ff99a4', good: '#6ccb5f', notes: NOTES_DARK,
    },
  },
  macos: {
    label: 'macOS',
    accent: '#007aff',
    light: {
      bg: '#ececec', stage: '#dedede', surface: '#ffffff', raised: '#f5f5f5', fg: '#1d1d1f', muted: '#6e6e73', line: '#d9d9d9',
      accent: '#007aff', late: '#ff3b30', good: '#28a745', notes: NOTES_LIGHT,
    },
    dark: {
      bg: '#1e1e1e', stage: '#161616', surface: '#2a2a2c', raised: '#323234', fg: '#f5f5f7', muted: '#98989d', line: '#3a3a3c',
      accent: '#0a84ff', late: '#ff453a', good: '#32d74b', notes: NOTES_DARK,
    },
  },
}

/** Cores de destaque nomeadas do GNOME 47+ (org.gnome.desktop.interface accent-color). */
export const GNOME_ACCENTS: Record<string, string> = {
  blue: '#3584e4', teal: '#2190a4', green: '#3a944a', yellow: '#c88800', orange: '#ed5b00',
  red: '#e62d42', pink: '#d56199', purple: '#9141ac', slate: '#6f8396',
}

// ---------- cor ----------
type RGB = [number, number, number]
const hex = (h: string): RGB => {
  const v = h.replace('#', '')
  const f = v.length === 3 ? v.split('').map((c) => c + c).join('') : v
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)) as RGB
}
const toHex = (c: RGB) => '#' + c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('')
/** Mistura `a` com `b`; `t` é quanto de `a` entra (0–1). */
export const mix = (a: string, b: string, t: number) => {
  const x = hex(a), y = hex(b)
  return toHex([0, 1, 2].map((i) => x[i] * t + y[i] * (1 - t)) as RGB)
}
const lum = (h: string) => {
  const [r, g, b] = hex(h).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
const rgbTriplet = (h: string) => hex(h).join(' ')

/**
 * Ajusta o destaque do sistema ao fundo: no escuro clareia até ler bem sobre a superfície,
 * no claro escurece se for claro demais (ex.: amarelo do GNOME). Assim qualquer cor escolhida no sistema funciona.
 */
export function fitAccent(accent: string, mode: Mode, surface: string) {
  let a = accent
  for (let i = 0; i < 8 && contrast(a, surface) < 3.2; i++) a = mode === 'dark' ? mix('#ffffff', a, 0.18) : mix('#000000', a, 0.14)
  return a
}

/** Variáveis CSS (as mesmas de app.css) para um conjunto de cores. */
export function cssVars(c: Colors, mode: Mode): Record<string, string> {
  const dark = mode === 'dark'
  const shadowRgb = dark ? '0 0 0' : rgbTriplet(mix(c.fg, '#000000', 0.6))
  const accentSoft = c.accentSoft ?? mix(c.accent, c.surface, dark ? 0.24 : 0.14)
  const onAccent = c.onAccent ?? (contrast('#ffffff', c.accent) >= 3 ? '#ffffff' : mix('#000000', c.accent, 0.85))
  return {
    '--bg': c.bg, '--stage': c.stage, '--surface': c.surface, '--raised': c.raised, '--fg': c.fg, '--muted': c.muted, '--line': c.line,
    '--card-edge': dark ? 'rgb(255 255 255 / .07)' : `rgb(${shadowRgb} / .09)`,
    '--accent': c.accent, '--accent-soft': accentSoft, '--on-accent': onAccent,
    '--late': c.late, '--late-soft': mix(c.late, c.surface, dark ? 0.2 : 0.14), '--good': c.good,
    '--shadow': dark ? '0 1px 2px rgb(0 0 0 / .4)' : `0 1px 2px rgb(${shadowRgb} / .06), 0 4px 14px rgb(${shadowRgb} / .06)`,
    '--float-shadow': dark
      ? '0 12px 32px rgb(0 0 0 / .55), 0 1px 3px rgb(0 0 0 / .4)'
      : `0 10px 30px rgb(${shadowRgb} / .14), 0 1px 3px rgb(${shadowRgb} / .06)`,
    '--n-sand': c.notes[0], '--n-sage': c.notes[1], '--n-sky': c.notes[2], '--n-rose': c.notes[3], '--n-lilac': c.notes[4], '--n-butter': c.notes[5],
  }
}
