import { CircleDashed } from '@lucide/svelte'
import { api } from './api'
import { app } from './app.svelte'
import { hasStatus, statusOf, type NoteSummary, type ReminderStatus } from './types'
import type { MenuEntry } from './menu'

/** Nome e cor de cada status do lembrete (seletor de três cores, colunas do Kanban). */
export const STATUS: Record<ReminderStatus, { label: string; color: string }> = {
  todo: { label: 'A fazer', color: 'var(--st-todo)' },
  doing: { label: 'Em andamento', color: 'var(--st-doing)' },
  done: { label: 'Concluído', color: 'var(--st-done)' },
}

/** Muda o status pela UI, com "Desfazer". Verde num lembrete que se repete vale por esta vez (a série continua). Nota sem
 *  lembrete ganha status ('none' tira). */
export async function changeStatus(n: NoteSummary, to: ReminderStatus | 'none') {
  if (to === 'none' ? !n.statusOn : hasStatus(n) && statusOf(n) === to) return
  const before = { reminderAt: n.reminderAt, reminderDone: n.reminderDone, reminderDoing: n.reminderDoing, statusOn: n.statusOn }
  await api.setReminderStatus(n.id, to)
  const what = n.reminderAt != null ? 'Lembrete' : 'Nota'
  const msg =
    to === 'none' ? 'Status tirado'
    : to === 'done' ? (n.reminderRepeat ? 'Feito por esta vez' : n.reminderAt != null ? 'Lembrete concluído' : 'Nota concluída')
    : to === 'doing' ? `${what} em andamento`
    : `${what} a fazer`
  app.say(msg, { label: 'Desfazer', run: () => void api.updateNote(n.id, before) })
}

/** Submenu "Status" do menu da nota: as três cores e, numa nota sem lembrete que tem status, "Sem status". */
export function statusMenu(n: NoteSummary): MenuEntry {
  const on = hasStatus(n)
  return {
    label: 'Status', swatch: on ? STATUS[statusOf(n)].color : undefined, icon: CircleDashed,
    sub: [
      ...(['todo', 'doing', 'done'] as const).map((st) => ({
        label: STATUS[st].label, swatch: STATUS[st].color, checked: on && statusOf(n) === st,
        onSelect: () => void changeStatus(n, st),
      })),
      ...(n.statusOn && n.reminderAt == null ? [{ separator: true } as const, { label: 'Sem status', onSelect: () => void changeStatus(n, 'none') }] : []),
    ],
  }
}

/** Tirar o lembrete: o status some junto, a não ser que tenha sido posto pelo menu (aí fica). */
export const keepStatus = (n: { statusOn: boolean }) => (n.statusOn ? {} : { reminderDone: false, reminderDoing: false })
