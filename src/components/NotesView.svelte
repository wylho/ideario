<script lang="ts">
  import { Archive, Trash2 } from '@lucide/svelte'
  import { api } from '../lib/api'
  import { app, live } from '../lib/app.svelte'
  import { estimateCard } from '../lib/layout'
  import Empty from './Empty.svelte'
  import Masonry from './Masonry.svelte'
  import NoteCard from './NoteCard.svelte'
  import ViewEmpty from './ViewEmpty.svelte'
  import type { NoteSummary } from '../lib/types'

  const notes = live(() => api.listNotes({ filter: $state.snapshot(app.filter), box: app.box, query: app.query }), [] as NoteSummary[])
  const isTrash = $derived(app.box === 'trash')
  const pinned = $derived(isTrash ? [] : notes.current.filter((n) => n.pinned))
  const rest = $derived(isTrash ? notes.current : notes.current.filter((n) => !n.pinned))
</script>

{#snippet card(n: NoteSummary)}<NoteCard {n} />{/snippet}

{#snippet grid(list: NoteSummary[])}
  {#if app.layout === 'grid'}
    <Masonry items={list} key={(n) => n.id} estimate={estimateCard} item={card} minWidth={app.wide ? 210 : 190} gap={app.wide ? 14 : 10} />
  {:else}
    <div class="stack">
      {#each list as n (n.id)}<NoteCard {n} />{/each}
    </div>
  {/if}
{/snippet}

{#if notes.ready && !notes.current.length}
  {#if app.box === 'trash'}
    <Empty icon={Trash2} title={app.query ? 'Nada encontrado' : 'Lixeira vazia'} text="Notas apagadas ficam aqui por 30 dias." />
  {:else if app.box === 'archive'}
    <Empty icon={Archive} title={app.query ? 'Nada encontrado' : 'Nada arquivado'} text="Notas arquivadas saem da lista, mas continuam pesquisáveis aqui." />
  {:else}
    <ViewEmpty view="notes" />
  {/if}
{:else}
  {#if isTrash}<p class="banner">Notas na lixeira são apagadas depois de 30 dias.</p>{/if}
  {#if pinned.length}
    <h2 class="section-label">Fixadas</h2>
    {@render grid(pinned)}
  {/if}
  {#if pinned.length && rest.length}<h2 class="section-label">Outras</h2>{/if}
  {#if rest.length}{@render grid(rest)}{/if}
{/if}
