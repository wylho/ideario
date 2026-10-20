import { api } from './api'
import { app } from './app.svelte'
import { statusOf, type NoteSummary, type ReminderStatus } from './types'

/** Nome e cor de cada status do lembrete (seletor de três cores, colunas do Kanban). */
export const STATUS: Record<ReminderStatus, { label: string; color: string }> = {
  todo: { label: 'A fazer', color: 'var(--st-todo)' },
  doing: { label: 'Em andamento', color: 'var(--st-doing)' },
  done: { label: 'Concluído', color: 'var(--st-done)' },
}

/** Muda o status pela UI, com "Desfazer". Verde num lembrete que se repete vale por esta vez (a série continua). */
export async function changeStatus(n: NoteSummary, to: ReminderStatus) {
  if (statusOf(n) === to) return
  const before = { reminderAt: n.reminderAt, reminderDone: n.reminderDone, reminderDoing: n.reminderDoing }
  await api.setReminderStatus(n.id, to)
  const msg = to === 'done' ? (n.reminderRepeat ? 'Feito por esta vez' : 'Lembrete concluído') : to === 'doing' ? 'Lembrete em andamento' : 'Lembrete a fazer'
  app.say(msg, { label: 'Desfazer', run: () => void api.updateNote(n.id, before) })
}
