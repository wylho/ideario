<script lang="ts" generics="T">
  import type { Snippet } from 'svelte'

  // Grade masonry: cada item vai para a coluna mais baixa, na ordem da lista (os mais recentes ficam no topo, como
  // no Keep). Substitui `columns: N` do CSS, que a WebKitGTK não equilibra.
  //
  // Cada item é posicionado por coordenadas (transform), numa lista só: quando a ordem ou a largura muda, o item
  // desliza para o lugar novo, mas o elemento é sempre o mesmo. Nada é recriado ao redimensionar a janela (as fotos
  // não piscam) nem ao reordenar.
  //
  // Virtualizada (SPEC §4.1) a partir de 200 itens: só os itens perto da área visível existem no DOM.
  // A altura de cada item vem de uma estimativa até ele aparecer; aí passa a valer a altura medida.
  let {
    items, key, estimate, item, flip = false, minWidth = 220, gap = 10, minCols = 2, columns: fixedCols,
  }: {
    items: T[]
    key: (it: T) => string
    /** Altura aproximada do item, em px, para uma coluna de largura `colWidth`. */
    estimate: (it: T, colWidth: number) => number
    item: Snippet<[T]>
    /** Anima os itens até a nova posição quando a ordem muda (enquanto se arrasta um card). */
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

  // Alturas medidas, com a largura em que foram medidas. Com outra largura, a medida antiga corrige a estimativa
  // (o texto quebra diferente, mas a proporção entre o real e o estimado se mantém) até o item ser medido de novo.
  const measured = new Map<string, { h: number; w: number }>()
  let measureTick = $state(0)

  function heightOf(it: T, k: string, w: number) {
    const m = measured.get(k)
    if (!m) return estimate(it, w)
    if (Math.abs(m.w - w) < 0.5) return m.h
    const before = estimate(it, m.w)
    return before > 0 ? (estimate(it, w) * m.h) / before : m.h
  }

  type Placed = { it: T; key: string; col: number; top: number; height: number }
  const layout = $derived.by(() => {
    void measureTick
    const heights = new Array<number>(cols).fill(0)
    const placed: Placed[] = []
    for (const it of items) {
      let c = 0
      for (let i = 1; i < cols; i++) if (heights[i] < heights[c]) c = i
      const k = key(it)
      const h = heightOf(it, k, colWidth)
      placed.push({ it, key: k, col: c, top: heights[c], height: h })
      heights[c] += h + gap
    }
    return { placed, height: Math.max(0, ...heights.map((h) => h - gap)) }
  })

  // Janela visível, nas coordenadas da grade.
  let host: HTMLElement | undefined = $state()
  let viewTop = $state(0)
  let viewHeight = $state(typeof innerHeight === 'number' ? innerHeight : 900)

  $effect(() => {
    if (!host || items.length <= VIRTUAL_FROM) return
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

  const shown = $derived.by(() => {
    if (items.length <= VIRTUAL_FROM) return layout.placed
    const from = viewTop - OVERSCAN
    const to = viewTop + viewHeight + OVERSCAN
    return layout.placed.filter((p) => p.top + p.height >= from && p.top <= to)
  })

  // Mede cada item desenhado; se a altura real for outra, refaz a grade. O ResizeObserver avisa antes de a tela ser
  // pintada, então o item já aparece no lugar certo, sem sobrepor o vizinho.
  function measure(el: HTMLElement) {
    const k = el.dataset.key!
    const ro = new ResizeObserver(() => {
      const h = el.offsetHeight
      const w = el.offsetWidth
      const m = measured.get(k)
      if (!h || (m && Math.abs(m.h - h) < 1 && Math.abs(m.w - w) < 0.5)) return
      measured.set(k, { h, w })
      measureTick++
    })
    ro.observe(el)
    return () => ro.disconnect()
  }

  const x = (col: number) => col * (colWidth + gap)
</script>

<div
  class="masonry"
  class:animate={flip}
  bind:this={host}
  bind:clientWidth={width}
  data-cols={cols}
  style:height="{layout.height}px"
>
  {#each shown as p (p.key)}
    <div
      class="m-item"
      data-key={p.key}
      data-x={x(p.col)}
      data-y={p.top}
      style:width="{colWidth}px"
      style:transform="translate({x(p.col)}px, {p.top}px)"
      {@attach measure}
    >
      {@render item(p.it)}
    </div>
  {/each}
</div>
