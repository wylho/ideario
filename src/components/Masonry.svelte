<script lang="ts" generics="T">
  import { tick } from 'svelte'
  import type { Snippet } from 'svelte'

  // Grade masonry em colunas reais: cada item vai para a coluna mais baixa, na ordem da lista
  // (os mais recentes ficam no topo, como no Keep). A altura vem de uma estimativa, sem medir o DOM.
  // Substitui `columns: N` do CSS, que a WebKitGTK não equilibra.
  let {
    items, key, estimate, item, flip = false, minWidth = 220, gap = 10, minCols = 2,
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
  } = $props()

  let width = $state(0)
  const cols = $derived(Math.max(minCols, Math.floor((width + gap) / (minWidth + gap))))
  const colWidth = $derived(width ? (width - gap * (cols - 1)) / cols : minWidth)
  const columns = $derived.by(() => {
    const out: T[][] = Array.from({ length: cols }, () => [])
    const heights = new Array<number>(cols).fill(0)
    for (const it of items) {
      const i = heights.indexOf(Math.min(...heights))
      out[i].push(it)
      heights[i] += estimate(it, colWidth) + gap
    }
    return out
  })

  let host: HTMLElement | undefined = $state()
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

  // FLIP: guarda onde cada item estava antes da mudança e anima a partir de lá.
  $effect.pre(() => {
    void columns
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
  {#each columns as col, i (i)}
    <div class="m-col">
      {#each col as it (key(it))}<div class="m-item" data-key={key(it)}>{@render item(it)}</div>{/each}
    </div>
  {/each}
</div>
