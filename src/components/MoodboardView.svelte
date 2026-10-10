<script lang="ts">
  import { Images } from '@lucide/svelte'
  import { api } from '../lib/api'
  import { app, live } from '../lib/app.svelte'
  import Empty from './Empty.svelte'
  import Masonry from './Masonry.svelte'
  import ViewEmpty from './ViewEmpty.svelte'
  import ContextMenu from './ContextMenu.svelte'
  import { attachmentMenu } from '../lib/menus'
  import type { AttachmentRow } from '../lib/types'

  // O tom é escolhido na barra superior (ViewActions).
  const tone = $derived(app.moodTone)
  const items = live(() => api.listImages({ filter: $state.snapshot(app.filter), query: app.query, tone, archived: app.moodArchived }), [] as AttachmentRow[])
</script>

{#if items.ready && !items.current.length}
  {#if tone}
    <Empty icon={Images} title="Nenhuma imagem neste tom" text="Escolha outro tom no alto da tela." />
  {:else}
    <ViewEmpty view="moodboard" hint={app.filterLabel ? undefined : 'Imagens coladas nas notas aparecem aqui automaticamente.'} />
  {/if}
{/if}

{#snippet tile(r: AttachmentRow)}
  <ContextMenu items={() => attachmentMenu(r)}>
    {#snippet children(trigger)}
  <button {...trigger} class="mood-tile" onclick={() => (app.lightbox = r)}>
    <img src={api.imageUrl(r.hash, 'thumb')} alt={r.name} style:aspect-ratio="{r.width}/{r.height}" decoding="async" />
    {#if r.palette}<span class="mood-pal">{#each r.palette as p, i (i)}<i style:background={p}></i>{/each}</span>{/if}
    <span class="mood-cap">{r.noteTitle}</span>
  </button>
    {/snippet}
  </ContextMenu>
{/snippet}

<Masonry
  items={items.current}
  key={(r) => r.noteId + r.hash}
  estimate={(r, w) => (w * (r.height ?? 3)) / (r.width ?? 4)}
  item={tile}
  minWidth={app.wide ? 220 : 180}
  gap={6}
/>
