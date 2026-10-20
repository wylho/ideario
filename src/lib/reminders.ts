import { atLocal } from './format'
import type { Millis, RepeatKind } from './types'

/** Atalhos de lembrete, recalculados na hora (para "Hoje à noite" não ficar no passado). */
export function quickTimes(now = new Date()): [string, Millis][] {
  const toMonday = (8 - now.getDay()) % 7 || 7
  return [
    ['Hoje à noite', atLocal(now.getHours() >= 18 ? 1 : 0, 18)],
    ['Amanhã de manhã', atLocal(1, 9)],
    ['Segunda que vem', atLocal(toMonday, 9)],
  ]
}

/** Adiar: daqui a 1 hora, mais os atalhos. */
export function snoozeTimes(now = new Date()): [string, Millis][] {
  return [['Daqui a 1 hora', now.getTime() + 3_600_000], ...quickTimes(now)]
}

/** Próxima vez de um lembrete que se repete, depois de agora (mês e ano contam da data original, como no núcleo). */
export function nextOccurrence(at: Millis, repeat: RepeatKind, now = Date.now()): Millis {
  const base = new Date(at)
  let next = at
  for (let k = 1; next <= Math.max(now, at); k++) {
    const d = new Date(base)
    if (repeat === 'day') d.setDate(base.getDate() + k)
    else if (repeat === 'week') d.setDate(base.getDate() + 7 * k)
    else if (repeat === 'month') d.setMonth(base.getMonth() + k)
    else d.setFullYear(base.getFullYear() + k)
    next = d.getTime()
  }
  return next
}
