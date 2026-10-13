// Emoji grande de capa da nota. A regra é a mesma do núcleo (`clean_emoji` em src-tauri/src/store.rs).

/** Um emoji só (sequências com ZWJ, tom de pele, bandeiras e teclas incluídas), sem letras nem espaços; senão, null. */
export function cleanEmoji(s: string): string | null {
  const t = s.trim()
  const ok =
    t.length > 0 &&
    new TextEncoder().encode(t).length <= 32 &&
    /[^\x00-\x7f]/.test(t) &&
    !/[\s\p{Cc}A-Za-z]/u.test(t)
  return ok ? t : null
}

export interface EmojiItem {
  e: string
  label: string
  /** Palavras do nome, sem acento. */
  name: string[]
  /** Palavras do nome e das palavras-chave, sem acento, para a busca. */
  keys: string[]
}
export interface EmojiGroup {
  name: string
  items: EmojiItem[]
}

// Grupos do Unicode na ordem de sempre (o 2 são os componentes, como tom de pele: não entram).
const GROUPS = ['Sorrisos e emoção', 'Pessoas', '', 'Animais e natureza', 'Comida e bebida', 'Viagens e lugares', 'Atividades', 'Objetos', 'Símbolos', 'Bandeiras']
/** Emojis até a versão 14 (2021): os mais novos ainda aparecem como quadradinho em muitos sistemas. */
const MAX_VERSION = 14

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

let groups: Promise<EmojiGroup[]> | null = null

/** Lista com os nomes em português, carregada só quando o seletor abre. */
export function loadEmojis(): Promise<EmojiGroup[]> {
  groups ??= import('emojibase-data/pt/data.json').then(({ default: data }) => {
    const out: EmojiGroup[] = GROUPS.map((name) => ({ name, items: [] }))
    for (const d of data as { emoji: string; label: string; tags?: string[]; group?: number; version: number }[]) {
      if (d.group == null || d.group === 2 || !GROUPS[d.group] || d.version > MAX_VERSION) continue
      const words = (s: string) => fold(s).split(/[\s:,]+/).filter(Boolean)
      out[d.group].items.push({ e: d.emoji, label: d.label, name: words(d.label), keys: words([d.label, ...(d.tags ?? [])].join(' ')) })
    }
    return out.filter((g) => g.items.length)
  })
  return groups
}

/** Busca sem acento, por começo de palavra: todas as palavras digitadas precisam aparecer. Primeiro os emojis cujo
 *  nome é a busca, depois os cujo nome tem as palavras, por fim os que só têm nas palavras-chave ("foguete" → 🚀
 *  antes do astronauta). */
export function searchEmojis(all: EmojiGroup[], query: string, max = 120): EmojiItem[] {
  const terms = fold(query).split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  const has = (words: string[]) => terms.every((t) => words.some((w) => w.startsWith(t)))
  const ranked: [number, EmojiItem][] = []
  for (const g of all)
    for (const it of g.items) {
      if (!has(it.keys)) continue
      const rank = it.name.join(' ') === terms.join(' ') ? 0 : has(it.name) ? 1 : 2
      ranked.push([rank, it])
    }
  return ranked.sort((a, b) => a[0] - b[0]).slice(0, max).map(([, it]) => it)
}

const RECENT_KEY = 'ideario.recentEmojis'
export function recentEmojis(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((e): e is string => typeof e === 'string').slice(0, 16) : []
  } catch {
    return []
  }
}
export function rememberEmoji(e: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([e, ...recentEmojis().filter((x) => x !== e)].slice(0, 16)))
  } catch {
    // sem armazenamento: só não lembra
  }
}
