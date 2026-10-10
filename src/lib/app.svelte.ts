// Estado da interface e dados compartilhados entre as telas.
// Visão (como ver) e filtro (o que ver) são independentes: trocar um nunca desfaz o outro.
import { SvelteSet } from 'svelte/reactivity'
import { api } from './api'
import type { AttachmentRow, NoteSummary, Box, Category, FileGroup, FileSort, Filter, NoteSort, SyncState, TagCount, Tone, View, ViewCounts } from './types'
import { uuidv7 } from './uuid'

export interface NameDialog {
  kind: 'name'
  title: string
  label: string
  value: string
  /** Cor inicial; ausente = sem escolha de cor. */
  color?: string
  confirm: string
  submit: (name: string, color: string | undefined) => void
}
export interface ConfirmAsk {
  kind: 'confirm'
  title: string
  text: string
  confirm: string
  onconfirm: () => void
}
/** Aviso com só um botão (ex.: resumo de uma importação). */
export interface InfoDialog {
  kind: 'info'
  title: string
  lines: string[]
}
export type AppDialog = NameDialog | ConfirmAsk | InfoDialog

/** Tarefa longa em andamento (ex.: importar do Keep): mostrada com barra de progresso. */
export interface Task {
  label: string
  done: number
  total: number
}

/** Arquivo solto na janela: File no navegador; caminho no app (o núcleo lê do disco). */
export type DroppedFile = File | { path: string }

export interface EditorTarget {
  id: string
  isNew: boolean
  /** Categoria e tags herdadas do filtro ativo ao criar pelo "+". */
  defaults?: { categoryId: string | null; tags: string[] }
  /** Atalho do "+": a nota nova já abre gravando, com a câmera ou com os arquivos escolhidos. */
  start?: { record: true } | { camera: true } | { files: DroppedFile[] }
}

/** Largura a partir da qual o layout é de desktop. Igual ao breakpoint em app.css. */
export const WIDE_MIN = 960

const SORT_KEY = 'ideario.sort'
const SORTS: NoteSort[] = ['custom', 'updated', 'created', 'category', 'title']
function readSort(): NoteSort {
  try {
    const v = localStorage.getItem(SORT_KEY) as NoteSort | null
    return v && SORTS.includes(v) ? v : 'updated'
  } catch {
    return 'updated'
  }
}

const SIDEBAR_KEY = 'ideario.sidebar'
function readSidebar() {
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== '0'
  } catch {
    return true
  }
}

class AppState {
  view = $state<View>('notes')
  filter = $state<Filter>({ categoryId: null, tags: [] })
  /** Arquivo e Lixeira: só na visão Notas. */
  box = $state<Box>('active')
  query = $state('')
  /** Desktop: campo de busca aberto (no celular ele está sempre visível). */
  searchOpen = $state(false)
  layout = $state<'grid' | 'list'>('grid')
  /** Ordem das notas; guardada no aparelho. */
  sort = $state<NoteSort>(readSort())
  /** Arquivos: ordem e lista/grade (as ações ficam na barra superior, como as das notas). */
  filesSort = $state<FileSort>('recent')
  filesLayout = $state<'grid' | 'list'>('list')
  /** Arquivos: tipo mostrado (null = todos). */
  filesKind = $state<FileGroup | null>(null)
  /** Moodboard: tom mostrado (null = todos). */
  moodTone = $state<Tone | null>(null)
  /** Lembretes: mostrar os concluídos no fim da lista. */
  showDone = $state(false)
  /** Card sendo arrastado (para o resto da UI reagir). */
  dragId = $state<string | null>(null)
  drawerOpen = $state(false)
  settingsOpen = $state(false)
  editor = $state<EditorTarget | null>(null)
  /** Recebe arquivos soltos na janela enquanto o editor está aberto (o editor registra ao montar).
   *  `at`: ponto da tela onde caíram; dentro do texto entram ali, fora vão para o fim. */
  dropIntoEditor: ((files: DroppedFile[], at?: { x: number; y: number }) => void) | null = null
  lightbox = $state<AttachmentRow | null>(null)
  toast = $state<string | null>(null)
  /** Ação do toast (ex.: Desfazer). */
  toastAction = $state<{ label: string; run: () => void } | null>(null)
  /** Janela larga (desktop): barra lateral fixa no lugar da gaveta e das abas de baixo. */
  wide = $state(false)
  /** Desktop: barra lateral aberta ou recolhida. Fica guardado no aparelho. */
  sidebarOpen = $state(readSidebar())

  /** Sincronização: a interface só mostra algo quando não está 'ok'. */
  sync = $state<SyncState>(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'ok')

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
    api.subscribeSync((s) => (this.sync = navigator.onLine ? s : 'offline'))
    addEventListener('offline', () => (this.sync = 'offline'))
    addEventListener('online', () => {
      this.sync = 'ok'
      api.syncNow()
    })
    // Voltou à janela: o que mudou em outros aparelhos chega logo.
    addEventListener('focus', () => api.syncFocus())
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

  // ---------- diálogos simples (nome/cor, confirmação) ----------
  /** Um diálogo por vez: dar nome (e cor) a algo, ou confirmar o que não tem volta. */
  dialog = $state<AppDialog | null>(null)

  /** Pede um nome (e, se `color` vier, uma cor). */
  askName(d: Omit<NameDialog, 'kind'>) {
    this.dialog = { kind: 'name', ...d }
  }

  confirm(d: Omit<ConfirmAsk, 'kind'>) {
    this.dialog = { kind: 'confirm', ...d }
  }

  info(d: Omit<InfoDialog, 'kind'>) {
    this.dialog = { kind: 'info', ...d }
  }

  task = $state<Task | null>(null)

  // ---------- seleção múltipla (visão Notas) ----------
  /** Notas selecionadas. Com alguma selecionada, a barra superior vira a barra de ações em lote. */
  selected = new SvelteSet<string>()
  /** Última nota marcada: ponto de partida do Shift+clique. */
  private anchor: string | null = null
  /** Notas na tela, na ordem em que aparecem (o NotesView atualiza). Serve ao Shift e ao Ctrl+A. */
  visibleNotes = $state.raw<NoteSummary[]>([])

  /** Marca ou desmarca; com Shift, marca tudo entre a última marcada e esta, na ordem da tela. */
  toggleSelect(id: string, range = false) {
    const order = this.visibleNotes.map((n) => n.id)
    const a = this.anchor ? order.indexOf(this.anchor) : -1
    const b = order.indexOf(id)
    if (range && a >= 0 && b >= 0) {
      for (const x of order.slice(Math.min(a, b), Math.max(a, b) + 1)) this.selected.add(x)
    } else if (this.selected.has(id)) {
      this.selected.delete(id)
    } else {
      this.selected.add(id)
    }
    this.anchor = id
  }

  selectAll() {
    for (const n of this.visibleNotes) this.selected.add(n.id)
  }

  clearSelection() {
    this.selected.clear()
    this.anchor = null
  }

  setView(v: View) {
    this.clearSelection()
    if (v !== 'notes') this.box = 'active'
    this.view = v
  }

  /** Escolhe a categoria (ou nenhuma, com null). Tocar na já escolhida tira o filtro de categoria. */
  setCategory(id: string | null) {
    this.clearSelection()
    this.filter.categoryId = this.filter.categoryId === id ? null : id
    this.box = 'active'
  }

  toggleTag(tag: string) {
    this.clearSelection()
    const t = this.filter.tags
    this.filter.tags = t.includes(tag) ? t.filter((x) => x !== tag) : [...t, tag]
    this.box = 'active'
  }

  clearFilter() {
    this.clearSelection()
    this.filter = { categoryId: null, tags: [] }
  }

  setSort(sort: NoteSort) {
    this.sort = sort
    try {
      localStorage.setItem(SORT_KEY, sort)
    } catch {
      // sem armazenamento: vale só nesta sessão
    }
  }

  toggleSidebar() {
    this.sidebarOpen = !this.sidebarOpen
    try {
      localStorage.setItem(SIDEBAR_KEY, this.sidebarOpen ? '1' : '0')
    } catch {
      // sem armazenamento: vale só nesta sessão
    }
  }

  /** O ☰ do canto: no desktop recolhe/abre a barra lateral; no celular abre a gaveta. */
  toggleNav() {
    if (this.wide) this.toggleSidebar()
    else this.drawerOpen = true
  }

  openBox(box: Box) {
    this.clearSelection()
    this.box = box
    this.view = 'notes'
    this.drawerOpen = false
  }

  /** Nota nova; sem `defaults`, herda a categoria e as tags do filtro ativo. */
  openNew(defaults?: { categoryId: string | null; tags: string[] }, start?: EditorTarget['start']) {
    this.editor = {
      id: uuidv7(),
      isNew: true,
      defaults: defaults ?? { categoryId: this.filter.categoryId, tags: [...this.filter.tags] },
      start,
    }
  }

  openNote(id: string) {
    this.lightbox = null
    this.editor = { id, isNew: false }
  }

  say(msg: string, action?: { label: string; run: () => void }) {
    this.toast = msg
    this.toastAction = action ?? null
    clearTimeout(this.#toastTimer)
    this.#toastTimer = setTimeout(() => {
      this.toast = null
      this.toastAction = null
    }, action ? 5000 : 2600)
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
