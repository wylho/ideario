<script lang="ts">
  import { Images } from '@lucide/svelte'
  import { api } from '../lib/api'
  import { app, live } from '../lib/app.svelte'
  import Empty from './Empty.svelte'
  import Masonry from './Masonry.svelte'
  import type { AttachmentRow, Tone } from '../lib/types'

  const TONES: { id: Tone; label: string; sw: string }[] = [
    { id: 'quente', label: 'Quentes', sw: '#D98E4A' },
    { id: 'frio', label: 'Frios', sw: '#3D63D6' },
    { id: 'verde', label: 'Verdes', sw: '#4F8A60' },
    { id: 'rosa', label: 'Rosas', sw: '#E58FA6' },
    { id: 'neutro', label: 'Neutros', sw: '#A39E92' },
  ]

  let tone = $state<Tone | null>(null)
  const items = live(() => api.listImages({ scope: app.scope, query: app.query, tone }), [] as AttachmentRow[])
</script>

<div class="tones" role="group" aria-label="Filtrar por cor">
  {#each TONES as t (t.id)}
    <button class="tone" class:on={tone === t.id} aria-pressed={tone === t.id} onclick={() => (tone = tone === t.id ? null : t.id)}>
      <i style:background={t.sw}></i>{t.label}
    </button>
  {/each}
</div>

{#if items.ready && !items.current.length}
  <Empty icon={Images} title="Nenhuma imagem" text="Imagens coladas nas notas aparecem aqui automaticamente." />
{/if}

{#snippet tile(r: AttachmentRow)}
  <button class="mood-tile" onclick={() => (app.lightbox = r)}>
    <img src={api.imageUrl(r.hash, 'thumb')} alt={r.name} style:aspect-ratio="{r.width}/{r.height}" decoding="async" />
    {#if r.palette}<span class="mood-pal">{#each r.palette as p (p)}<i style:background={p}></i>{/each}</span>{/if}
    <span class="mood-cap">{r.noteTitle}</span>
  </button>
{/snippet}

<Masonry
  items={items.current}
  key={(r) => r.noteId + r.hash}
  estimate={(r, w) => (w * (r.height ?? 3)) / (r.width ?? 4)}
  item={tile}
  minWidth={app.wide ? 220 : 180}
  gap={6}
/>
