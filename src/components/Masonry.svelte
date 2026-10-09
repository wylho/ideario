<script lang="ts" generics="T">
  import type { Snippet } from 'svelte'

  // Grade masonry em colunas reais: cada item vai para a coluna mais baixa, na ordem da lista
  // (os mais recentes ficam no topo, como no Keep). A altura vem de uma estimativa, sem medir o DOM.
  // Substitui `columns: N` do CSS, que a WebKitGTK não equilibra.
  let {
    items, key, estimate, item, minWidth = 220, gap = 10, minCols = 2,
  }: {
    items: T[]
    key: (it: T) => string
    /** Altura aproximada do item, em px, para uma coluna de largura `colWidth`. */
    estimate: (it: T, colWidth: number) => number
    item: Snippet<[T]>
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
</script>

<div class="masonry" bind:clientWidth={width} style:--gap="{gap}px">
  {#each columns as col, i (i)}
    <div class="m-col">
      {#each col as it (key(it))}{@render item(it)}{/each}
    </div>
  {/each}
</div>
