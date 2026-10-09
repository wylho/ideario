// Seleção com retângulo: arrastar o mouse a partir de um espaço vazio marca as notas que o retângulo toca,
// como numa pasta do sistema. Com Ctrl/⌘ ou Shift, soma à seleção que já havia. Rola sozinho perto das bordas.
import { app } from './app.svelte'

export function marquee(content: HTMLElement) {
  let start: { x: number; y: number; scroll: number; base: Set<string> } | null = null
  let box: HTMLDivElement | null = null
  let last = { x: 0, y: 0 }
  let raf = 0
  let suppressClick = false

  const cards = () => [...content.querySelectorAll<HTMLElement>('[data-note-id]')]

  function update() {
    if (!start) return
    const top = Math.min(start.y - (content.scrollTop - start.scroll), last.y)
    const bottom = Math.max(start.y - (content.scrollTop - start.scroll), last.y)
    const left = Math.min(start.x, last.x)
    const right = Math.max(start.x, last.x)
    if (!box) {
      box = document.createElement('div')
      box.className = 'marquee'
      document.body.append(box)
      document.documentElement.classList.add('marquee-active')
    }
    Object.assign(box.style, { top: `${top}px`, left: `${left}px`, width: `${right - left}px`, height: `${bottom - top}px` })
    const hit = new Set(start.base)
    for (const c of cards()) {
      const r = c.getBoundingClientRect()
      if (r.right > left && r.left < right && r.bottom > top && r.top < bottom) hit.add(c.dataset.noteId!)
    }
    for (const id of [...app.selected]) if (!hit.has(id)) app.selected.delete(id)
    for (const id of hit) app.selected.add(id)
  }

  // Perto da borda de cima ou de baixo, rola e continua selecionando.
  function autoscroll() {
    if (!start) return
    const r = content.getBoundingClientRect()
    const edge = 40
    const dy = last.y < r.top + edge ? -(r.top + edge - last.y) : last.y > r.bottom - edge ? last.y - (r.bottom - edge) : 0
    if (dy) {
      content.scrollTop += Math.max(-24, Math.min(24, dy / 2))
      update()
    }
    raf = requestAnimationFrame(autoscroll)
  }

  function down(e: PointerEvent) {
    if (e.pointerType !== 'mouse' || e.button !== 0 || app.view !== 'notes') return
    const t = e.target as Element
    // Só em espaço vazio: não em cards, botões, campos, nem na barra de rolagem.
    if (t.closest('[data-note-id], button, a, input, textarea, [contenteditable="true"], .banner')) return
    if (e.clientX >= content.getBoundingClientRect().left + content.clientWidth) return
    const additive = e.ctrlKey || e.metaKey || e.shiftKey
    start = { x: e.clientX, y: e.clientY, scroll: content.scrollTop, base: new Set(additive ? app.selected : []) }
    last = { x: e.clientX, y: e.clientY }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
  }

  function move(e: PointerEvent) {
    if (!start) return
    last = { x: e.clientX, y: e.clientY }
    if (!box && Math.hypot(last.x - start.x, last.y - start.y) < 5) return
    if (!box) raf = requestAnimationFrame(autoscroll)
    e.preventDefault()
    update()
  }

  function up() {
    window.removeEventListener('pointermove', move)
    cancelAnimationFrame(raf)
    if (box) {
      box.remove()
      box = null
      document.documentElement.classList.remove('marquee-active')
      suppressClick = true
      setTimeout(() => (suppressClick = false))
    } else if (start && !start.base.size) {
      // Clique simples no vazio: limpa a seleção, como numa pasta.
      app.clearSelection()
    }
    start = null
  }

  const click = (e: MouseEvent) => {
    if (suppressClick) {
      e.stopPropagation()
      e.preventDefault()
    }
  }

  content.addEventListener('pointerdown', down)
  content.addEventListener('click', click, true)
  return () => {
    content.removeEventListener('pointerdown', down)
    content.removeEventListener('click', click, true)
    up()
  }
}
