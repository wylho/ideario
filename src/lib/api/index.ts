// Camada de dados da UI. No app, os comandos Tauri (`invoke`) do núcleo Rust (SQLite local, Fase 1);
// no navegador (`npm run dev`, prévia) e nos testes e2e, um mock em memória com dados de exemplo.
import type {
  Attachment, AttachmentKind, AttachmentRow, KeepReport, Box, Millis, Category, Filter, NoteDetail, NoteInput, NotePatch, NoteSort, NoteSummary, Settings, SyncState, SyncStatus, TagCount, Tone, ViewCounts,
} from '../types'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { mockApi } from './mock'
import { tauriApi } from './tauri'

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
  createCategory(name: string, color: string): Promise<Category>
  updateCategory(id: string, p: { name?: string; color?: string }): Promise<void>
  /** Apaga a categoria (as notas ficam sem categoria). Devolve as notas que estavam nela, para o Desfazer. */
  deleteCategory(id: string): Promise<string[]>
  restoreCategory(id: string, noteIds: string[]): Promise<void>
  listTags(): Promise<TagCount[]>
  /** Renomeia a tag em todas as notas (manuais e #tags do texto); com `to` null, tira a tag (a palavra fica no texto). */
  renameTag(from: string, to: string | null): Promise<number>

  getNote(id: string): Promise<NoteDetail | null>
  /** Cria ou atualiza. `tags` são as manuais; as `#palavra` do corpo entram na projeção. */
  /** Estado Yjs da nota (vazio se ela ainda não existe): o editor abre o Y.Doc com ele. */
  getNoteState(id: string): Promise<Uint8Array>
  /** Atualização Yjs do editor; cria a nota se ela ainda não existe. A lista e a busca se atualizam. */
  applyNoteUpdate(id: string, update: Uint8Array): Promise<void>
  setReminderDone(id: string, done: boolean): Promise<void>
  /** Adiar até `until`. O que se repete avisa de novo nessa hora sem mudar o horário da série. */
  snoozeReminder(id: string, until: Millis): Promise<void>
  /** Concluir. O que se repete pula para a próxima vez (a série continua). */
  completeReminder(id: string): Promise<void>
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
  /** Entrar com o Google: abre o navegador e resolve quando o login volta (ou falha). */
  syncSignIn(): Promise<SyncStatus>
  /** Desiste do login em andamento. */
  syncCancelSignIn(): Promise<void>
  /** Sai da conta: as notas continuam neste aparelho. */
  syncSignOut(): Promise<void>
  /** Sincroniza agora (o resultado chega por `subscribeSync`). */
  syncNow(): Promise<void>
  /** A janela voltou ao primeiro plano: sincroniza se já faz um tempo. */
  syncFocus(): void

  /** URL local de uma imagem (miniatura ou tamanho cheio). Nunca depende de rede. */
  imageUrl(hash: string, size?: 'thumb' | 'full'): string
  /** Dados dos anexos (para desenhar fotos e anexos colados de outra nota). */
  getAttachments(hashes: string[]): Promise<Attachment[]>
  /** URL local para tocar ou mostrar um anexo (vídeo, áudio, imagem). Vazia se o conteúdo não está aqui. */
  mediaUrl(hash: string): string
  /** Importa um arquivo do computador (ou uma gravação) e devolve o anexo pronto para entrar na nota. */
  importFile(file: Blob, name: string): Promise<Attachment>
  /** PDFs e vídeos sem prévia ainda (a interface gera a imagem; no navegador, nenhum). */
  pendingPreviews(): Promise<{ hash: string; kind: AttachmentKind }[]>
  /** Prévia em PNG (primeira página do PDF, um quadro do vídeo); vazio = não foi possível. */
  setPreview(hash: string, png: Uint8Array): Promise<void>
  /** É um Takeout do Google Keep? Quantas notas e mídias (null = um zip qualquer). Só no app. */
  inspectTakeout(path: string): Promise<{ notes: number; media: number } | null>
  /** Importa o Takeout (a lista se atualiza no fim). Só no app. */
  importKeep(path: string, onProgress: (done: number, total: number) => void): Promise<KeepReport>
  /** Só no app: importa pelo caminho um arquivo arrastado do sistema (lido no núcleo). */
  importPath(path: string): Promise<Attachment>
  /** Salva uma cópia do anexo (no app: na pasta Downloads, e devolve o caminho; no navegador: download, e devolve null). */
  downloadAttachment(a: Pick<AttachmentRow, 'hash' | 'name' | 'mime'>): Promise<string | null>

  /** Avisos de mudança que estavam esperando (a escrita no editor parou ou a nota fechou) saem agora. */
  settle(): void
  /** Avisa quando os dados mudam (edição local ou sync). Devolve a função de cancelamento. */
  subscribe(fn: () => void): () => void
  /** Avisa mudanças no estado da sincronização (sincronizando, sem conexão, erro, ok). */
  subscribeSync(fn: (s: SyncState) => void): () => void
  /** Notas que mudaram por causa de outro aparelho (o editor aberto numa delas junta na hora). */
  subscribeRemote(fn: (ids: string[]) => void): () => void
  /** Notas excluídas de vez em outro aparelho (o editor aberto numa delas avisa). */
  subscribeRemoved(fn: (ids: string[]) => void): () => void
}

export const api: Api = isTauri() ? tauriApi : mockApi

/** Versão do núcleo Rust; `null` quando a UI roda fora do Tauri (navegador). */
export const coreVersion = (): Promise<string | null> => (isTauri() ? invoke<string>('app_version') : Promise.resolve(null))
