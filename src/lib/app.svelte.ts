// Estado da interface (aba, filtro, busca, painéis abertos) e dados compartilhados
// entre as telas (categorias, tags, atrasados).
import { api } from './api'
import type { AttachmentRow, Category, Scope, TagCount, View } from './types'
import { uuidv7 } from './uuid'

export interface EditorTarget {
  id: string
  isNew: boolean
  /** Categoria e tags herdadas do filtro ativo ao criar pelo "+". */
  defaults?: { categoryId: string | null; tags: string[] }
}

class AppState {
  view = $state<View>('notes')
  scope = $state<Scope>({ kind: 'all' })
  query = $state('')
  layout = $state<'grid' | 'list'>('grid')
  drawerOpen = $state(false)
  settingsOpen = $state(false)
  editor = $state<EditorTarget | null>(null)
  lightbox = $state<AttachmentRow | null>(null)
  toast = $state<string | null>(null)

  /** Sobe a cada mudança nos dados; as consultas da UI dependem dele. */
  revision = $state(0)
  categories = $state.raw<Category[]>([])
  tags = $state.raw<TagCount[]>([])
  overdue = $state(0)

  #toastTimer: ReturnType<typeof setTimeout> | undefined

  constructor() {
    api.subscribe(() => {
      this.revision++
      void this.loadShared()
    })
    void this.loadShared()
  }

  async loadShared() {
    const [categories, tags, overdue] = await Promise.all([api.listCategories(), api.listTags(), api.overdueCount()])
    this.categories = categories
    this.tags = tags
    this.overdue = overdue
  }

  category = (id: string | null | undefined) => (id ? this.categories.find((c) => c.id === id) : undefined)

  get scopeLabel(): string | null {
    const s = this.scope
    if (s.kind === 'category') return this.category(s.id)?.name ?? null
    if (s.kind === 'tag') return `#${s.tag}`
    if (s.kind === 'archive') return 'Arquivo'
    if (s.kind === 'trash') return 'Lixeira'
    return null
  }

  setView(v: View) {
    // Arquivos e Moodboard só olham notas visíveis.
    if ((v === 'files' || v === 'moodboard') && (this.scope.kind === 'archive' || this.scope.kind === 'trash')) {
      this.scope = { kind: 'all' }
    }
    this.view = v
  }

  go(v: View, scope?: Scope) {
    if (scope) this.scope = scope
    this.setView(v)
    this.drawerOpen = false
  }

  openNew() {
    const s = this.scope
    this.editor = {
      id: uuidv7(),
      isNew: true,
      defaults: { categoryId: s.kind === 'category' ? s.id : null, tags: s.kind === 'tag' ? [s.tag] : [] },
    }
  }

  openNote(id: string) {
    this.lightbox = null
    this.editor = { id, isNew: false }
  }

  say(msg: string) {
    this.toast = msg
    clearTimeout(this.#toastTimer)
    this.#toastTimer = setTimeout(() => (this.toast = null), 2600)
  }
}

export const app = new AppState()

/**
 * Consulta que se refaz quando os argumentos lidos em `fn` ou os dados mudam.
 * Mantém o resultado anterior até o novo chegar, para a tela nunca piscar vazia.
 */
export function live<T>(fn: () => Promise<T>, initial: T) {
  let value = $state.raw(initial)
  let ready = $state(false)
  $effect(() => {
    void app.revision
    let stale = false
    fn().then((v) => {
      if (stale) return
      value = v
      ready = true
    })
    return () => (stale = true)
  })
  return {
    get current() { return value },
    get ready() { return ready },
  }
}
