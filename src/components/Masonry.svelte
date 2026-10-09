<script lang="ts" generics="T">
  import { tick } from 'svelte'
  import type { Snippet } from 'svelte'

  // Grade masonry em colunas reais: cada item vai para a coluna mais baixa, na ordem da lista
  // (os mais recentes ficam no topo, como no Keep). Substitui `columns: N` do CSS, que a WebKitGTK não equilibra.
  //
  // Virtualizada (SPEC §4.1) a partir de 200 itens: só os itens perto da área visível existem no DOM; o resto vira espaço reservado.
  // A altura de cada item vem de uma estimativa até ele aparecer; aí passa a valer a altura medida.
  // Assim 5 mil notas abrem e rolam como 50.
  let {
    items, key, estimate, item, flip = false, minWidth = 220, gap = 10, minCols = 2, columns: fixedCols,
  }: {
    items: T[]
    key: (it: T) => string
    /** Altura aproximada do item, em px, para uma coluna de largura `colWidth`. */
    estimate: (it: T, colWidth: number) => number
    item: Snippet<[T]>
    /** Anima os itens até a nova posição quando a ordem muda (FLIP), inclusive entre colunas. */
    flip?: boolean
    minWidth?: number
    gap?: number
    minCols?: number
    /** Número fixo de colunas (ex.: 1 na visão em lista). */
    columns?: number
  } = $props()

  /** Quanto desenhar além da área visível, para cima e para baixo (px). */
  const OVERSCAN = 900
  /** Até aqui desenha tudo (é instantâneo e não há o que economizar); acima, só o que está perto da tela. */
  const VIRTUAL_FROM = 200

  let width = $state(0)
  const cols = $derived(fixedCols ?? Math.max(minCols, Math.floor((width + gap) / (minWidth + gap))))
  const colWidth = $derived(width ? (width - gap * (cols - 1)) / cols : minWidth)

  // Alturas medidas, por item, para a largura atual da coluna.
  const measured = new Map<string, number>()
  let measuredWidth = 0
  let measureTick = $state(0)

  type Placed = { it: T; key: string; top: number; height: number }
  const layout = $derived.by(() => {
    void measureTick
    if (Math.abs(colWidth - measuredWidth) > 0.5) {
      measured.clear()
      measuredWidth = colWidth
    }
    const out: Placed[][] = Array.from({ length: cols }, () => [])
    const heights = new Array<number>(cols).fill(0)
    for (const it of items) {
      let i = 0
      for (let c = 1; c < cols; c++) if (heights[c] < heights[i]) i = c
      const k = key(it)
      const h = measured.get(k) ?? estimate(it, colWidth)
      out[i].push({ it, key: k, top: heights[i], height: h })
      heights[i] += h + gap
    }
    return { columns: out, heights: heights.map((h) => Math.max(0, h - gap)) }
  })

  // Janela visível, nas coordenadas da grade.
  let host: HTMLElement | undefined = $state()
  let viewTop = $state(0)
  let viewHeight = $state(typeof innerHeight === 'number' ? innerHeight : 900)

  $effect(() => {
    if (!host) return
    const scroller = host.closest<HTMLElement>('.content') ?? document.scrollingElement
    if (!scroller) return
    let frame = 0
    const update = () => {
      frame = 0
      const sc = scroller === document.scrollingElement ? { top: 0, height: innerHeight } : scroller.getBoundingClientRect()
      viewTop = sc.top - host!.getBoundingClientRect().top
      viewHeight = sc.height
    }
    const schedule = () => (frame ||= requestAnimationFrame(update))
    update()
    const target = scroller === document.scrollingElement ? window : scroller
    target.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      target.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      cancelAnimationFrame(frame)
    }
  })

  /** Primeiro índice cujo fim passa de `y` (busca binária: as colunas já estão em ordem de altura). */
  function firstVisible(col: Placed[], y: number) {
    let lo = 0
    let hi = col.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (col[mid].top + col[mid].height < y) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  const windows = $derived.by(() => {
    if (items.length <= VIRTUAL_FROM) return layout.columns.map((col) => ({ items: col, pad: 0 }))
    const from = viewTop - OVERSCAN
    const to = viewTop + viewHeight + OVERSCAN
    return layout.columns.map((col) => {
      const a = firstVisible(col, from)
      let b = a
      while (b < col.length && col[b].top <= to) b++
      return { items: col.slice(a, b), pad: a < col.length ? col[a].top : 0 }
    })
  })

  // Mede cada item desenhado; se a altura real for outra, refaz a grade (num quadro só, para vários de uma vez).
  let pending = 0
  function measure(el: HTMLElement) {
    const k = el.dataset.key!
    const ro = new ResizeObserver(() => {
      const h = el.offsetHeight
      if (!h || Math.abs((measured.get(k) ?? -1) - h) < 1) return
      measured.set(k, h)
      pending ||= requestAnimationFrame(() => {
        pending = 0
        measureTick++
      })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }

  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

  // FLIP: guarda onde cada item estava antes da mudança e anima a partir de lá.
  $effect.pre(() => {
    void layout
    if (!flip || reduced || !host) return
    const before = new Map<string, DOMRect>()
    for (const el of host.querySelectorAll<HTMLElement>('[data-key]')) before.set(el.dataset.key!, el.getBoundingClientRect())
    tick().then(() => {
      for (const el of host!.querySelectorAll<HTMLElement>('[data-key]')) {
        const from = before.get(el.dataset.key!)
        if (!from) continue
        const to = el.getBoundingClientRect()
        const dx = from.left - to.left
        const dy = from.top - to.top
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue
        el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.2, .8, .2, 1)' })
      }
    })
  })
</script>

<div class="masonry" bind:this={host} bind:clientWidth={width} style:--gap="{gap}px">
  {#each windows as w, i (i)}
    <!-- espaço reservado em cima (itens fora da tela) e altura total da coluna -->
    <div class="m-col" style:padding-top="{w.pad}px" style:min-height="{layout.heights[i]}px">
      {#each w.items as p (p.key)}<div class="m-item" data-key={p.key} {@attach measure}>{@render item(p.it)}</div>{/each}
    </div>
  {/each}
</div>
