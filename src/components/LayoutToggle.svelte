<script lang="ts">
  import { LayoutGrid, Rows3 } from '@lucide/svelte'

  // Grade ↔ lista. O ícone mostra para onde vai, como no Keep.
  let { value, onchange }: { value: 'grid' | 'list'; onchange: (v: 'grid' | 'list') => void } = $props()
  const label = $derived(value === 'grid' ? 'Ver em lista' : 'Ver em grade')
</script>

<button class="icon-btn" aria-label={label} title={label} onclick={() => onchange(value === 'grid' ? 'list' : 'grid')}>
  {#if value === 'grid'}<Rows3 size={19} />{:else}<LayoutGrid size={19} />{/if}
</button>
