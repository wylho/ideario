// Camada de dados da UI. Na Fase 0 é atendida por um mock em memória;
// na Fase 1 a mesma interface passa a chamar os comandos Tauri (`invoke`) do núcleo Rust.
import type {
  AttachmentRow, Category, NoteDetail, NoteInput, NoteSummary, Scope, Settings, SyncStatus, TagCount, Tone,
} from '../types'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { mockApi } from './mock'

export interface Api {
  listNotes(p: { scope: Scope; query: string }): Promise<NoteSummary[]>
  listReminders(p: { query: string; includeDone: boolean }): Promise<NoteSummary[]>
  overdueCount(): Promise<number>
  /** Todos os anexos (fotos e arquivos) das notas visíveis no escopo. */
  listAttachments(p: { scope: Scope; query: string }): Promise<AttachmentRow[]>
  /** Imagens das notas visíveis no escopo, para o Moodboard. */
  listImages(p: { scope: Scope; query: string; tone: Tone | null }): Promise<AttachmentRow[]>
  listCategories(): Promise<Category[]>
  listTags(): Promise<TagCount[]>

  getNote(id: string): Promise<NoteDetail | null>
  /** Cria ou atualiza. `tags` são as manuais; as `#palavra` do corpo entram na projeção. */
  saveNote(input: NoteInput): Promise<NoteSummary>
  setReminderDone(id: string, done: boolean): Promise<void>
  /** Apaga definitivamente (só a partir da lixeira). */
  deleteNote(id: string): Promise<void>

  getSettings(): Promise<Settings>
  saveSettings(s: Settings): Promise<void>
  syncStatus(): Promise<SyncStatus>

  /** URL local de uma imagem (miniatura ou tamanho cheio). Nunca depende de rede. */
  imageUrl(hash: string, size?: 'thumb' | 'full'): string
  /** Imagens disponíveis no seletor do editor. Só existe enquanto não há importação real (Fase 3). */
  sampleImages(): Promise<AttachmentRow[]>

  /** Avisa quando os dados mudam (edição local ou, no futuro, sync). Devolve a função de cancelamento. */
  subscribe(fn: () => void): () => void
}

export const api: Api = mockApi

/** Versão do núcleo Rust; `null` quando a UI roda fora do Tauri (navegador). */
export const coreVersion = (): Promise<string | null> => (isTauri() ? invoke<string>('app_version') : Promise.resolve(null))
