import type { Millis, NoteSummary } from './types'
import { nextOccurrence } from './reminders'

/** Dia local como chave ("2026-10-20"). */
export function dayKey(t: Millis | Date): string {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function fromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

/** A semana começa no domingo, como nos calendários do Brasil. */
const weekStart = (d: Date) => addDays(d, -d.getDay())

/** Dias que aparecem na grade: o mês inteiro (semanas completas) ou a semana do dia escolhido. */
export function gridDays(anchor: Millis, mode: 'month' | 'week'): Date[] {
  const a = new Date(anchor)
  const first = mode === 'month' ? weekStart(new Date(a.getFullYear(), a.getMonth(), 1)) : weekStart(a)
  const last = mode === 'month' ? addDays(weekStart(new Date(a.getFullYear(), a.getMonth() + 1, 0)), 6) : addDays(first, 6)
  const out: Date[] = []
  for (let d = first; d <= last; d = addDays(d, 1)) out.push(d)
  return out
}

/** O mesmo dia no mês ou na semana seguinte (ou anterior, com -1); 31 vira o último dia de um mês mais curto. */
export function shift(key: string, mode: 'month' | 'week', by: number): string {
  const a = fromKey(key)
  if (mode === 'week') return dayKey(addDays(a, 7 * by))
  const last = new Date(a.getFullYear(), a.getMonth() + by + 1, 0).getDate()
  return dayKey(new Date(a.getFullYear(), a.getMonth() + by, Math.min(a.getDate(), last)))
}

/** Mesma hora do lembrete, em outro dia (arrastar no calendário). */
export function onDay(at: Millis, key: string): Millis {
  const t = new Date(at)
  const d = fromKey(key)
  d.setHours(t.getHours(), t.getMinutes(), 0, 0)
  return d.getTime()
}

export interface CalItem {
  n: NoteSummary
  at: Millis
  /** Próximas vezes de um lembrete que se repete: só mostram, não arrastam. */
  repeat: boolean
}

/** Lembretes por dia entre `from` e `to` (inclusive), com as próximas vezes dos que se repetem. */
export function byDay(list: NoteSummary[], from: Date, to: Date): Map<string, CalItem[]> {
  const end = addDays(to, 1).getTime()
  const out = new Map<string, CalItem[]>()
  const put = (it: CalItem) => {
    const k = dayKey(it.at)
    out.set(k, [...(out.get(k) ?? []), it])
  }
  for (const n of list) {
    if (n.reminderAt == null) continue
    if (n.reminderAt >= from.getTime() && n.reminderAt < end) put({ n, at: n.reminderAt, repeat: false })
    if (!n.reminderRepeat || n.reminderDone) continue
    let at = n.reminderAt
    for (let i = 0; i < 62; i++) {
      at = nextOccurrence(at, n.reminderRepeat, at)
      if (at >= end) break
      if (at >= from.getTime()) put({ n, at, repeat: true })
    }
  }
  for (const items of out.values()) items.sort((a, b) => a.at - b.at)
  return out
}
