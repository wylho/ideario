import { Bell, Images, Paperclip, StickyNote } from '@lucide/svelte'
import type { View } from './types'

/** As quatro visões, com os nomes usados nos rótulos, na busca e nos estados vazios. */
export const VIEWS = [
  { id: 'notes', label: 'Notas', many: 'notas', none: 'Nenhuma nota', add: 'Nova nota', Icon: StickyNote },
  { id: 'reminders', label: 'Lembretes', many: 'lembretes', none: 'Nenhum lembrete', add: 'Novo lembrete', Icon: Bell },
  { id: 'files', label: 'Arquivos', many: 'arquivos', none: 'Nenhum arquivo', add: 'Nova nota', Icon: Paperclip },
  { id: 'moodboard', label: 'Moodboard', many: 'imagens', none: 'Nenhuma imagem', add: 'Nova nota', Icon: Images },
] as const satisfies readonly { id: View; label: string; many: string; none: string; add: string; Icon: typeof StickyNote }[]

export const viewInfo = (v: View) => VIEWS.find((x) => x.id === v)!
