import * as Y from 'yjs'
import type { NoteInput } from './types'

// Nota como Y.Doc (SPEC §5), o mesmo formato do núcleo (src-tauri/src/ydoc.rs):
// `meta` (Y.Map) com os metadados, cada um uma chave (cada uma faz merge sozinha), e `body` (Y.XmlFragment) com o
// conteúdo do editor, escrito pelo TipTap Collaboration.

export type NoteMeta = Omit<NoteInput, 'id' | 'body'>

export const META = 'meta'
export const BODY = 'body'

const KEYS = ['title', 'categoryId', 'color', 'pinned', 'archived', 'trashedAt', 'reminderAt', 'reminderDone', 'reminderRepeat', 'tags'] as const

export function readMeta(doc: Y.Doc): NoteMeta {
  const m = doc.getMap<unknown>(META)
  const str = (k: string) => (typeof m.get(k) === 'string' ? (m.get(k) as string) : null)
  const num = (k: string) => (typeof m.get(k) === 'number' ? (m.get(k) as number) : null)
  const tags = m.get('tags')
  return {
    title: str('title') ?? '',
    categoryId: str('categoryId'),
    color: (str('color') ?? 'none') as NoteMeta['color'],
    pinned: m.get('pinned') === true,
    archived: m.get('archived') === true,
    trashedAt: num('trashedAt'),
    reminderAt: num('reminderAt'),
    reminderDone: m.get('reminderDone') === true,
    reminderRepeat: (['day', 'week', 'month', 'year'] as const).find((r) => r === m.get('reminderRepeat')) ?? null,
    tags: Array.isArray(tags) ? tags.filter((t): t is string => typeof t === 'string') : [],
  }
}

/** Grava só as chaves que mudaram (todas, se o mapa ainda estiver vazio). */
export function writeMeta(doc: Y.Doc, meta: NoteMeta, origin?: unknown) {
  const m = doc.getMap<unknown>(META)
  const prev = readMeta(doc)
  const fresh = m.size === 0
  doc.transact(() => {
    for (const k of KEYS) {
      const v = meta[k]
      const same = Array.isArray(v) ? JSON.stringify(v) === JSON.stringify(prev[k]) : v === prev[k]
      if (fresh || !same) m.set(k, Array.isArray(v) ? [...v] : v)
    }
  }, origin)
}
