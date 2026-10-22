import { Bell, CalendarDays, Images, Paperclip, SquareKanban, StickyNote } from '@lucide/svelte'
import { t } from '@wylho/atrio'
import type { View } from './types'

// Os textos são getters: `t` lê o idioma atual (reativo), então nada fica congelado na hora do import (e nada de
// espalhar com `...`, que leria os getters uma vez só). `{onde}` é o filtro ativo (categoria, tags).
type Kind = 'notes' | 'reminders' | 'files' | 'images'
const TEXTS: Record<Kind, { none: () => string; noneIn: (onde: string) => string; search: () => string; searchIn: (onde: string) => string; seeAll: () => string; filterOn: (onde: string) => string }> = {
  notes: {
    none: () => t('Nenhuma nota'),
    noneIn: (onde) => t('Nenhuma nota em {onde}', { onde }),
    search: () => t('Buscar notas'),
    searchIn: (onde) => t('Buscar notas em {onde}', { onde }),
    seeAll: () => t('Ver notas de tudo'),
    filterOn: (onde) => t('O filtro continua ativo. Troque a visão para ver o que há em {onde}, ou veja notas de tudo.', { onde }),
  },
  reminders: {
    none: () => t('Nenhum lembrete'),
    noneIn: (onde) => t('Nenhum lembrete em {onde}', { onde }),
    search: () => t('Buscar lembretes'),
    searchIn: (onde) => t('Buscar lembretes em {onde}', { onde }),
    seeAll: () => t('Ver lembretes de tudo'),
    filterOn: (onde) => t('O filtro continua ativo. Troque a visão para ver o que há em {onde}, ou veja lembretes de tudo.', { onde }),
  },
  files: {
    none: () => t('Nenhum arquivo'),
    noneIn: (onde) => t('Nenhum arquivo em {onde}', { onde }),
    search: () => t('Buscar arquivos'),
    searchIn: (onde) => t('Buscar arquivos em {onde}', { onde }),
    seeAll: () => t('Ver arquivos de tudo'),
    filterOn: (onde) => t('O filtro continua ativo. Troque a visão para ver o que há em {onde}, ou veja arquivos de tudo.', { onde }),
  },
  images: {
    none: () => t('Nenhuma imagem'),
    noneIn: (onde) => t('Nenhuma imagem em {onde}', { onde }),
    search: () => t('Buscar imagens'),
    searchIn: (onde) => t('Buscar imagens em {onde}', { onde }),
    seeAll: () => t('Ver imagens de tudo'),
    filterOn: (onde) => t('O filtro continua ativo. Troque a visão para ver o que há em {onde}, ou veja imagens de tudo.', { onde }),
  },
}

function view<I extends View>(id: I, label: () => string, kind: Kind, Icon: typeof StickyNote) {
  const x = TEXTS[kind]
  return {
    id,
    Icon,
    get label() { return label() },
    get none() { return x.none() },
    noneIn: x.noneIn,
    get search() { return x.search() },
    searchIn: x.searchIn,
    get seeAll() { return x.seeAll() },
    filterOn: x.filterOn,
  }
}

/** As visões, com os nomes usados nos rótulos, na busca e nos estados vazios. */
export const VIEWS = [
  view('notes', () => t('Notas'), 'notes', StickyNote),
  view('reminders', () => t('Lembretes'), 'reminders', Bell),
  // Calendário e Kanban mostram os mesmos lembretes: por dia e por status (vermelho, amarelo, verde).
  view('calendar', () => t('Calendário'), 'reminders', CalendarDays),
  view('kanban', () => t('Kanban'), 'reminders', SquareKanban),
  view('files', () => t('Arquivos'), 'files', Paperclip),
  view('moodboard', () => t('Moodboard'), 'images', Images),
]

export const viewInfo = (v: View) => VIEWS.find((x) => x.id === v)!
