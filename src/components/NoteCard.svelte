<script lang="ts">
  import { KIND_ICONS } from '../lib/file-kinds'
  import { Bell, Check, Paperclip } from '@lucide/svelte'
  import { api } from '../lib/api'
  import { app } from '../lib/app.svelte'
  import { fmtReminder, isOverdue, withHashtags } from '../lib/format'
  import { noteMenu } from '../lib/menus'
  import { watchClip } from '../lib/clip'
  import ContextMenu from './ContextMenu.svelte'
  import type { NoteSummary } from '../lib/types'

  let { n }: { n: NoteSummary } = $props()

  const cat = $derived(app.category(n.categoryId))
  const hasMeta = $derived(n.reminderAt != null || !!cat || n.tags.length > 0 || n.fileCount > 0)
  const open = () => app.openNote(n.id)
</script>

{#snippet rich(text: string)}{#each withHashtags(text) as s, i (i)}{#if s.tag}<span class="hashtag">{s.text}</span>{:else}{s.text}{/if}{/each}{/snippet}

<ContextMenu items={() => noteMenu(n)}>
  {#snippet children(trigger)}
<div
  {...trigger}
  class="card c-{n.color}"
  class:drag-source={app.dragId === n.id}
  data-note-id={n.id}
  onclick={open}
  onkeydown={(e) => e.key === 'Enter' && e.target === e.currentTarget && open()}
  tabindex="0"
  role="button"
  aria-label={n.label}
>
  {#if n.cover.length}
    <!-- Uma foto, ou a primeira linha de fotos lado a lado: mesma altura, larguras pela proporção de cada uma. -->
    <div class="card-media" class:row={n.cover.length > 1}>
      {#each n.cover as c (c.hash)}
        <img src={api.imageUrl(c.hash, 'thumb')} alt="" style:aspect-ratio="{c.width}/{c.height}" style:flex-grow={c.width / c.height} decoding="async" />
      {/each}
      {#if n.imageCount > n.cover.length}<span class="more">+{n.imageCount - n.cover.length}</span>{/if}
    </div>
  {/if}
  <div class="card-body">
    {#if n.title}<h3>{n.title}</h3>{/if}
    {#if n.preview.length}
      <!-- Prévia na ordem e na estrutura do documento (vem pronta da projeção). -->
      <div
        class="preview"
        class:big={!n.title && n.preview.length === 1 && n.preview[0].kind === 'text'}
        {@attach (el) => (void n.preview, watchClip(el))}
      >
        {#each n.preview as b, i (i)}
          {#if b.kind === 'more'}
            <p class="pv-more">+{b.count} {b.count === 1 ? 'item' : 'itens'}</p>
          {:else if b.kind === 'task'}
            <p class="pv-task" class:done={b.done} style:--depth={b.depth}>
              <span class="box">{#if b.done}<Check size={10} strokeWidth={3} />{/if}</span><span>{@render rich(b.text)}</span>
            </p>
          {:else if b.kind === 'file'}
            {@const Icon = KIND_ICONS[b.fileKind]}
            <p class="pv-file"><Icon size={14} /><span>{b.text}</span></p>
          {:else if b.kind === 'code'}
            <pre class="pv-code">{b.text}</pre>
          {:else if b.kind === 'bullet' || b.kind === 'ordered'}
            <p class="pv-li" style:--depth={b.depth} data-mark={b.kind === 'ordered' ? `${b.n}.` : '•'}>{@render rich(b.text)}</p>
          {:else}
            <p class={b.kind === 'heading' ? 'pv-h' : 'pv-p'}>{@render rich(b.text)}</p>
          {/if}
        {/each}
      </div>
    {/if}
    {#if hasMeta}
      <div class="card-meta">
        {#if n.reminderAt != null}
          <span class="pill" class:late={isOverdue(n)} class:done={n.reminderDone}><Bell size={11} />{fmtReminder(n.reminderAt)}</span>
        {/if}
        {#if cat}
          <button class="pill cat" title="Filtrar por {cat.name}" onclick={(e) => { e.stopPropagation(); app.setCategory(cat.id) }}>
            <i class="dot" style:background={cat.color}></i>{cat.name.split(' ')[0]}
          </button>
        {/if}
        {#if n.fileCount}<span class="pill"><Paperclip size={11} />{n.fileCount}</span>{/if}
        {#each n.tags as t (t)}
          <button class="pill tag" onclick={(e) => { e.stopPropagation(); app.toggleTag(t) }}>#{t}</button>
        {/each}
      </div>
    {/if}
  </div>
</div>
  {/snippet}
</ContextMenu>
