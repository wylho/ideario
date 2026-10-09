<script lang="ts">
  import { DropdownMenu } from 'bits-ui'
  import { ArrowDownUp, Check } from '@lucide/svelte'
  import { app } from '../lib/app.svelte'
  import type { NoteSort } from '../lib/types'

  const SORTS: { id: NoteSort; label: string; hint?: string }[] = [
    { id: 'custom', label: 'Personalizada', hint: 'arraste os cards' },
    { id: 'updated', label: 'Última edição' },
    { id: 'created', label: 'Data de criação' },
    { id: 'category', label: 'Categoria' },
    { id: 'title', label: 'Título (A–Z)' },
  ]
  const current = $derived(SORTS.find((s) => s.id === app.sort)!)
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger class="icon-btn" aria-label="Ordenar: {current.label}" title="Ordenar: {current.label}">
    <ArrowDownUp size={18} />
  </DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content class="menu" align="end" sideOffset={6}>
      <div class="menu-heading" aria-hidden="true">Ordenar notas</div>
      <DropdownMenu.RadioGroup value={app.sort} onValueChange={(v) => app.setSort(v as NoteSort)}>
        {#each SORTS as s (s.id)}
          <DropdownMenu.RadioItem value={s.id} class="menu-item">
            {#snippet children({ checked })}
              <span class="grow">{s.label}</span>
              {#if s.hint}<small class="menu-hint">{s.hint}</small>{/if}
              <span class="menu-check" class:hidden={!checked}><Check size={15} /></span>
            {/snippet}
          </DropdownMenu.RadioItem>
        {/each}
      </DropdownMenu.RadioGroup>
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>
