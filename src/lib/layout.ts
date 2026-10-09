import type { NoteSummary } from './types'

/**
 * Altura aproximada de um card de nota (px) numa coluna de largura `w`.
 * Só serve para distribuir os cards entre as colunas da masonry; não precisa ser exata.
 * Os números seguem os estilos de `.card` em app.css.
 */
export function estimateCard(n: NoteSummary, w: number): number {
  const inner = Math.max(80, w - 26)
  const lines = (text: string, charPx: number, max = Infinity) => Math.min(max, Math.ceil(text.length / Math.max(8, inner / charPx)))
  let h = 26 // padding do corpo
  if (n.cover) h += Math.min(260, (w * n.cover.height) / n.cover.width)
  if (n.title) h += lines(n.title, 9) * 20 + 6
  let pv = 0
  for (const b of n.preview) {
    if (b.kind === 'more') pv += 20
    else if (b.kind === 'heading') pv += lines(b.text, 8) * 20 + 4
    else if (b.kind === 'code') pv += b.text.split('\n').length * 16.7 + 16
    else if (b.kind === 'text') pv += lines(b.text, n.title ? 6.6 : 7.8) * (n.title ? 19.6 : 23) + 3
    else pv += lines(b.text, 6.6) * 19.6 + 3
  }
  // Mesma altura máxima da prévia que o CSS aplica (.preview).
  if (pv) h += Math.min(pv, previewMax(!!n.cover, w)) + 6
  const pills =
    (n.reminderAt != null ? 120 : 0) + (n.categoryId ? 80 : 0) + (n.fileCount ? 40 : 0) + n.tags.reduce((s, t) => s + t.length * 6.5 + 24, 0)
  if (pills) h += Math.ceil(pills / inner) * 26 + 2
  return h
}

/** Altura máxima da prévia no card: menor com capa e em colunas estreitas. Espelha o CSS. */
export function previewMax(hasCover: boolean, colWidth: number) {
  if (colWidth < 200) return hasCover ? 150 : 220
  return hasCover ? 190 : 300
}
