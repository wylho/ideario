import type { Millis, NoteSummary } from './types'

const HOUR = 3_600_000
const DAY = 86_400_000

/** Diferença em dias de calendário entre `ms` e hoje (0 = hoje, 1 = amanhã, -1 = ontem). */
export function dayDiff(ms: Millis, now = Date.now()): number {
  const a = new Date(ms)
  a.setHours(0, 0, 0, 0)
  const b = new Date(now)
  b.setHours(0, 0, 0, 0)
  return Math.round((a.getTime() - b.getTime()) / DAY)
}

export const fmtTime = (ms: Millis) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

export function fmtReminder(ms: Millis): string {
  const t = fmtTime(ms)
  const dd = dayDiff(ms)
  if (dd === 0) return `Hoje, ${t}`
  if (dd === 1) return `Amanhã, ${t}`
  if (dd === -1) return `Ontem, ${t}`
  return `${new Date(ms).toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' })}, ${t}`
}

export const fmtShortDate = (ms: Millis) => new Date(ms).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })

export const isOverdue = (n: Pick<NoteSummary, 'reminderAt' | 'reminderDone'>, now = Date.now()) =>
  n.reminderAt != null && !n.reminderDone && n.reminderAt < now

/** Tamanho em KB ou MB, com vírgula decimal. */
export function fmtBytes(bytes: number): string {
  const kb = Math.round(bytes / 1024)
  if (kb >= 1024) return `${(kb / 1024).toFixed(1).replace('.', ',')} MB`
  return `${kb} KB`
}

/** "agora", "há 5 min", "há 3 h", "há 2 d". */
export function ago(ms: Millis, now = Date.now()): string {
  const diff = Math.max(0, now - ms)
  if (diff < 60_000) return 'agora'
  if (diff < HOUR) return `há ${Math.floor(diff / 60_000)} min`
  if (diff < DAY) return `há ${Math.floor(diff / HOUR)} h`
  return `há ${Math.round(diff / DAY)} d`
}

/** "hoje" ou "há N d", usado na lista de arquivos. */
export function daysAgo(ms: Millis, now = Date.now()): string {
  const d = -dayDiff(ms, now)
  return d <= 0 ? 'hoje' : `há ${d} d`
}

/** Data local às `hour`:00, `dayOffset` dias a partir de hoje. */
export function atLocal(dayOffset: number, hour: number, minute = 0): Millis {
  const d = new Date()
  d.setDate(d.getDate() + dayOffset)
  d.setHours(hour, minute, 0, 0)
  return d.getTime()
}

/** Valor para `<input type="datetime-local">`. */
export function toLocalInput(ms: Millis): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Remove acentos e caixa, como o tokenizer `unicode61 remove_diacritics 2` do FTS5. */
export const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Tags digitadas como `#palavra` no texto. */
export const hashTags = (text: string) => [...text.matchAll(/(?:^|[^\p{L}\d_])#([\p{L}\d_-]+)/gu)].map((m) => m[1].toLowerCase())

export const normalizeTag = (raw: string) => raw.trim().replace(/^#+/, '').replace(/\s+/g, '-').toLowerCase()
