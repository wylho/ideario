// Camada de dados da UI. Na Fase 0 é atendida por um mock em memória;
// na Fase 1 a mesma interface passa a chamar os comandos Tauri (`invoke`) do núcleo Rust.
import type {
  AttachmentRow, Box, Category, Filter, NoteDetail, NoteInput, NotePatch, NoteSummary, Settings, SyncStatus, TagCount, Tone, ViewCounts,
} from '../types'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { mockApi } from './mock'

export interface Api {
  listNotes(p: { filter: Filter; box: Box; query: string }): Promise<NoteSummary[]>
  listReminders(p: { filter: Filter; query: string; includeDone: boolean }): Promise<NoteSummary[]>
  /** Todos os anexos (fotos e arquivos) das notas ativas que passam no filtro. */
  listAttachments(p: { filter: Filter; query: string }): Promise<AttachmentRow[]>
  /** Imagens das notas ativas que passam no filtro, para o Moodboard. */
  listImages(p: { filter: Filter; query: string; tone: Tone | null }): Promise<AttachmentRow[]>
  /** Contagem por visão para o filtro e a busca atuais (notas ativas). */
  viewCounts(p: { filter: Filter; query: string }): Promise<ViewCounts>
  listCategories(): Promise<Category[]>
  listTags(): Promise<TagCount[]>

  getNote(id: string): Promise<NoteDetail | null>
  /** Cria ou atualiza. `tags` são as manuais; as `#palavra` do corpo entram na projeção. */
  saveNote(input: NoteInput): Promise<NoteSummary>
  setReminderDone(id: string, done: boolean): Promise<void>
  /** Muda metadados sem abrir o editor (menus de contexto). */
  updateNote(id: string, patch: NotePatch): Promise<void>
  /** Cria uma cópia da nota (sem lembrete) e devolve o id da nova. */
  duplicateNote(id: string): Promise<string>
  /** Texto da nota para copiar, com a estrutura em texto simples (tópicos, tarefas). */
  noteText(id: string): Promise<string>
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
