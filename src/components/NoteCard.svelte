<script lang="ts">
  // O card de uma nota na lista: o `NoteCard` do Atrio, o mesmo do Nodo. Aqui fica só o que é do Ideario: o menu do
  // clique direito, a seleção múltipla, fixar, filtrar pela etiqueta ou categoria e arrastar.
  import { ContextMenu, NoteCard } from '@wylho/atrio'
  import { api } from '../lib/api'
  import { app } from '../lib/app.svelte'
  import { noteMenu } from '../lib/menus'
  import { thumbUrl } from '../lib/previews.svelte'
  import type { NoteSummary } from '../lib/types'
  import { changeStatus } from '../lib/status'

  let { n }: { n: NoteSummary } = $props()

  const cat = $derived(app.category(n.categoryId))
  const live = $derived(n.trashedAt == null)
</script>

<ContextMenu items={() => noteMenu(n)}>
  {#snippet children(trigger)}
    <NoteCard
      {...trigger}
      card={n}
      label={n.label}
      thumb={(h) => api.imageUrl(h, 'thumb')}
      fileThumb={(h) => thumbUrl(h)}
      category={cat}
      selected={app.selected.has(n.id)}
      selecting={app.selected.size > 0}
      class={app.dragId === n.id ? 'drag-source' : ''}
      data-note-id={n.id}
      onopen={() => app.openNote(n.id)}
      onmark={(e) => app.toggleSelect(n.id, e.shiftKey)}
      onpin={live ? () => void api.updateNote(n.id, { pinned: !n.pinned }) : undefined}
      oncategory={() => cat && app.setCategory(cat.id)}
      ontag={(t) => app.toggleTag(t)}
      onstatus={live ? (s) => void changeStatus(n, s) : undefined}
    />
  {/snippet}
</ContextMenu>
