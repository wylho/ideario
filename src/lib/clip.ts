// Marca com [data-clipped] os elementos cujo conteúdo passa da altura máxima, para o CSS esmaecer o fim.
// Um ResizeObserver só para todos os cards.

const mark = (el: Element) => el.toggleAttribute('data-clipped', el.scrollHeight > el.clientHeight + 2)

const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver((entries) => entries.forEach((e) => mark(e.target)))

/** Attachment: observa o elemento enquanto ele existir. */
export function watchClip(el: HTMLElement) {
  mark(el)
  observer?.observe(el)
  return () => observer?.unobserve(el)
}
