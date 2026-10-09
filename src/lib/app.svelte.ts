// Estado da interface e dados compartilhados entre as telas.
// Visão (como ver) e filtro (o que ver) são independentes: trocar um nunca desfaz o outro.
import { api } from './api'
import type { AttachmentRow, Box, Category, Filter, TagCount, View, ViewCounts } from './types'
import { uuidv7 } from './uuid'

export interface EditorTarget {
  id: string
  isNew: boolean
  /** Categoria e tags herdadas do filtro ativo ao criar pelo "+". */
  defaults?: { categoryId: string | null; tags: string[] }
}

/** Largura a partir da qual o layout é de desktop. Igual ao breakpoint em app.css. */
export const WIDE_MIN = 960

class AppState {
  view = $state<View>('notes')
  filter = $state<Filter>({ categoryId: null, tags: [] })
  /** Arquivo e Lixeira: só na visão Notas. */
  box = $state<Box>('active')
  query = $state('')
  layout = $state<'grid' | 'list'>('grid')
  drawerOpen = $state(false)
  settingsOpen = $state(false)
  editor = $state<EditorTarget | null>(null)
  lightbox = $state<AttachmentRow | null>(null)
  toast = $state<string | null>(null)
  /** Janela larga (desktop): barra lateral fixa no lugar da gaveta e das abas de baixo. */
  wide = $state(false)

  /** Sobe a cada mudança nos dados; as consultas da UI dependem dele. */
  revision = $state(0)
  categories = $state.raw<Category[]>([])
  tags = $state.raw<TagCount[]>([])
  /** Contagem por visão para o filtro e a busca atuais. */
  counts = $state.raw<ViewCounts>({ notes: 0, reminders: 0, overdue: 0, files: 0, moodboard: 0 })

  #toastTimer: ReturnType<typeof setTimeout> | undefined

  constructor() {
    const mq = matchMedia(`(min-width: ${WIDE_MIN}px)`)
    this.wide = mq.matches
    mq.addEventListener('change', (e) => {
      this.wide = e.matches
      if (e.matches) this.drawerOpen = false
    })
    api.subscribe(() => {
      this.revision++
      void this.loadShared()
    })
    void this.loadShared()
    // As contagens acompanham filtro, busca e dados.
    $effect.root(() => {
      $effect(() => {
        void this.revision
        const p = { filter: $state.snapshot(this.filter), query: this.query }
        let stale = false
        api.viewCounts(p).then((c) => !stale && (this.counts = c))
        return () => (stale = true)
      })
    })
  }

  async loadShared() {
    const [categories, tags] = await Promise.all([api.listCategories(), api.listTags()])
    this.categories = categories
    this.tags = tags
  }

  category = (id: string | null | undefined) => (id ? this.categories.find((c) => c.id === id) : undefined)

  get hasFilter() {
    return !!this.filter.categoryId || this.filter.tags.length > 0
  }

  /** "Linvo · #campanha", ou null sem filtro. */
  get filterLabel(): string | null {
    const parts = [this.category(this.filter.categoryId)?.name, ...this.filter.tags.map((t) => `#${t}`)].filter(Boolean)
    return parts.length ? parts.join(' · ') : null
  }

  setView(v: View) {
    if (v !== 'notes') this.box = 'active'
    this.view = v
  }

  /** Escolhe a categoria (ou nenhuma, com null). Tocar na já escolhida tira o filtro de categoria. */
  setCategory(id: string | null) {
    this.filter.categoryId = this.filter.categoryId === id ? null : id
    this.box = 'active'
  }

  toggleTag(tag: string) {
    const t = this.filter.tags
    this.filter.tags = t.includes(tag) ? t.filter((x) => x !== tag) : [...t, tag]
    this.box = 'active'
  }

  clearFilter() {
    this.filter = { categoryId: null, tags: [] }
  }

  openBox(box: Box) {
    this.box = box
    this.view = 'notes'
    this.drawerOpen = false
  }

  openNew() {
    this.editor = {
      id: uuidv7(),
      isNew: true,
      defaults: { categoryId: this.filter.categoryId, tags: [...this.filter.tags] },
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
