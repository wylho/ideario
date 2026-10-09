// Implementação em memória da camada de dados (Fase 0).
// Faz o papel do núcleo Rust: guarda as notas, projeta as colunas derivadas
// (prévia estruturada, capa, rótulo) e responde às consultas das abas.
import type { Api } from '..'
import { fold, hashTags } from '../../format'
import type {
  Attachment, AttachmentRow, Box, Category, Filter, NoteInput, NotePatch, NoteSort, NoteSummary, PreviewBlock, RichDoc, RichNode, Settings, SyncState, TagCount,
} from '../../types'
import { uuidv7 } from '../../uuid'
import { fakeImageSrc } from './fake-images'
import { DAY, SEED_CATEGORIES, SEED_FILES, SEED_IMAGES, seedNotes } from './seed'

/** `tags` guarda só as tags manuais; as `#tags` do corpo são derivadas na projeção. */
interface StoredNote extends NoteInput {
  createdAt: number
  updatedAt: number
  /** Hashes dos anexos que não estão no corpo. */
  files: string[]
  /** Ordem personalizada. */
  position: number
}

interface Projection {
  text: string
  images: string[]
  /** Todos os blocos de texto, na ordem. */
  blocks: PreviewBlock[]
  preview: PreviewBlock[]
  hashTags: string[]
}

const TRASH_DAYS = 30
/** Espaço entre posições da ordem personalizada; mover usa o meio entre vizinhos. */
const STEP = 1024
// Limites da prévia do card. Ficam aqui em cima porque o seed já projeta as notas ao carregar o módulo.
// A prévia vai além do que cabe no card; o card corta na altura máxima e esmaece o fim.
const MAX_BLOCKS = 24
const MAX_TASKS = 12
const MAX_CHARS = 1200
const MAX_CODE_LINES = 8

const notes = new Map<string, StoredNote>()
const attachments = new Map<string, Attachment>()
const imageSrc = new Map<string, string>()
const listeners = new Set<() => void>()
const projections = new WeakMap<RichDoc, Projection>()
let settings: Settings = { wifiOnly: true, photoQuality: 'balanced', cacheLimitGb: 2 }

// ---------- seed ----------
for (const i of SEED_IMAGES) {
  attachments.set(i.hash, {
    hash: i.hash, kind: 'image', mime: 'image/webp', name: i.name, bytes: i.optKB * 1024, origBytes: i.origKB * 1024,
    width: i.w, height: i.h, palette: i.pal, tone: i.tone, addedAt: 0,
  })
  imageSrc.set(i.hash, fakeImageSrc(i))
}
for (const f of SEED_FILES) {
  attachments.set(f.hash, {
    hash: f.hash, kind: f.kind, mime: f.mime, name: f.name, bytes: f.kb * 1024, origBytes: null,
    width: null, height: null, palette: null, tone: null, addedAt: Date.now() - f.daysAgo * DAY,
  })
}
for (const s of seedNotes()) {
  const body = s.body
  notes.set(s.id, {
    id: s.id, title: s.title, body, categoryId: s.categoryId, color: s.color, pinned: s.pinned,
    archived: !!s.archived, trashedAt: s.trashedDaysAgo != null ? Date.now() - s.trashedDaysAgo * DAY : null,
    reminderAt: s.reminderAt, reminderDone: !!s.reminderDone, tags: s.tags,
    createdAt: s.updatedAt - 2 * DAY, updatedAt: s.updatedAt,
    files: SEED_FILES.filter((f) => f.noteId === s.id).map((f) => f.hash),
    position: 0,
  })
  // Imagens herdam a data da nota em que entraram.
  for (const h of project(body).images) {
    const a = attachments.get(h)
    if (a && !a.addedAt) a.addedAt = s.updatedAt
  }
}
purgeTrash()
// Ordem personalizada inicial = mais recentes primeiro.
;[...notes.values()].sort((a, b) => b.updatedAt - a.updatedAt).forEach((n, i) => (n.position = i * STEP))

// ---------- projeção ----------

function project(body: RichDoc): Projection {
  const cached = projections.get(body)
  if (cached) return cached
  const images: string[] = []
  const blocks: PreviewBlock[] = []
  const inline = (n: RichNode): string =>
    n.type === 'text' ? (n.text ?? '') : n.type === 'hardBreak' ? '\n' : (n.content ?? []).map(inline).join('')
  const clean = (s: string) => s.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim()

  const listItems = (list: RichNode, depth: number) => {
    const start = Number(list.attrs?.start ?? 1)
    ;(list.content ?? []).forEach((item, i) => {
      const [first, ...rest] = item.content ?? []
      const text = first ? clean(inline(first)) : ''
      if (list.type === 'taskList') blocks.push({ kind: 'task', text, done: !!item.attrs?.checked, depth })
      else if (text) blocks.push(list.type === 'orderedList' ? { kind: 'ordered', text, n: start + i, depth } : { kind: 'bullet', text, depth })
      rest.forEach((c) => block(c, depth + 1))
    })
  }
  const block = (n: RichNode, depth = 0): void => {
    switch (n.type) {
      case 'paragraph': {
        const text = clean(inline(n))
        if (text) blocks.push({ kind: 'text', text })
        return
      }
      case 'heading': {
        const text = clean(inline(n))
        if (text) blocks.push({ kind: 'heading', text })
        return
      }
      case 'bulletList':
      case 'orderedList':
      case 'taskList':
        return listItems(n, depth)
      case 'codeBlock': {
        const text = inline(n).replace(/\s+$/, '').split('\n').slice(0, MAX_CODE_LINES).join('\n')
        if (text.trim()) blocks.push({ kind: 'code', text })
        return
      }
      case 'noteImage':
        if (typeof n.attrs?.hash === 'string') images.push(n.attrs.hash)
        return
      default:
        n.content?.forEach((c) => block(c, depth))
    }
  }
  body.content?.forEach((c) => block(c))

  const text = blocks.map((b) => ('text' in b ? b.text : '')).join(' ').replace(/\s+/g, ' ').trim()
  const p: Projection = { text, images, blocks, preview: previewOf(blocks), hashTags: hashTags(text) }
  projections.set(body, p)
  return p
}

/** Prévia do card, na ordem do documento, com limites folgados (o card corta pela altura). */
function previewOf(blocks: PreviewBlock[]): PreviewBlock[] {
  const out: PreviewBlock[] = []
  let tasks = 0
  let chars = 0
  let hidden = 0
  let afterLastTask = -1
  for (const b of blocks) {
    const len = 'text' in b ? b.text.length : 0
    const full = out.length >= MAX_BLOCKS || chars >= MAX_CHARS
    if (b.kind === 'task') {
      if (tasks >= MAX_TASKS || full) { hidden++; continue }
      tasks++
      out.push(b)
      afterLastTask = out.length
    } else if (!full) {
      out.push(b)
    }
    chars += len
  }
  if (hidden) out.splice(afterLastTask < 0 ? out.length : afterLastTask, 0, { kind: 'more', count: hidden })
  return out
}

const labelOf = (n: StoredNote) => {
  if (n.title.trim()) return n.title
  const first = project(n.body).blocks.find((b) => b.kind !== 'code' && 'text' in b && b.text)
  return first && 'text' in first ? first.text.split('\n')[0].slice(0, 90) : 'Sem título'
}

const tagsOf = (n: StoredNote) => [...new Set([...n.tags, ...project(n.body).hashTags])]

function summarize(n: StoredNote): NoteSummary {
  const p = project(n.body)
  const first = p.images[0] ? attachments.get(p.images[0]) : undefined
  return {
    id: n.id, title: n.title, label: labelOf(n), excerpt: p.text.slice(0, 280), preview: p.preview,
    cover: first ? { hash: first.hash, width: first.width ?? 4, height: first.height ?? 3 } : null, imageCount: p.images.length, fileCount: n.files.length,
    categoryId: n.categoryId, color: n.color, pinned: n.pinned, archived: n.archived, trashedAt: n.trashedAt,
    reminderAt: n.reminderAt, reminderDone: n.reminderDone, tags: tagsOf(n), createdAt: n.createdAt, updatedAt: n.updatedAt,
    position: n.position,
  }
}

// ---------- consultas ----------
const isLive = (n: StoredNote) => n.trashedAt == null && !n.archived

function inBox(n: StoredNote, box: Box) {
  if (box === 'trash') return n.trashedAt != null
  if (box === 'archive') return n.archived && n.trashedAt == null
  return isLive(n)
}

function passes(n: StoredNote, f: Filter) {
  if (f.categoryId && n.categoryId !== f.categoryId) return false
  if (!f.tags.length) return true
  const tags = tagsOf(n)
  return f.tags.every((t) => tags.includes(t))
}

/** Notas ativas que passam no filtro, as mais recentes primeiro. */
const activeIn = (f: Filter) => [...notes.values()].filter((n) => isLive(n) && passes(n, f)).sort(byRecent)

const fileMatches = (query: string) => {
  const q = fold(query.trim())
  return (r: AttachmentRow) => !q || fold(r.name + ' ' + r.noteTitle).includes(q)
}

/** Busca como o FTS5 vai fazer: sem acento, todos os termos, por prefixo dentro do texto. */
function matches(n: StoredNote, query: string) {
  const terms = fold(query).replace(/#/g, ' ').split(/\s+/).filter(Boolean)
  if (!terms.length) return true
  const hay = fold(`${n.title} ${project(n.body).text} ${tagsOf(n).join(' ')}`)
  return terms.every((t) => hay.includes(t))
}

const byRecent = (a: StoredNote, b: StoredNote) => b.updatedAt - a.updatedAt

/** Comparador de cada ordem. Categoria segue a ordem das categorias; sem categoria vai para o fim. */
function compareFor(sort: NoteSort) {
  const catIndex = (n: StoredNote) => {
    const i = SEED_CATEGORIES.findIndex((c) => c.id === n.categoryId)
    return i < 0 ? Infinity : i
  }
  switch (sort) {
    case 'custom': return (a: StoredNote, b: StoredNote) => a.position - b.position
    case 'created': return (a: StoredNote, b: StoredNote) => b.createdAt - a.createdAt
    case 'title': return (a: StoredNote, b: StoredNote) => labelOf(a).localeCompare(labelOf(b), 'pt-BR', { sensitivity: 'base' })
    case 'category': return (a: StoredNote, b: StoredNote) => catIndex(a) - catIndex(b) || a.position - b.position
    default: return byRecent
  }
}

const minPosition = () => Math.min(0, ...[...notes.values()].map((n) => n.position))

function rowsFor(n: StoredNote, hashes: string[]): AttachmentRow[] {
  return hashes.flatMap((h) => {
    const a = attachments.get(h)
    return a ? [{ ...a, noteId: n.id, noteTitle: labelOf(n), categoryId: n.categoryId }] : []
  })
}

function purgeTrash() {
  const limit = Date.now() - TRASH_DAYS * DAY
  for (const [id, n] of notes) if (n.trashedAt != null && n.trashedAt < limit) notes.delete(id)
}

const INPUT_KEYS: (keyof NoteInput)[] = [
  'title', 'body', 'categoryId', 'color', 'pinned', 'archived', 'trashedAt', 'reminderAt', 'reminderDone', 'tags',
]
const sameContent = (a: NoteInput, b: NoteInput) => INPUT_KEYS.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]))

function changed() {
  for (const fn of listeners) fn()
  scheduleSync()
}

// Simula o ciclo do sync (SPEC §6): alguns instantes depois da última edição, sobe e volta a 'ok'.
const syncListeners = new Set<(s: SyncState) => void>()
let syncTimer: ReturnType<typeof setTimeout> | undefined
function scheduleSync() {
  clearTimeout(syncTimer)
  syncTimer = setTimeout(() => {
    syncListeners.forEach((fn) => fn('syncing'))
    syncTimer = setTimeout(() => syncListeners.forEach((fn) => fn('ok')), 1200)
  }, 1500)
}

const done = <T>(v: T) => Promise.resolve(v)

export const mockApi: Api = {
  listNotes({ filter, box, query, sort }) {
    return done([...notes.values()].filter((n) => inBox(n, box) && passes(n, filter) && matches(n, query)).sort(compareFor(sort)).map(summarize))
  },

  moveNote(id, { after, before }) {
    const n = notes.get(id)
    if (!n) return done(undefined)
    const a = after ? notes.get(after)?.position : undefined
    const b = before ? notes.get(before)?.position : undefined
    let pos = a != null && b != null ? (a + b) / 2 : a != null ? a + STEP : b != null ? b - STEP : n.position
    if (a != null && b != null && !(pos > a && pos < b)) {
      // Sem espaço entre os vizinhos: renumera tudo e tenta de novo.
      ;[...notes.values()].sort((x, y) => x.position - y.position).forEach((x, i) => (x.position = i * STEP))
      pos = (notes.get(after!)!.position + notes.get(before!)!.position) / 2
    }
    if (pos !== n.position) {
      n.position = pos
      changed()
    }
    return done(undefined)
  },

  adoptOrder(sort) {
    if (sort !== 'custom') {
      ;[...notes.values()].sort(compareFor(sort)).forEach((n, i) => (n.position = i * STEP))
      changed()
    }
    return done(undefined)
  },

  listReminders({ filter, query, includeDone }) {
    return done(
      activeIn(filter)
        .filter((n) => n.reminderAt != null && (includeDone || !n.reminderDone) && matches(n, query))
        .sort((a, b) => a.reminderAt! - b.reminderAt!)
        .map(summarize),
    )
  },

  listAttachments({ filter, query }) {
    return done(activeIn(filter).flatMap((n) => rowsFor(n, [...project(n.body).images, ...n.files])).filter(fileMatches(query)))
  },

  listImages({ filter, query, tone }) {
    return done(
      activeIn(filter)
        .filter((n) => matches(n, query))
        .flatMap((n) => rowsFor(n, project(n.body).images))
        .filter((r) => !tone || r.tone === tone),
    )
  },

  viewCounts({ filter, query }) {
    const now = Date.now()
    const live = activeIn(filter)
    const found = live.filter((n) => matches(n, query))
    const pending = found.filter((n) => n.reminderAt != null && !n.reminderDone)
    return done({
      notes: found.length,
      reminders: pending.length,
      overdue: pending.filter((n) => n.reminderAt! < now).length,
      files: live.flatMap((n) => rowsFor(n, [...project(n.body).images, ...n.files])).filter(fileMatches(query)).length,
      moodboard: found.reduce((s, n) => s + project(n.body).images.length, 0),
    })
  },

  listCategories() {
    const live = [...notes.values()].filter(isLive)
    return done(SEED_CATEGORIES.map<Category>((c) => ({ ...c, icon: null, noteCount: live.filter((n) => n.categoryId === c.id).length })))
  },

  listTags() {
    const m = new Map<string, number>()
    for (const n of notes.values()) if (isLive(n)) for (const t of tagsOf(n)) m.set(t, (m.get(t) ?? 0) + 1)
    return done([...m].map<TagCount>(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)))
  },

  getNote(id) {
    const n = notes.get(id)
    if (!n) return done(null)
    const { files, ...rest } = n
    return done({ ...structuredClone(rest), files: files.flatMap((h) => attachments.get(h) ?? []) })
  },

  saveNote(input) {
    const prev = notes.get(input.id)
    const next: NoteInput = { ...input, body: structuredClone(input.body), tags: [...new Set(input.tags)] }
    if (prev && sameContent(prev, next)) return done(summarize(prev))
    const now = Date.now()
    notes.set(next.id, { ...next, createdAt: prev?.createdAt ?? now, updatedAt: now, files: prev?.files ?? [], position: prev?.position ?? minPosition() - STEP })
    changed()
    return done(summarize(notes.get(next.id)!))
  },

  setReminderDone(id, value) {
    const n = notes.get(id)
    if (n && n.reminderDone !== value) {
      n.reminderDone = value
      changed()
    }
    return done(undefined)
  },

  updateNote(id, patch) {
    const n = notes.get(id)
    if (!n) return done(undefined)
    const keys = Object.keys(patch) as (keyof NotePatch)[]
    if (keys.some((k) => n[k] !== patch[k])) {
      Object.assign(n, patch)
      n.updatedAt = Date.now()
      changed()
    }
    return done(undefined)
  },

  duplicateNote(id) {
    const n = notes.get(id)
    if (!n) return Promise.reject(new Error('nota não encontrada'))
    const now = Date.now()
    const copy: StoredNote = {
      ...structuredClone(n), id: uuidv7(), title: n.title ? `${n.title} (cópia)` : '', pinned: false,
      reminderAt: null, reminderDone: false, createdAt: now, updatedAt: now, position: n.position - 1,
    }
    notes.set(copy.id, copy)
    changed()
    return done(copy.id)
  },

  noteText(id) {
    const n = notes.get(id)
    if (!n) return done('')
    const lines = project(n.body).blocks.map((b) => {
      const pad = 'depth' in b ? '  '.repeat(b.depth) : ''
      if (b.kind === 'task') return `${pad}${b.done ? '☑' : '☐'} ${b.text}`
      if (b.kind === 'bullet') return `${pad}• ${b.text}`
      if (b.kind === 'ordered') return `${pad}${b.n}. ${b.text}`
      return 'text' in b ? b.text : ''
    })
    return done([n.title, ...lines].filter(Boolean).join('\n'))
  },

  deleteNote(id) {
    if (notes.delete(id)) changed()
    return done(undefined)
  },

  trashCount: () => done([...notes.values()].filter((n) => n.trashedAt != null).length),
  emptyTrash() {
    let n = 0
    for (const [id, note] of notes) if (note.trashedAt != null && notes.delete(id)) n++
    if (n) changed()
    return done(n)
  },

  getSettings: () => done({ ...settings }),
  saveSettings(s) {
    settings = { ...s }
    return done(undefined)
  },
  syncStatus: () =>
    done({ connected: true, lastSyncAt: Date.now() - 2 * 60_000, noteCount: notes.size, cacheUsedBytes: 310 * 1024 * 1024 }),

  imageUrl: (hash) => imageSrc.get(hash) ?? '',
  async downloadAttachment(a) {
    // Prévia: imagens baixam a própria figura; os demais anexos de exemplo não têm conteúdo, então vai um arquivo de texto.
    const src = imageSrc.get(a.hash)
    const url = src || URL.createObjectURL(new Blob([`Arquivo de exemplo do Ideario: ${a.name}\n`], { type: 'text/plain' }))
    const link = Object.assign(document.createElement('a'), { href: url, download: src ? a.name.replace(/\.\w+$/, '') + '.svg' : a.name })
    link.click()
    if (!src) setTimeout(() => URL.revokeObjectURL(url), 1000)
  },
  sampleImages: () =>
    done([...attachments.values()].filter((a) => a.kind === 'image').map((a) => ({ ...a, noteId: '', noteTitle: '', categoryId: null }))),

  subscribe(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },

  subscribeSync(fn) {
    syncListeners.add(fn)
    return () => syncListeners.delete(fn)
  },
}
