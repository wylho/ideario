<script lang="ts">
  import { Archive, Trash2 } from '@lucide/svelte'
  import { api } from '../lib/api'
  import { app, live } from '../lib/app.svelte'
  import { createCardDrag } from '../lib/drag.svelte'
  import { estimateCard } from '../lib/layout'
  import Empty from './Empty.svelte'
  import Masonry from './Masonry.svelte'
  import NoteCard from './NoteCard.svelte'
  import ViewEmpty from './ViewEmpty.svelte'
  import type { NoteSummary } from '../lib/types'

  const notes = live(
    () => api.listNotes({ filter: $state.snapshot(app.filter), box: app.box, query: app.query, sort: app.sort }),
    [] as NoteSummary[],
  )
  const isTrash = $derived(app.box === 'trash')
  const pinned = $derived(isTrash ? [] : notes.current.filter((n) => n.pinned))
  const rest = $derived(isTrash ? notes.current : notes.current.filter((n) => !n.pinned))

  // Ordem por categoria: grupos na ordem das categorias; sem categoria no fim.
  const groups = $derived.by(() => {
    if (app.sort !== 'category') return []
    const by = new Map<string, NoteSummary[]>()
    for (const n of rest) by.set(n.categoryId ?? '', [...(by.get(n.categoryId ?? '') ?? []), n])
    return [...by].map(([id, items]) => ({ id, cat: app.category(id), items }))
  })

  // Arrastar: ordem personalizada. Numa ordem por data ou título, a ordem atual vira a personalizada;
  // na ordem por categoria os grupos são fixos, então oferece trocar.
  const drag = createCardDrag({
    enabled: () => !isTrash,
    beforeStart: () => {
      if (app.sort === 'category') {
        app.say('Na ordem por categoria os cards ficam agrupados.', {
          label: 'Usar ordem livre',
          run: () => void api.adoptOrder('category').then(() => app.setSort('custom')),
        })
        return false
      }
      if (app.sort !== 'custom') {
        void api.adoptOrder(app.sort)
        app.setSort('custom')
        app.say('Ordem personalizada')
      }
      return true
    },
    onDrop: (id, after, before) => api.moveNote(id, { after, before }),
  })
</script>

{#snippet card(n: NoteSummary)}<NoteCard {n} />{/snippet}

{#snippet grid(key: string, list: NoteSummary[])}
  {@const items = drag.arrange(key, list)}
  <div class="drag-section" {@attach drag.section(key, () => list.map((n) => n.id))}>
    {#if app.layout === 'grid'}
      <Masonry {items} key={(n) => n.id} estimate={estimateCard} item={card} flip={!!app.dragId} minWidth={app.wide ? 210 : 190} gap={app.wide ? 14 : 10} />
    {:else}
      <div class="stack">
        {#each items as n (n.id)}<div class="m-item" data-key={n.id}><NoteCard {n} /></div>{/each}
      </div>
    {/if}
  </div>
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
    {@render grid('pinned', pinned)}
  {/if}
  {#if app.sort === 'category'}
    {#each groups as g (g.id)}
      <h2 class="section-label">
        {#if g.cat}<i class="dot" style:background={g.cat.color}></i>{g.cat.name}{:else}Sem categoria{/if}
        <span class="count">{g.items.length}</span>
      </h2>
      {@render grid(`cat:${g.id}`, g.items)}
    {/each}
  {:else}
    {#if pinned.length && rest.length}<h2 class="section-label">Outras</h2>{/if}
    {#if rest.length}{@render grid('rest', rest)}{/if}
  {/if}
{/if}
