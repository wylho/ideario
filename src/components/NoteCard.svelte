<script lang="ts">
  import { Bell, Check, Paperclip } from '@lucide/svelte'
  import { api } from '../lib/api'
  import { app } from '../lib/app.svelte'
  import { fmtReminder, isOverdue } from '../lib/format'
  import type { NoteSummary } from '../lib/types'

  let { n }: { n: NoteSummary } = $props()

  const cat = $derived(app.category(n.categoryId))
  const hasMeta = $derived(n.reminderAt != null || !!cat || n.tags.length > 0 || n.fileCount > 0)
  const open = () => app.openNote(n.id)
</script>

<div
  class="card c-{n.color}"
  onclick={open}
  onkeydown={(e) => e.key === 'Enter' && e.target === e.currentTarget && open()}
  tabindex="0"
  role="button"
  aria-label={n.title || n.excerpt.slice(0, 60) || 'Nota sem título'}
>
  {#if n.cover}
    <div class="card-media">
      <img src={api.imageUrl(n.cover.hash, 'thumb')} alt="" style:aspect-ratio="{n.cover.width}/{n.cover.height}" decoding="async" />
      {#if n.imageCount > 1}<span class="more">+{n.imageCount - 1}</span>{/if}
    </div>
  {/if}
  <div class="card-body">
    {#if n.title}<h3>{n.title}</h3>{/if}
    {#if n.excerpt}<p class={n.title ? 'excerpt' : 'excerpt big'}>{n.excerpt}</p>{/if}
    {#if n.checklist.length}
      <ul class="mini-check">
        {#each n.checklist as c, i (i)}
          <li class:done={c.done}><span class="box">{#if c.done}<Check size={10} strokeWidth={3} />{/if}</span>{c.text}</li>
        {/each}
        {#if n.checklistTotal > n.checklist.length}<li class="more-items">+{n.checklistTotal - n.checklist.length} itens</li>{/if}
      </ul>
    {/if}
    {#if hasMeta}
      <div class="card-meta">
        {#if n.reminderAt != null}
          <span class="pill" class:late={isOverdue(n)} class:done={n.reminderDone}><Bell size={11} />{fmtReminder(n.reminderAt)}</span>
        {/if}
        {#if cat}<span class="pill"><i class="dot" style:background={cat.color}></i>{cat.name.split(' ')[0]}</span>{/if}
        {#if n.fileCount}<span class="pill"><Paperclip size={11} />{n.fileCount}</span>{/if}
        {#each n.tags as t (t)}
          <button class="pill tag" onclick={(e) => { e.stopPropagation(); app.toggleTag(t) }}>#{t}</button>
        {/each}
      </div>
    {/if}
  </div>
</div>
