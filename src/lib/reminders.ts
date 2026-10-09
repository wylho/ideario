import { atLocal } from './format'
import type { Millis } from './types'

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
