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
  if (n.excerpt) h += n.title ? lines(n.excerpt, 6.6, 6) * 19.6 + 6 : lines(n.excerpt, 7.8, 6) * 23 + 6
  if (n.checklist.length) h += (n.checklist.length + (n.checklistTotal > n.checklist.length ? 1 : 0)) * 22 + 6
  const pills =
    (n.reminderAt != null ? 120 : 0) + (n.categoryId ? 80 : 0) + (n.fileCount ? 40 : 0) + n.tags.reduce((s, t) => s + t.length * 6.5 + 24, 0)
  if (pills) h += Math.ceil(pills / inner) * 26 + 2
  return h
}
