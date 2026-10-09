<script lang="ts">
  import { Bell, Check, Paperclip } from '@lucide/svelte'
  import { api } from '../lib/api'
  import { app } from '../lib/app.svelte'
  import { fmtReminder, isOverdue, withHashtags } from '../lib/format'
  import { noteMenu } from '../lib/menus'
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
  onclick={open}
  onkeydown={(e) => e.key === 'Enter' && e.target === e.currentTarget && open()}
  tabindex="0"
  role="button"
  aria-label={n.label}
>
  {#if n.cover}
    <div class="card-media">
      <img src={api.imageUrl(n.cover.hash, 'thumb')} alt="" style:aspect-ratio="{n.cover.width}/{n.cover.height}" decoding="async" />
      {#if n.imageCount > 1}<span class="more">+{n.imageCount - 1}</span>{/if}
    </div>
  {/if}
  <div class="card-body">
    {#if n.title}<h3>{n.title}</h3>{/if}
    {#if n.preview.length}
      <!-- Prévia na ordem e na estrutura do documento (vem pronta da projeção). -->
      <div class="preview" class:big={!n.title && n.preview.length === 1 && n.preview[0].kind === 'text'}>
        {#each n.preview as b, i (i)}
          {#if b.kind === 'more'}
            <p class="pv-more">+{b.count} {b.count === 1 ? 'item' : 'itens'}</p>
          {:else if b.kind === 'task'}
            <p class="pv-task" class:done={b.done} style:--depth={b.depth}>
              <span class="box">{#if b.done}<Check size={10} strokeWidth={3} />{/if}</span><span>{@render rich(b.text)}</span>
            </p>
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
