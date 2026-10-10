// Arrastar cards para reordenar (ordem personalizada). Funciona com mouse e com toque:
// no toque é preciso segurar um instante antes de mover (mover direto rola a lista; segurar sem mover abre o menu).
import { app } from './app.svelte'

const START_DISTANCE = 6
const TOUCH_HOLD_MS = 280
const EDGE = 64
/** Quanto o ponteiro precisa andar depois de uma troca para poder trocar de novo (px). */
const SETTLE_DISTANCE = 12

interface Options {
  /** Pode arrastar agora? */
  enabled: () => boolean
  /** Chamado ao começar; devolver false cancela (ex.: ordem por categoria). */
  beforeStart?: () => boolean
  /** Soltou numa nova posição: vizinhos na nova ordem (null nas pontas). */
  onDrop: (id: string, after: string | null, before: string | null) => Promise<void> | void
  /** Soltou numa categoria da lateral: a nota vai para ela (a ordem não muda). */
  onDropCategory?: (id: string, categoryId: string) => void
}

export function createCardDrag(opts: Options) {
  /** Ordem temporária de uma seção enquanto se arrasta. */
  let override = $state<{ key: string; ids: string[] } | null>(null)

  /** Aplica a ordem temporária à lista de uma seção. */
  function arrange<T extends { id: string }>(key: string, list: T[]): T[] {
    if (!override || override.key !== key) return list
    const byId = new Map(list.map((n) => [n.id, n]))
    return override.ids.flatMap((id) => byId.get(id) ?? [])
  }

  // Um attachment estável por seção: se fosse recriado a cada nova lista (ex.: ao trocar a ordem
  // no começo do arraste), o gesto seria cancelado no meio.
  const attachments = new Map<string, (el: HTMLElement) => () => void>()
  const getters = new Map<string, () => string[]>()

  /** Attachment para o contêiner de uma seção (Fixadas, Outras, um grupo…). */
  function section(key: string, ids: () => string[]) {
    getters.set(key, ids)
    let fn = attachments.get(key)
    if (!fn) attachments.set(key, (fn = attach(key, () => getters.get(key)!())))
    return fn
  }

  function attach(key: string, ids: () => string[]) {
    return (el: HTMLElement) => {
      let start: { x: number; y: number; id: string; pointerId: number; touch: boolean; offX: number; offY: number } | null = null
      let armed = false
      let active = false
      let ghost: HTMLElement | null = null
      let hold: ReturnType<typeof setTimeout> | undefined
      let scrollFrame = 0
      let last = { x: 0, y: 0 }
      let lastSlot = ''
      let moved: { x: number; y: number } | null = null
      let startIds: string[] = []

      const scroller = () => el.closest<HTMLElement>('.content')

      function onDown(e: PointerEvent) {
        if (!opts.enabled() || e.button !== 0 || start) return
        const target = e.target as Element
        const card = target.closest<HTMLElement>('[data-note-id]')
        if (!card || !el.contains(card) || target.closest('button, a, input, textarea')) return
        const r = card.getBoundingClientRect()
        start = { x: e.clientX, y: e.clientY, id: card.dataset.noteId!, pointerId: e.pointerId, touch: e.pointerType === 'touch', offX: e.clientX - r.left, offY: e.clientY - r.top }
        armed = !start.touch
        // Mouse: sem isso o navegador inicia um arraste nativo e cancela o ponteiro (pointercancel).
        if (!start.touch) e.preventDefault()
        if (start.touch) hold = setTimeout(() => (armed = true), TOUCH_HOLD_MS)
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        window.addEventListener('pointercancel', cancel)
        window.addEventListener('keydown', onKey)
        window.addEventListener('touchmove', blockScroll, { passive: false })
      }

      function blockScroll(e: TouchEvent) {
        if (armed || active) e.preventDefault()
      }

      function onMove(e: PointerEvent) {
        if (!start || e.pointerId !== start.pointerId) return
        last = { x: e.clientX, y: e.clientY }
        if (!active) {
          if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < START_DISTANCE) return
          if (!armed || (opts.beforeStart && !opts.beforeStart())) return cleanup()
          begin()
        }
        e.preventDefault()
        // Em cima de uma categoria da lateral: soltar ali muda a categoria; a grade volta à ordem de antes.
        const cat = opts.onDropCategory ? document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-drop-category]') : null
        app.dropCategory = cat?.dataset.dropCategory ?? null
        ghost!.classList.toggle('over-target', !!cat)
        ghost!.style.transform = cat
          ? `translate(${e.clientX - 24}px, ${e.clientY - 16}px) scale(.35)`
          : `translate(${e.clientX - start.offX}px, ${e.clientY - start.offY}px) rotate(1.2deg) scale(1.03)`
        if (cat) {
          if (override && override.ids.join() !== startIds.join()) override = { key, ids: startIds }
          lastSlot = ''
          moved = null
          return
        }
        reorderAt(e.clientX, e.clientY)
      }

      function begin() {
        const card = el.querySelector<HTMLElement>(`[data-note-id="${CSS.escape(start!.id)}"]`)
        if (!card) return cleanup()
        active = true
        const r = card.getBoundingClientRect()
        ghost = card.cloneNode(true) as HTMLElement
        ghost.removeAttribute('data-state')
        ghost.classList.add('drag-ghost')
        // Inline: o fantasma nunca pode ficar entre o ponteiro e os cards de baixo.
        Object.assign(ghost.style, { width: `${r.width}px`, height: `${r.height}px`, pointerEvents: 'none' })
        ghost.removeAttribute('data-note-id')
        document.body.appendChild(ghost)
        document.documentElement.classList.add('dragging-card')
        startIds = ids()
        override = { key, ids: startIds }
        app.dragId = start!.id
        scrollFrame = requestAnimationFrame(autoScroll)
      }

      /** Card sob o ponteiro pela posição final de cada um na grade, não pela da animação (senão o card que está
       *  deslizando passa por baixo do ponteiro e a ordem fica indo e voltando). */
      function cardAt(x: number, y: number) {
        for (const it of el.querySelectorAll<HTMLElement>('.m-item[data-key]')) {
          const grid = it.parentElement!.getBoundingClientRect()
          const top = grid.top + Number(it.dataset.y)
          const left = grid.left + Number(it.dataset.x)
          if (x >= left && x < left + it.offsetWidth && y >= top && y < top + it.offsetHeight) {
            return { id: it.dataset.key!, top, height: it.offsetHeight }
          }
        }
        return null
      }

      function reorderAt(x: number, y: number) {
        if (!override) return
        // Depois de mudar a ordem, só muda de novo quando o ponteiro andar: a grade se rearranja em volta dele, e o
        // card que cai embaixo não pode desfazer a troca sozinho.
        if (moved && Math.hypot(x - moved.x, y - moved.y) < SETTLE_DISTANCE) return
        const hit = cardAt(x, y)
        if (!hit || hit.id === start!.id) return
        const after = y > hit.top + hit.height / 2
        const slot = hit.id + (after ? '+' : '-')
        if (slot === lastSlot) return
        lastSlot = slot
        const rest = override.ids.filter((id) => id !== start!.id)
        const i = rest.indexOf(hit.id)
        if (i < 0) return
        rest.splice(after ? i + 1 : i, 0, start!.id)
        if (rest.join() !== override.ids.join()) {
          override = { key, ids: rest }
          moved = { x, y }
        }
      }

      function autoScroll() {
        const sc = scroller()
        if (active && sc) {
          const r = sc.getBoundingClientRect()
          const dy = last.y < r.top + EDGE ? -(r.top + EDGE - last.y) / 4 : last.y > r.bottom - EDGE ? (last.y - (r.bottom - EDGE)) / 4 : 0
          if (dy) {
            sc.scrollTop += dy
            lastSlot = ''
            moved = null
            reorderAt(last.x, last.y)
          }
        }
        if (active) scrollFrame = requestAnimationFrame(autoScroll)
      }

      async function onUp(e: PointerEvent) {
        if (!start || e.pointerId !== start.pointerId) return
        if (!active) return cleanup()
        const id = start.id
        const category = app.dropCategory
        const order = override?.ids ?? []
        const changed = !category && order.join() !== startIds.join()
        // O clique que termina o arraste não abre a nota.
        window.addEventListener('click', swallow, { capture: true, once: true })
        setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0)
        cleanup(true)
        if (category) opts.onDropCategory?.(id, category)
        if (changed) {
          const i = order.indexOf(id)
          await opts.onDrop(id, order[i - 1] ?? null, order[i + 1] ?? null)
        }
        override = null
      }

      function swallow(e: Event) {
        e.preventDefault()
        e.stopPropagation()
      }

      function onKey(e: KeyboardEvent) {
        if (e.key === 'Escape') cancel()
      }

      function cancel() {
        cleanup()
        override = null
      }

      function cleanup(keepOverride = false) {
        clearTimeout(hold)
        cancelAnimationFrame(scrollFrame)
        ghost?.remove()
        ghost = null
        document.documentElement.classList.remove('dragging-card')
        if (active) app.dragId = null
        app.dropCategory = null
        if (!keepOverride && active) override = null
        active = false
        armed = false
        start = null
        lastSlot = ''
        moved = null
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', cancel)
        window.removeEventListener('keydown', onKey)
        window.removeEventListener('touchmove', blockScroll)
      }

      // Sem o arraste nativo de imagens/links do navegador.
      const noNativeDrag = (e: DragEvent) => e.preventDefault()
      el.addEventListener('pointerdown', onDown)
      el.addEventListener('dragstart', noNativeDrag)
      return () => {
        el.removeEventListener('pointerdown', onDown)
        el.removeEventListener('dragstart', noNativeDrag)
        cleanup()
      }
    }
  }

  return { section, arrange }
}
