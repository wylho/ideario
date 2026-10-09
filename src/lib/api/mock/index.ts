// Implementação em memória da camada de dados (Fase 0).
// Faz o papel do núcleo Rust: guarda as notas, projeta as colunas derivadas
// (trecho, checklist, capa) e responde às consultas das abas.
import type { Api } from '..'
import { fold, hashTags } from '../../format'
import type {
  Attachment, AttachmentRow, Box, Category, ChecklistItem, Filter, NoteInput, NoteSummary, RichDoc, RichNode, Settings, TagCount,
} from '../../types'
import { fakeImageSrc } from './fake-images'
import { DAY, SEED_CATEGORIES, SEED_FILES, SEED_IMAGES, seedNotes } from './seed'

/** `tags` guarda só as tags manuais; as `#tags` do corpo são derivadas na projeção. */
interface StoredNote extends NoteInput {
  createdAt: number
  updatedAt: number
  /** Hashes dos anexos que não estão no corpo. */
  files: string[]
}

interface Projection {
  text: string
  images: string[]
  checklist: ChecklistItem[]
  hashTags: string[]
}

const TRASH_DAYS = 30

const notes = new Map<string, StoredNote>()
const attachments = new Map<string, Attachment>()
const imageSrc = new Map<string, string>()
const listeners = new Set<() => void>()
const projections = new WeakMap<RichDoc, Projection>()
let settings: Settings = { wifiOnly: true, keepOriginals: false, photoQuality: 'balanced', cacheLimitGb: 2 }

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
  })
  // Imagens herdam a data da nota em que entraram.
  for (const h of project(body).images) {
    const a = attachments.get(h)
    if (a && !a.addedAt) a.addedAt = s.updatedAt
  }
}
purgeTrash()

// ---------- projeção ----------
function project(body: RichDoc): Projection {
  const cached = projections.get(body)
  if (cached) return cached
  const out: string[] = []
  const images: string[] = []
  const checklist: ChecklistItem[] = []
  const plain = (n: RichNode): string => n.text ?? (n.content ?? []).map(plain).join(' ')
  const walk = (n: RichNode) => {
    if (n.type === 'text') return void out.push(n.text ?? '')
    if (n.type === 'hardBreak') return void out.push(' ')
    if (n.type === 'noteImage') {
      if (typeof n.attrs?.hash === 'string') images.push(n.attrs.hash)
      return
    }
    if (n.type === 'taskList') {
      for (const item of n.content ?? []) checklist.push({ text: plain(item).replace(/\s+/g, ' ').trim(), done: !!item.attrs?.checked })
      return
    }
    n.content?.forEach(walk)
    out.push(' ')
  }
  walk(body)
  const text = out.join('').replace(/\s+/g, ' ').trim()
  const p = { text, images, checklist, hashTags: hashTags(text) }
  projections.set(body, p)
  return p
}

const tagsOf = (n: StoredNote) => [...new Set([...n.tags, ...project(n.body).hashTags])]

function summarize(n: StoredNote): NoteSummary {
  const p = project(n.body)
  const first = p.images[0] ? attachments.get(p.images[0]) : undefined
  return {
    id: n.id, title: n.title, excerpt: p.text.slice(0, 280), checklist: p.checklist.slice(0, 4), checklistTotal: p.checklist.length,
    cover: first ? { hash: first.hash, width: first.width ?? 4, height: first.height ?? 3 } : null, imageCount: p.images.length, fileCount: n.files.length,
    categoryId: n.categoryId, color: n.color, pinned: n.pinned, archived: n.archived, trashedAt: n.trashedAt,
    reminderAt: n.reminderAt, reminderDone: n.reminderDone, tags: tagsOf(n), createdAt: n.createdAt, updatedAt: n.updatedAt,
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

function rowsFor(n: StoredNote, hashes: string[]): AttachmentRow[] {
  return hashes.flatMap((h) => {
    const a = attachments.get(h)
    return a ? [{ ...a, noteId: n.id, noteTitle: n.title || 'Sem título', categoryId: n.categoryId }] : []
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
}

const done = <T>(v: T) => Promise.resolve(v)

export const mockApi: Api = {
  listNotes({ filter, box, query }) {
    return done([...notes.values()].filter((n) => inBox(n, box) && passes(n, filter) && matches(n, query)).sort(byRecent).map(summarize))
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
    notes.set(next.id, { ...next, createdAt: prev?.createdAt ?? now, updatedAt: now, files: prev?.files ?? [] })
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

  deleteNote(id) {
    if (notes.delete(id)) changed()
    return done(undefined)
  },

  getSettings: () => done({ ...settings }),
  saveSettings(s) {
    settings = { ...s }
    return done(undefined)
  },
  syncStatus: () =>
    done({ connected: true, lastSyncAt: Date.now() - 2 * 60_000, noteCount: notes.size, cacheUsedBytes: 310 * 1024 * 1024 }),

  imageUrl: (hash) => imageSrc.get(hash) ?? '',
  sampleImages: () =>
    done([...attachments.values()].filter((a) => a.kind === 'image').map((a) => ({ ...a, noteId: '', noteTitle: '', categoryId: null }))),

  subscribe(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
}
