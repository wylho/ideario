// Implementação em memória da camada de dados (Fase 0).
// Faz o papel do núcleo Rust: guarda as notas, projeta as colunas derivadas
// (prévia estruturada, capa, rótulo) e responde às consultas das abas.
import type { Api } from '..'
import { fold, hashTags, normalizeTag } from '../../format'
import type {
  Attachment, AttachmentKind, AttachmentRow, Box, Category, Filter, NoteInput, NotePatch, NoteSort, NoteSummary, PreviewBlock, RichDoc, RichNode, Settings, SyncState, TagCount,
} from '../../types'
import * as Y from 'yjs'
import { uuidv7 } from '../../uuid'
import { noteToState, stateToNote } from './ydoc'
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
  /** Capa: a primeira foto, ou a primeira linha de fotos lado a lado. */
  cover: string[]
  /** Anexos inline que não são foto (vídeo, áudio, documentos). */
  files: string[]
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
/** Conteúdo dos anexos importados nesta sessão (vídeo, áudio, documentos). */
const blobSrc = new Map<string, string>()
const listeners = new Set<() => void>()
const projections = new WeakMap<RichDoc, Projection>()
/** Categorias (as de exemplo, e as que se criam na sessão). */
const categories = SEED_CATEGORIES.map((c) => ({ ...c, deleted: false }))
const liveCategories = () => categories.filter((c) => !c.deleted)
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
  // Anexos são blocos do texto: os que o seed não pôs no meio entram no fim da nota.
  const loose = SEED_FILES.filter((f) => f.noteId === s.id && !f.inline)
  const body = loose.length ? { ...s.body, content: [...(s.body.content ?? []), ...loose.map((f) => ({ type: 'noteFile', attrs: { hash: f.hash } }))] } : s.body
  notes.set(s.id, {
    id: s.id, title: s.title, body, categoryId: s.categoryId, color: s.color, pinned: s.pinned,
    archived: !!s.archived, trashedAt: s.trashedDaysAgo != null ? Date.now() - s.trashedDaysAgo * DAY : null,
    reminderAt: s.reminderAt, reminderDone: !!s.reminderDone, tags: s.tags,
    createdAt: s.updatedAt - 2 * DAY, updatedAt: s.updatedAt,
    files: [],
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
  const files: string[] = []
  let cover: string[] = []
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
        if (typeof n.attrs?.hash === 'string') {
          images.push(n.attrs.hash)
          if (!cover.length) cover = [n.attrs.hash]
        }
        return
      case 'imageRow': {
        const row = (n.content ?? []).map((c) => c.attrs?.hash).filter((h): h is string => typeof h === 'string')
        images.push(...row)
        if (!cover.length) cover = row.slice(0, 4)
        return
      }
      case 'noteFile': {
        const a = typeof n.attrs?.hash === 'string' ? attachments.get(n.attrs.hash) : undefined
        if (a) {
          files.push(a.hash)
          blocks.push({ kind: 'file', text: a.name, fileKind: a.kind })
        }
        return
      }
      default:
        n.content?.forEach((c) => block(c, depth))
    }
  }
  body.content?.forEach((c) => block(c))

  const text = blocks.map((b) => ('text' in b ? b.text : '')).join(' ').replace(/\s+/g, ' ').trim()
  const p: Projection = { text, images, cover, files, blocks, preview: previewOf(blocks), hashTags: hashTags(text) }
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
  const first = project(n.body).blocks.find((b) => b.kind !== 'code' && b.kind !== 'file' && 'text' in b && b.text)
  return first && 'text' in first ? first.text.split('\n')[0].slice(0, 90) : 'Sem título'
}

const tagsOf = (n: StoredNote) => [...new Set([...n.tags, ...project(n.body).hashTags])]

function summarize(n: StoredNote): NoteSummary {
  const p = project(n.body)
  const cover = p.cover.flatMap((h) => {
    const a = attachments.get(h)
    return a ? [{ hash: h, width: a.width ?? 4, height: a.height ?? 3 }] : []
  })
  return {
    id: n.id, title: n.title, label: labelOf(n), preview: p.preview,
    cover, imageCount: p.images.length, fileCount: n.files.length + p.files.length,
    categoryId: n.categoryId, color: n.color, pinned: n.pinned, archived: n.archived, trashedAt: n.trashedAt,
    reminderAt: n.reminderAt, reminderDone: n.reminderDone, tags: tagsOf(n), createdAt: n.createdAt, updatedAt: n.updatedAt,
    position: n.position,
  }
}

// ---------- anexos importados ----------
function kindOf(mime: string, name: string): AttachmentKind {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (/sheet|excel|csv/.test(mime) || ['xls', 'xlsx', 'ods', 'csv'].includes(ext)) return 'sheet'
  if (/word|document|text|rtf/.test(mime) || ['doc', 'docx', 'odt', 'txt', 'md', 'rtf'].includes(ext)) return 'doc'
  return 'other'
}

/** WAV de 2 s (uma nota suave), para os áudios de exemplo tocarem na prévia. */
function sampleTone(): Blob {
  const rate = 16000
  const n = rate * 2
  const buf = new DataView(new ArrayBuffer(44 + n * 2))
  const str = (o: number, s: string) => [...s].forEach((c, i) => buf.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF'); buf.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt ')
  buf.setUint32(16, 16, true); buf.setUint16(20, 1, true); buf.setUint16(22, 1, true)
  buf.setUint32(24, rate, true); buf.setUint32(28, rate * 2, true); buf.setUint16(32, 2, true); buf.setUint16(34, 16, true)
  str(36, 'data'); buf.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) {
    const t = i / rate
    const env = Math.min(1, t * 8) * Math.exp(-t * 1.6)
    buf.setInt16(44 + i * 2, Math.sin(2 * Math.PI * 440 * t) * env * 9000, true)
  }
  return new Blob([buf], { type: 'audio/wav' })
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
    const i = liveCategories().findIndex((c) => c.id === n.categoryId)
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

/** Estado Yjs entregue ao editor por nota (base das atualizações dele). */
const states = new Map<string, Uint8Array>()

/** Cria ou atualiza. Sem mudança de conteúdo, não mexe (nem na data): abrir e fechar não "edita" a nota. */
function saveNote(input: NoteInput) {
  const prev = notes.get(input.id)
  const next: NoteInput = { ...input, body: structuredClone(input.body), tags: [...new Set(input.tags)] }
  if (prev && sameContent(prev, next)) return
  const now = Date.now()
  notes.set(next.id, { ...next, createdAt: prev?.createdAt ?? now, updatedAt: now, files: prev?.files ?? [], position: prev?.position ?? minPosition() - STEP })
  changed()
}

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
    return done(activeIn(filter).flatMap((n) => rowsFor(n, [...project(n.body).images, ...project(n.body).files, ...n.files])).filter(fileMatches(query)))
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
      files: live.flatMap((n) => rowsFor(n, [...project(n.body).images, ...project(n.body).files, ...n.files])).filter(fileMatches(query)).length,
      moodboard: found.reduce((s, n) => s + project(n.body).images.length, 0),
    })
  },

  listCategories() {
    const live = [...notes.values()].filter(isLive)
    return done(liveCategories().map<Category>((c) => ({ id: c.id, name: c.name, color: c.color, icon: null, noteCount: live.filter((n) => n.categoryId === c.id).length })))
  },

  createCategory(name, color) {
    const c = { id: uuidv7(), name: name.trim(), color, deleted: false }
    categories.push(c)
    changed()
    return done({ id: c.id, name: c.name, color, icon: null, noteCount: 0 })
  },

  updateCategory(id, p) {
    const c = categories.find((x) => x.id === id)
    if (c) {
      if (p.name?.trim()) c.name = p.name.trim()
      if (p.color) c.color = p.color
      changed()
    }
    return done(undefined)
  },

  deleteCategory(id) {
    const c = categories.find((x) => x.id === id)
    const ids: string[] = []
    if (c) {
      c.deleted = true
      for (const n of notes.values()) if (n.categoryId === id) (n.categoryId = null), ids.push(n.id)
      changed()
    }
    return done(ids)
  },

  restoreCategory(id, noteIds) {
    const c = categories.find((x) => x.id === id)
    if (c) {
      c.deleted = false
      for (const nid of noteIds) {
        const n = notes.get(nid)
        if (n) n.categoryId = id
      }
      changed()
    }
    return done(undefined)
  },

  renameTag(from, to) {
    const next = to ? normalizeTag(to) : null
    let count = 0
    const re = new RegExp(`(^|[^\\p{L}\\d_])#${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\d_-])`, 'giu')
    const rewrite = (node: RichNode) => {
      if (node.type === 'text' && node.text) node.text = node.text.replace(re, (_m, pre: string) => `${pre}${next ? `#${next}` : from}`)
      node.content?.forEach(rewrite)
    }
    for (const n of notes.values()) {
      if (!tagsOf(n).includes(from)) continue
      count++
      n.tags = [...new Set(n.tags.flatMap((t) => (t === from ? (next ? [next] : []) : [t])))]
      const body = structuredClone(n.body)
      rewrite(body)
      n.body = body
    }
    if (count) changed()
    return done(count)
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
    const p = project(n.body)
    return done({
      ...structuredClone(rest),
      files: files.flatMap((h) => attachments.get(h) ?? []),
      media: [...p.images, ...p.files].flatMap((h) => attachments.get(h) ?? []),
    })
  },

  // O editor abre a nota como Y.Doc. O mock guarda JSON: monta o estado e guarda o que entregou, para as
  // atualizações do editor se aplicarem sobre a mesma base (como no núcleo).
  getNoteState(id) {
    const n = notes.get(id)
    const state = n ? noteToState(n) : new Uint8Array()
    states.set(id, state)
    return done(state)
  },

  applyNoteUpdate(id, update) {
    const base = states.get(id) ?? (notes.has(id) ? noteToState(notes.get(id)!) : new Uint8Array())
    const doc = new Y.Doc()
    if (base.length) Y.applyUpdate(doc, base)
    Y.applyUpdate(doc, update)
    const state = Y.encodeStateAsUpdate(doc)
    states.set(id, state)
    saveNote(stateToNote(id, state))
    return done(undefined)
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
  getAttachments: (hashes) => done(hashes.flatMap((h) => attachments.get(h) ?? [])),

  mediaUrl(hash) {
    const known = imageSrc.get(hash) ?? blobSrc.get(hash)
    if (known) return known
    // Áudios de exemplo não têm conteúdo: um tom curto gerado aqui deixa o player funcionar na prévia.
    if (attachments.get(hash)?.kind === 'audio') {
      const url = URL.createObjectURL(sampleTone())
      blobSrc.set(hash, url)
      return url
    }
    return ''
  },

  // No navegador os arquivos arrastados chegam como File (importFile); caminhos só existem no app.
  async importPath() {
    throw new Error('importPath só existe no app')
  },
  async importFile(file, name) {
    const mime = file.type || 'application/octet-stream'
    const kind = kindOf(mime, name)
    const url = URL.createObjectURL(file)
    let width: number | null = null
    let height: number | null = null
    if (kind === 'image') {
      // Na Fase 3 o núcleo passa a foto pelo pipeline (EXIF, WebP, miniatura, paleta); aqui só lemos o tamanho.
      const img = await createImageBitmap(file).catch(() => null)
      width = img?.width ?? 4
      height = img?.height ?? 3
      img?.close()
    }
    const a: Attachment = {
      hash: `imp-${uuidv7()}`, kind, mime, name, bytes: file.size, origBytes: null,
      width, height, palette: null, tone: null, addedAt: Date.now(),
    }
    attachments.set(a.hash, a)
    blobSrc.set(a.hash, url)
    if (kind === 'image') imageSrc.set(a.hash, url)
    return a
  },

  async downloadAttachment(a) {
    // Prévia: imagens baixam a própria figura; os demais anexos de exemplo não têm conteúdo, então vai um arquivo de texto.
    const real = blobSrc.get(a.hash)
    if (real) {
      Object.assign(document.createElement('a'), { href: real, download: a.name }).click()
      return null
    }
    const src = imageSrc.get(a.hash)
    const url = src || URL.createObjectURL(new Blob([`Arquivo de exemplo do Ideario: ${a.name}\n`], { type: 'text/plain' }))
    const link = Object.assign(document.createElement('a'), { href: url, download: src ? a.name.replace(/\.\w+$/, '') + '.svg' : a.name })
    link.click()
    if (!src) setTimeout(() => URL.revokeObjectURL(url), 1000)
    return null
  },
  subscribe(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },

  subscribeSync(fn) {
    syncListeners.add(fn)
    return () => syncListeners.delete(fn)
  },
}
