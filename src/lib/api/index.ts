// Camada de dados da UI. Na Fase 0 é atendida por um mock em memória;
// na Fase 1 a mesma interface passa a chamar os comandos Tauri (`invoke`) do núcleo Rust.
import type {
  AttachmentRow, Box, Category, Filter, NoteDetail, NoteInput, NotePatch, NoteSort, NoteSummary, Settings, SyncState, SyncStatus, TagCount, Tone, ViewCounts,
} from '../types'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { mockApi } from './mock'

export interface Api {
  listNotes(p: { filter: Filter; box: Box; query: string; sort: NoteSort }): Promise<NoteSummary[]>
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
  /** Quantas notas há na lixeira (para mostrar "Esvaziar lixeira" só quando há o que esvaziar). */
  trashCount(): Promise<number>
  /** Apaga para sempre tudo o que está na lixeira. Devolve quantas notas saíram. */
  emptyTrash(): Promise<number>
  /** Muda metadados sem abrir o editor (menus de contexto). */
  updateNote(id: string, patch: NotePatch): Promise<void>
  /** Ordem personalizada: coloca a nota entre `after` e `before` (ids vizinhos; null nas pontas). */
  moveNote(id: string, p: { after: string | null; before: string | null }): Promise<void>
  /** Passa a ordem personalizada a ser igual à ordem `sort` atual (ao começar a arrastar numa ordem por data). */
  adoptOrder(sort: NoteSort): Promise<void>
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
  /** Salva uma cópia do anexo onde o usuário escolher (no app: diálogo "Salvar como"; no navegador: download). */
  downloadAttachment(a: Pick<AttachmentRow, 'hash' | 'name' | 'mime'>): Promise<void>
  /** Imagens disponíveis no seletor do editor. Só existe enquanto não há importação real (Fase 3). */
  sampleImages(): Promise<AttachmentRow[]>

  /** Avisa quando os dados mudam (edição local ou, no futuro, sync). Devolve a função de cancelamento. */
  subscribe(fn: () => void): () => void
  /** Avisa mudanças no estado da sincronização (sincronizando, sem conexão, erro, ok). */
  subscribeSync(fn: (s: SyncState) => void): () => void
}

export const api: Api = mockApi

/** Versão do núcleo Rust; `null` quando a UI roda fora do Tauri (navegador). */
export const coreVersion = (): Promise<string | null> => (isTauri() ? invoke<string>('app_version') : Promise.resolve(null))
