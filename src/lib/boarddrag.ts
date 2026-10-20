// Arrastar cards entre dias (Calendário) e colunas (Kanban), sempre pelo ponteiro: no macOS e no Windows o Tauri fica
// com o arrastar do HTML (para receber arquivos) e a página nunca recebe o soltar. Mouse: arrasta depois de 6 px.
// Toque: depois de segurar 350 ms (antes disso o dedo rola a tela). O destino é o elemento com `data-drop` sob o dedo.

export interface BoardDrag {
  /** Valor do `data-drop` onde soltou (dia ou status). Não chama se soltou fora ou no mesmo lugar. */
  ondrop: (target: string) => void
  /** `data-drop` de onde o card saiu (soltar ali não faz nada). */
  from: string
  disabled?: boolean
}

export function boardDrag(node: HTMLElement, opts: BoardDrag) {
  let o = opts
  let start: { x: number; y: number; id: number } | null = null
  let ghost: HTMLElement | null = null
  let dx = 0
  let dy = 0
  let over: HTMLElement | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let px = 0
  let py = 0
  let raf = 0
  const blockScroll = (e: TouchEvent) => e.preventDefault()
  // segurando para arrastar, o toque longo não abre o menu de contexto
  const noMenu = (e: Event) => ghost && (e.preventDefault(), e.stopPropagation())

  function begin(x: number, y: number) {
    const r = node.getBoundingClientRect()
    dx = x - r.left
    dy = y - r.top
    ghost = node.cloneNode(true) as HTMLElement
    ghost.classList.add('drag-ghost')
    Object.assign(ghost.style, { position: 'fixed', left: '0', top: '0', width: `${r.width}px`, pointerEvents: 'none', zIndex: '60', margin: '0' })
    document.body.appendChild(ghost)
    node.classList.add('drag-src')
    node.addEventListener('touchmove', blockScroll, { passive: false })
    move(x, y)
    raf = requestAnimationFrame(autoscroll)
  }

  // Perto da borda de uma área que rola (as colunas do Kanban no celular, a lista), ela rola sozinha.
  function autoscroll() {
    if (!ghost) return
    for (let e = document.elementFromPoint(px, py) as HTMLElement | null; e; e = e.parentElement) {
      const cs = getComputedStyle(e)
      const r = e.getBoundingClientRect()
      const step = (pos: number, lo: number, hi: number) => (pos < lo + 48 ? -12 : pos > hi - 48 ? 12 : 0)
      if (/auto|scroll/.test(cs.overflowX) && e.scrollWidth > e.clientWidth) e.scrollLeft += step(px, r.left, r.right)
      if (/auto|scroll/.test(cs.overflowY) && e.scrollHeight > e.clientHeight) e.scrollTop += step(py, r.top, r.bottom)
    }
    move(px, py)
    raf = requestAnimationFrame(autoscroll)
  }

  function move(x: number, y: number) {
    if (!ghost) return
    ;[px, py] = [x, y]
    ghost.style.transform = `translate(${x - dx}px, ${y - dy}px) rotate(2deg)`
    const t = (document.elementFromPoint(x, y)?.closest('[data-drop]') as HTMLElement | null) ?? null
    if (t !== over) {
      over?.classList.remove('drop-over')
      over = t && t.dataset.drop !== o.from ? t : null
      over?.classList.add('drop-over')
    }
  }

  function end(drop: boolean) {
    clearTimeout(timer)
    cancelAnimationFrame(raf)
    const target = over?.dataset.drop
    over?.classList.remove('drop-over')
    over = null
    if (ghost) {
      ghost.remove()
      ghost = null
      node.classList.remove('drag-src')
      node.removeEventListener('touchmove', blockScroll)
      // o clique que vem depois de soltar não abre a nota
      const swallow = (e: MouseEvent) => (e.stopPropagation(), e.preventDefault())
      window.addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0)
      if (drop && target && target !== o.from) o.ondrop(target)
    }
    start = null
  }

  const down = (e: PointerEvent) => {
    if (o.disabled || e.button !== 0 || (e.target as HTMLElement).closest('button:not(.cal-chip), input, [role=radiogroup]')) return
    start = { x: e.clientX, y: e.clientY, id: e.pointerId }
    if (e.pointerType !== 'mouse') timer = setTimeout(() => start && begin(start.x, start.y), 350)
  }
  const moveH = (e: PointerEvent) => {
    if (!start || e.pointerId !== start.id) return
    if (ghost) return move(e.clientX, e.clientY)
    const far = Math.hypot(e.clientX - start.x, e.clientY - start.y)
    if (e.pointerType === 'mouse' && far > 6) {
      node.setPointerCapture(e.pointerId)
      begin(e.clientX, e.clientY)
    } else if (e.pointerType !== 'mouse' && far > 8) {
      clearTimeout(timer)
      start = null
    }
  }
  const up = (e: PointerEvent) => start && e.pointerId === start.id && end(true)
  const cancel = () => end(false)
  const esc = (e: KeyboardEvent) => e.key === 'Escape' && ghost && end(false)

  node.addEventListener('pointerdown', down)
  window.addEventListener('contextmenu', noMenu, { capture: true })
  window.addEventListener('pointermove', moveH)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', cancel)
  window.addEventListener('keydown', esc)
  return {
    update(next: BoardDrag) {
      o = next
    },
    destroy() {
      end(false)
      node.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', moveH)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', esc)
      window.removeEventListener('contextmenu', noMenu, { capture: true })
    },
  }
}
