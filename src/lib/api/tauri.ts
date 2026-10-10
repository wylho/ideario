// A interface `Api` atendida pelo núcleo Rust (comandos em src-tauri/src/commands.rs). Tudo local: SQLite no aparelho.
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import type { Api } from '.'
import type { SyncState } from '../types'

const listeners = new Set<() => void>()
const changed = () => listeners.forEach((fn) => fn())

// O núcleo também muda dados sozinho (lembrete que se repete, botões da notificação, importação): avisa a UI.
void import('@tauri-apps/api/event').then(({ listen }) => listen('core-changed', changed)).catch(() => {})

/** Ouve um evento do núcleo; devolve a função que para de ouvir. */
function onEvent<T>(name: string, fn: (payload: T) => void): () => void {
  let stop: (() => void) | undefined
  let gone = false
  void import('@tauri-apps/api/event')
    .then(({ listen }) => listen<T>(name, (e) => fn(e.payload)))
    .then((un) => (gone ? un() : (stop = un)))
    .catch(() => {})
  return () => {
    gone = true
    stop?.()
  }
}

/** Comando que muda dados: avisa a UI para recarregar as listas quando termina. */
async function write<T>(cmd: string, args?: Parameters<typeof invoke>[1], options?: Parameters<typeof invoke>[2]): Promise<T> {
  const r = await invoke<T>(cmd, args, options)
  changed()
  return r
}

export const tauriApi: Api = {
  listNotes: ({ filter, box, query, sort }) => invoke('list_notes', { filter, box, query, sort }),
  listReminders: ({ filter, query, includeDone }) => invoke('list_reminders', { filter, query, includeDone }),
  listAttachments: ({ filter, query }) => invoke('list_attachments', { filter, query }),
  listImages: ({ filter, query, tone }) => invoke('list_images', { filter, query, tone }),
  viewCounts: ({ filter, query }) => invoke('view_counts', { filter, query }),

  listCategories: () => invoke('list_categories'),
  createCategory: (name, color) => write('create_category', { name, color }),
  updateCategory: (id, p) => write('update_category', { id, name: p.name ?? null, color: p.color ?? null }),
  deleteCategory: (id) => write('delete_category', { id }),
  restoreCategory: (id, noteIds) => write('restore_category', { id, noteIds }),
  listTags: () => invoke('list_tags'),
  renameTag: (from, to) => write('rename_tag', { from, to }),

  getNote: (id) => invoke('get_note', { id }),
  getNoteState: async (id) => new Uint8Array(await invoke<ArrayBuffer>('get_note_state', { id })),
  applyNoteUpdate: (id, update) => write('apply_note_update', update, { headers: { 'x-id': id } }),
  setReminderDone: (id, done) => write('set_reminder_done', { id, done }),
  trashCount: () => invoke('trash_count'),
  emptyTrash: () => write('empty_trash'),
  updateNote: (id, patch) => write('update_note', { id, patch }),
  moveNote: (id, { after, before }) => write('move_note', { id, after, before }),
  adoptOrder: (sort) => write('adopt_order', { sort }),
  duplicateNote: (id) => write('duplicate_note', { id }),
  noteText: (id) => invoke('note_text', { id }),
  deleteNote: (id) => write('delete_note', { id }),

  getSettings: () => invoke('get_settings'),
  saveSettings: (settings) => invoke('save_settings', { settings }),
  syncStatus: () => invoke('sync_status'),
  syncSignIn: () => write('sync_sign_in'),
  syncCancelSignIn: () => invoke('sync_cancel_sign_in'),
  syncSignOut: () => write('sync_sign_out'),
  syncNow: () => invoke('sync_now'),
  syncFocus: () => void invoke('sync_focus').catch(() => {}),

  // Fase 1: o arquivo é o próprio original; miniatura e versão otimizada chegam com o pipeline (Fase 3).
  // Miniatura (WebP ~400 px) para cards, Arquivos e Moodboard; a foto inteira no editor e no visualizador.
  imageUrl: (hash, size) => convertFileSrc(hash, 'att') + (size === 'thumb' ? '?thumb' : ''),
  mediaUrl: (hash) => convertFileSrc(hash, 'att'),
  getAttachments: (hashes) => invoke('get_attachments', { hashes }),
  async importFile(file, name) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    return invoke('import_file', bytes, { headers: { 'x-name': encodeURIComponent(name), 'x-mime': file.type } })
  },
  pendingPreviews: () => invoke('pending_previews'),
  setPreview: (hash, png) => invoke('set_preview', png, { headers: { 'x-hash': hash } }),
  inspectTakeout: (path) => invoke('inspect_takeout', { path }),
  async importKeep(path, onProgress) {
    const { listen } = await import('@tauri-apps/api/event')
    const stop = await listen<[number, number]>('keep-progress', (e) => onProgress(e.payload[0], e.payload[1]))
    try {
      return await write('import_keep', { path })
    } finally {
      stop()
    }
  },
  importPath: (path) => invoke('import_path', { path }),
  downloadAttachment: (a) => invoke<string>('download_attachment', { hash: a.hash, name: a.name }),

  subscribe(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
  subscribeSync: (fn) => onEvent<{ state: SyncState }>('sync-state', (p) => fn(p.state)),
  subscribeRemote: (fn) => onEvent<string[]>('notes-synced', fn),
}
