// Ícone e nome de cada tipo de anexo. Um lugar só, para Arquivos, editor, cards e filtros usarem os mesmos.
import { File, FileAudio, FileSpreadsheet, FileText, FileVideoCamera, Image } from '@lucide/svelte'
import type { AttachmentKind } from './types'

export const KIND_ICONS: Record<AttachmentKind, typeof File> = {
  image: Image, pdf: FileText, doc: File, sheet: FileSpreadsheet, audio: FileAudio, video: FileVideoCamera, other: File,
}

export const KIND_LABELS: Record<AttachmentKind, string> = {
  image: 'Imagem', pdf: 'PDF', doc: 'Documento', sheet: 'Planilha', audio: 'Áudio', video: 'Vídeo', other: 'Arquivo',
}
