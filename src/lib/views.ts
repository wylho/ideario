import { Bell, CalendarDays, Images, Paperclip, SquareKanban, StickyNote } from '@lucide/svelte'
import type { View } from './types'

/** As visões, com os nomes usados nos rótulos, na busca e nos estados vazios. */
export const VIEWS = [
  { id: 'notes', label: 'Notas', many: 'notas', none: 'Nenhuma nota', add: 'Nova nota', Icon: StickyNote },
  { id: 'reminders', label: 'Lembretes', many: 'lembretes', none: 'Nenhum lembrete', add: 'Novo lembrete', Icon: Bell },
  // Calendário e Kanban mostram os mesmos lembretes: por dia e por status (vermelho, amarelo, verde).
  { id: 'calendar', label: 'Calendário', many: 'lembretes', none: 'Nenhum lembrete', add: 'Novo lembrete', Icon: CalendarDays },
  { id: 'kanban', label: 'Kanban', many: 'lembretes', none: 'Nenhum lembrete', add: 'Novo lembrete', Icon: SquareKanban },
  { id: 'files', label: 'Arquivos', many: 'arquivos', none: 'Nenhum arquivo', add: 'Nova nota', Icon: Paperclip },
  { id: 'moodboard', label: 'Moodboard', many: 'imagens', none: 'Nenhuma imagem', add: 'Nova nota', Icon: Images },
] as const satisfies readonly { id: View; label: string; many: string; none: string; add: string; Icon: typeof StickyNote }[]

export const viewInfo = (v: View) => VIEWS.find((x) => x.id === v)!
