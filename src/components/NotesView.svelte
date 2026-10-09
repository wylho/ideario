<script lang="ts">
  import { Archive, StickyNote, Trash2 } from '@lucide/svelte'
  import { api } from '../lib/api'
  import { app, live } from '../lib/app.svelte'
  import Empty from './Empty.svelte'
  import NoteCard from './NoteCard.svelte'
  import type { NoteSummary } from '../lib/types'

  const notes = live(() => api.listNotes({ scope: app.scope, query: app.query }), [] as NoteSummary[])
  const isTrash = $derived(app.scope.kind === 'trash')
  const pinned = $derived(isTrash ? [] : notes.current.filter((n) => n.pinned))
  const rest = $derived(isTrash ? notes.current : notes.current.filter((n) => !n.pinned))
</script>

{#snippet grid(list: NoteSummary[])}
  <div class={app.layout === 'grid' ? 'masonry' : 'stack'}>
    {#each list as n (n.id)}
      <NoteCard {n} />
    {/each}
  </div>
{/snippet}

{#if notes.ready && !notes.current.length}
  {@const kind = app.scope.kind}
  <Empty
    icon={kind === 'trash' ? Trash2 : kind === 'archive' ? Archive : StickyNote}
    title={app.query ? 'Nada encontrado' : kind === 'trash' ? 'Lixeira vazia' : kind === 'archive' ? 'Nada arquivado' : 'Nenhuma nota aqui'}
    text={app.query ? `Nenhuma nota contém “${app.query}”.` : 'Toque em + para anotar algo.'}
  />
{:else}
  {#if isTrash}<p class="banner">Notas na lixeira são apagadas depois de 30 dias.</p>{/if}
  {#if pinned.length}
    <h2 class="section-label">Fixadas</h2>
    {@render grid(pinned)}
  {/if}
  {#if pinned.length && rest.length}<h2 class="section-label">Outras</h2>{/if}
  {#if rest.length}{@render grid(rest)}{/if}
{/if}
