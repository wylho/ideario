<script lang="ts">
  import { KIND_ICONS } from '../lib/file-kinds'
  import { Bell, Check, Paperclip, Pin, PinOff } from '@lucide/svelte'
  import { api } from '../lib/api'
  import { app } from '../lib/app.svelte'
  import { fmtReminder, isOverdue, withHashtags } from '../lib/format'
  import { noteMenu } from '../lib/menus'
  import { watchClip } from '../lib/clip'
  import ContextMenu from './ContextMenu.svelte'
  import FilePreview from './FilePreview.svelte'
  import type { NoteSummary } from '../lib/types'

  let { n }: { n: NoteSummary } = $props()

  const cat = $derived(app.category(n.categoryId))
  // Nota que é só um anexo (um áudio, um PDF…): o card vira a miniatura quadrada do arquivo, como na visão Arquivos.
  const solo = $derived(!n.cover.length && n.preview.length === 1 && n.preview[0].kind === 'file' ? n.preview[0] : null)
  const hasMeta = $derived(n.reminderAt != null || !!cat || n.tags.length > 0 || (n.fileCount > 0 && !solo))
  const selected = $derived(app.selected.has(n.id))
  const selecting = $derived(app.selected.size > 0)
  // Com seleção ativa, tocar no card marca ou desmarca; Ctrl/⌘+clique e Shift+clique também selecionam, como numa pasta.
  function activate(e: MouseEvent | KeyboardEvent) {
    if (selecting || e.shiftKey || e.ctrlKey || e.metaKey) app.toggleSelect(n.id, e.shiftKey)
    else app.openNote(n.id)
  }
  const togglePin = (e: MouseEvent) => {
    e.stopPropagation()
    void api.updateNote(n.id, { pinned: !n.pinned })
  }
</script>

{#snippet rich(text: string)}{#each withHashtags(text) as s, i (i)}{#if s.tag}<span class="hashtag">{s.text}</span>{:else}{s.text}{/if}{/each}{/snippet}

<ContextMenu items={() => noteMenu(n)}>
  {#snippet children(trigger)}
<div
  {...trigger}
  class="card c-{n.color}"
  class:drag-source={app.dragId === n.id}
  class:selected
  data-note-id={n.id}
  onclick={activate}
  onkeydown={(e) => e.key === 'Enter' && e.target === e.currentTarget && activate(e)}
  tabindex="0"
  role="button"
  aria-label={n.label}
>
  <!-- Só com mouse por cima (ou já selecionada): marcar para seleção múltipla e fixar. -->
  <button
    class="card-check"
    aria-label={selected ? 'Desmarcar nota' : 'Selecionar nota'}
    aria-pressed={selected}
    onclick={(e) => { e.stopPropagation(); app.toggleSelect(n.id, e.shiftKey) }}
  ><Check size={14} strokeWidth={3} /></button>
  {#if n.trashedAt == null && !selecting}
    <button class="card-pin" aria-label={n.pinned ? 'Desafixar' : 'Fixar'} title={n.pinned ? 'Desafixar' : 'Fixar'} onclick={togglePin}>
      {#if n.pinned}<PinOff size={16} />{:else}<Pin size={16} />{/if}
    </button>
  {/if}
  {#if n.cover.length}
    <!-- Uma foto, ou a primeira linha de fotos lado a lado: mesma altura, larguras pela proporção de cada uma. -->
    <div class="card-media" class:row={n.cover.length > 1}>
      {#each n.cover as c (c.hash)}
        <img src={api.imageUrl(c.hash, 'thumb')} alt="" style:aspect-ratio="{c.width}/{c.height}" style:flex-grow={c.width / c.height} decoding="async" />
      {/each}
      {#if n.imageCount > n.cover.length}<span class="more">+{n.imageCount - n.cover.length}</span>{/if}
    </div>
  {/if}
  {#if solo}
    {@const Icon = KIND_ICONS[solo.fileKind]}
    <div class="card-file t-{solo.fileKind}">
      <FilePreview hash={solo.hash} kind={solo.fileKind}><Icon size={34} strokeWidth={1.6} /></FilePreview>
    </div>
  {/if}
  <div class="card-body">
    {#if n.title}<h3>{n.title}</h3>{/if}
    {#if solo}
      <p class="card-file-name">{solo.text}</p>
    {:else if n.preview.length}
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
        {#if n.fileCount && !solo}<span class="pill"><Paperclip size={11} />{n.fileCount}</span>{/if}
        {#each n.tags as t (t)}
          <button class="pill tag" onclick={(e) => { e.stopPropagation(); app.toggleTag(t) }}>#{t}</button>
        {/each}
      </div>
    {/if}
  </div>
</div>
  {/snippet}
</ContextMenu>
