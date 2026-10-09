import type { NoteSummary } from './types'

/**
 * Altura aproximada de um card de nota (px) numa coluna de largura `w`.
 * Só serve para distribuir os cards entre as colunas da masonry; não precisa ser exata.
 * Os números seguem os estilos de `.card` em app.css.
 */
export function estimateCard(n: NoteSummary, w: number): number {
  const inner = Math.max(80, w - 26)
  const lines = (text: string, charPx: number, max = Infinity) => Math.min(max, Math.ceil(text.length / Math.max(8, inner / charPx)))
  const pillsHeight = (files = n.fileCount > 0) => {
    const px = (n.reminderAt != null ? 120 : 0) + (n.categoryId ? 80 : 0) + (files ? 40 : 0) + n.tags.reduce((s, t) => s + t.length * 6.5 + 24, 0)
    return px ? Math.ceil(px / inner) * 26 + 2 : 0
  }
  let h = 26 // padding do corpo
  // Capa: uma foto ou uma linha de fotos com a mesma altura (largura / soma das proporções).
  if (n.cover.length) h += Math.min(260, (w - 2 * (n.cover.length - 1)) / n.cover.reduce((s, c) => s + c.width / c.height, 0))
  if (n.title) h += lines(n.title, 9) * 20 + 6
  // Só um anexo: miniatura quadrada (até 220 px) e o nome do arquivo numa linha.
  if (!n.cover.length && n.preview.length === 1 && n.preview[0].kind === 'file') {
    return h + Math.min(w, 220) + 20 + pillsHeight(false) // sem a pílula do clipe
  }
  let pv = 0
  for (const b of n.preview) {
    if (b.kind === 'more') pv += 20
    else if (b.kind === 'heading') pv += lines(b.text, 8) * 20 + 4
    else if (b.kind === 'file') pv += 24
    else if (b.kind === 'code') pv += b.text.split('\n').length * 16.7 + 16
    else if (b.kind === 'text') pv += lines(b.text, n.title ? 6.6 : 7.8) * (n.title ? 19.6 : 23) + 3
    else pv += lines(b.text, 6.6) * 19.6 + 3
  }
  // Mesma altura máxima da prévia que o CSS aplica (.preview).
  if (pv) h += Math.min(pv, previewMax(n.cover.length > 0, w)) + 6
  return h + pillsHeight()
}

/** Altura máxima da prévia no card: menor com capa e em colunas estreitas. Espelha o CSS. */
export function previewMax(hasCover: boolean, colWidth: number) {
  if (colWidth < 200) return hasCover ? 150 : 220
  return hasCover ? 190 : 300
}
