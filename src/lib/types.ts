// Tipos compartilhados entre a UI e a camada de dados.
// Espelham o que o núcleo Rust vai devolver (SPEC §5): a UI recebe dados prontos
// para exibir (trecho, capa, contagens) e nunca parseia o corpo da nota.

export type NoteColor = 'none' | 'sand' | 'sage' | 'sky' | 'rose' | 'lilac' | 'butter'
/** Repetição do lembrete (todo dia, semana, mês, ano). */
export type RepeatKind = 'day' | 'week' | 'month' | 'year'
export type Tone = 'quente' | 'frio' | 'verde' | 'rosa' | 'neutro'
export type AttachmentKind = 'image' | 'pdf' | 'doc' | 'sheet' | 'audio' | 'video' | 'other'
/** Grupos do filtro de Arquivos: planilhas e o resto entram em "Outros documentos". */
export type FileGroup = 'pdf' | 'doc' | 'image' | 'audio' | 'video'
/** Ordem dos grupos (a mesma do filtro na barra superior). */
export const FILE_GROUPS: FileGroup[] = ['pdf', 'doc', 'image', 'audio', 'video']
export const fileGroup = (k: AttachmentKind): FileGroup => (k === 'sheet' || k === 'other' ? 'doc' : k)

/** Epoch em milissegundos. */
export type Millis = number

export interface Category {
  id: string
  name: string
  color: string
  icon: string | null
  /** Notas visíveis (fora do arquivo e da lixeira). */
  noteCount: number
}

export interface TagCount {
  name: string
  count: number
}

/**
 * Bloco da prévia do card, na ordem do documento. Preserva a estrutura (título, parágrafo,
 * tópico, lista numerada, tarefa) em vez de achatar tudo num texto corrido.
 */
export type PreviewBlock =
  | { kind: 'heading' | 'text'; text: string }
  | { kind: 'bullet'; text: string; depth: number }
  | { kind: 'ordered'; text: string; n: number; depth: number }
  | { kind: 'task'; text: string; done: boolean; depth: number }
  /** Anexo no meio do texto (vídeo, áudio, PDF…): mostrado como uma linha com ícone. */
  | { kind: 'file'; text: string; fileKind: AttachmentKind; hash: string }
  /** Bloco de código: as primeiras linhas, sem formatação. */
  | { kind: 'code'; text: string }
  /** Tarefas que não couberam na prévia (máx. 4) ou texto cortado. */
  | { kind: 'more'; count: number }

/** Projeção de uma nota para listas e cards (colunas derivadas do Y.Doc). */
export interface NoteSummary {
  id: string
  title: string
  /** Título, ou a primeira linha do texto quando não há título. Para listas de uma linha (Lembretes, Arquivos). */
  label: string
  preview: PreviewBlock[]
  /** Capa: a primeira foto do corpo, ou a primeira linha de fotos lado a lado (até 4), com dimensões
   *  para reservar o espaço no card. Vazia quando a nota não tem foto. */
  cover: { hash: string; width: number; height: number }[]
  imageCount: number
  /** Anexos que não são imagem (PDF, documentos, planilhas, áudio, vídeo), no corpo ou à parte. */
  fileCount: number
  categoryId: string | null
  color: NoteColor
  pinned: boolean
  archived: boolean
  trashedAt: Millis | null
  reminderAt: Millis | null
  reminderDone: boolean
  reminderRepeat: RepeatKind | null
  tags: string[]
  createdAt: Millis
  updatedAt: Millis
  /** Posição na ordem personalizada (menor vem antes). */
  position: number
}

export interface Attachment {
  hash: string
  kind: AttachmentKind
  mime: string
  name: string
  bytes: number
  origBytes: number | null
  width: number | null
  height: number | null
  palette: string[] | null
  tone: Tone | null
  addedAt: Millis
}

/** Anexo listado na aba Arquivos ou no Moodboard, com a nota de origem. */
export interface AttachmentRow extends Attachment {
  noteId: string
  noteTitle: string
  categoryId: string | null
}

/** Nó do documento rico (formato JSON do TipTap/ProseMirror). */
export interface RichNode {
  type: string
  attrs?: Record<string, any>
  content?: RichNode[]
  text?: string
  marks?: { type: string; attrs?: Record<string, any> }[]
}

/** Documento do editor. Na Fase 2 passa a viver num Y.XmlFragment. */
export type RichDoc = RichNode & { type: 'doc' }

export interface NoteDetail {
  id: string
  title: string
  body: RichDoc
  categoryId: string | null
  color: NoteColor
  pinned: boolean
  archived: boolean
  trashedAt: Millis | null
  reminderAt: Millis | null
  reminderDone: boolean
  reminderRepeat: RepeatKind | null
  /** Tags manuais. As `#tags` do corpo são derivadas e não ficam aqui. */
  tags: string[]
  /** Anexos que não aparecem no corpo (arquivos). */
  files: Attachment[]
  /** Anexos usados no corpo (fotos, vídeos, áudios, documentos inline), para o editor desenhar sem esperar. */
  media: Attachment[]
  createdAt: Millis
  updatedAt: Millis
}

/** Campos que os menus de contexto mudam sem abrir o editor. */
export type NotePatch = Partial<Pick<NoteInput, 'pinned' | 'color' | 'categoryId' | 'archived' | 'trashedAt' | 'reminderAt' | 'reminderDone' | 'reminderRepeat'>>

export interface NoteInput {
  id: string
  title: string
  body: RichDoc
  categoryId: string | null
  color: NoteColor
  pinned: boolean
  archived: boolean
  trashedAt: Millis | null
  reminderAt: Millis | null
  reminderDone: boolean
  reminderRepeat: RepeatKind | null
  tags: string[]
}

/**
 * O que ver. Independe da visão (como ver): trocar uma nunca desfaz a outra.
 * Categoria e tags se combinam (a nota precisa ter todas as tags).
 */
export interface Filter {
  categoryId: string | null
  tags: string[]
}

/** Notas ativas, arquivadas ou na lixeira. Arquivo e Lixeira só existem na visão Notas. */
export type Box = 'active' | 'archive' | 'trash'

/** Quantos itens cada visão tem para o filtro atual, para mostrar antes do clique. */
export interface ViewCounts {
  notes: number
  /** Lembretes pendentes. */
  reminders: number
  overdue: number
  files: number
  moodboard: number
}

export type View = 'notes' | 'reminders' | 'files' | 'moodboard'

/** Ordem das notas. 'custom' é a ordem livre, montada arrastando os cards. */
export type NoteSort = 'custom' | 'updated' | 'created' | 'category' | 'title'

export type FileSort = 'recent' | 'name' | 'size' | 'kind'

/** 'original': a foto fica como veio (sem redimensionar nem recomprimir). */
export type PhotoQuality = 'economy' | 'balanced' | 'high' | 'original'

export interface Settings {
  wifiOnly: boolean
  photoQuality: PhotoQuality
  /** Limite do cache em GB (0,5 a 5). */
  cacheLimitGb: number
}

/** Estado da sincronização com o Drive. Só o que não é 'ok' aparece na interface. */
export type SyncState = 'ok' | 'syncing' | 'offline' | 'error'

export interface SyncStatus {
  connected: boolean
  lastSyncAt: Millis | null
  noteCount: number
  cacheUsedBytes: number
}

/** Resumo de uma importação do Google Keep. */
export interface KeepReport {
  notes: number
  /** Já tinham entrado antes. */
  skipped: number
  photos: number
  /** Citadas nas notas mas fora do zip. */
  missingMedia: number
  /** Marcadores que viraram categorias novas. */
  categories: string[]
  archived: number
  trashed: number
}
