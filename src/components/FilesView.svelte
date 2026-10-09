<script lang="ts">
  import { File as FileIcon, FileAudio, FileSpreadsheet, FileText, FileVideoCamera, Paperclip } from '@lucide/svelte'
  import { api } from '../lib/api'
  import { app, live } from '../lib/app.svelte'
  import { daysAgo, fmtBytes } from '../lib/format'
  import Empty from './Empty.svelte'
  import ViewEmpty from './ViewEmpty.svelte'
  import ContextMenu from './ContextMenu.svelte'
  import { attachmentMenu } from '../lib/menus'
  import { fileGroup, type AttachmentKind, type AttachmentRow } from '../lib/types'

  // Tipo, ordem e lista/grade ficam na barra superior (ViewActions).
  const sort = $derived(app.filesSort)

  const rows = live(() => api.listAttachments({ filter: $state.snapshot(app.filter), query: app.query }), [] as AttachmentRow[])


  const list = $derived(
    rows.current
      .filter((r) => !app.filesKind || fileGroup(r.kind) === app.filesKind)
      .sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name, 'pt-BR') : sort === 'size' ? b.bytes - a.bytes : b.addedAt - a.addedAt)),
  )
  const total = $derived(rows.current.reduce((s, r) => s + r.bytes, 0))
  const saved = $derived(rows.current.reduce((s, r) => s + (r.origBytes ? r.origBytes - r.bytes : 0), 0))

  const icons: Partial<Record<AttachmentKind, typeof FileIcon>> = { pdf: FileText, sheet: FileSpreadsheet, audio: FileAudio, video: FileVideoCamera }
  const open = (r: AttachmentRow) => (r.kind === 'image' ? (app.lightbox = r) : app.openNote(r.noteId))
</script>

<div class="stats">
  <div><b>{rows.current.length}</b><span>arquivos</span></div>
  <div><b>{fmtBytes(total)}</b><span>no Drive</span></div>
  <div class="good"><b>−{fmtBytes(saved)}</b><span>economizados nas fotos</span></div>
</div>

{#if rows.ready && !rows.current.length}
  <ViewEmpty view="files" />
{:else if rows.ready && !list.length}
  <Empty icon={Paperclip} title="Nenhum arquivo deste tipo" text="Escolha outro tipo no alto da tela." />
{/if}

{#snippet fileIcon(r: AttachmentRow, big = false)}
  {@const Icon = icons[r.kind] ?? FileIcon}
  <span class="f-ico t-{r.kind}" class:big><Icon size={20} /></span>
{/snippet}

{#if app.filesLayout === 'list'}
  {#if list.length}
    <div class="f-list">
      {#each list as r (r.noteId + r.hash)}
        {@const cat = app.category(r.categoryId)}
        <ContextMenu items={() => attachmentMenu(r)}>
          {#snippet children(trigger)}
        <button {...trigger} class="f-row" onclick={() => open(r)}>
          {#if r.kind === 'image'}<img class="f-thumb" src={api.imageUrl(r.hash, 'thumb')} alt="" />{:else}{@render fileIcon(r)}{/if}
          <span class="f-text">
            <span class="f-name">{r.name}</span>
            <span class="f-sub">
              {#if cat}<i class="dot" style:background={cat.color}></i>{/if}
              {r.noteTitle} · {daysAgo(r.addedAt)}
            </span>
          </span>
          <span class="f-size">
            {fmtBytes(r.bytes)}
            {#if r.origBytes}<small>de {fmtBytes(r.origBytes)}</small>{/if}
          </span>
        </button>
          {/snippet}
        </ContextMenu>
      {/each}
    </div>
  {/if}
{:else}
  <div class="f-grid">
    {#each list as r (r.noteId + r.hash)}
      <ContextMenu items={() => attachmentMenu(r)}>
        {#snippet children(trigger)}
      <button {...trigger} class="f-tile" onclick={() => open(r)}>
        {#if r.kind === 'image'}<img src={api.imageUrl(r.hash, 'thumb')} alt="" />{:else}{@render fileIcon(r, true)}{/if}
        <span class="f-name">{r.name}</span>
        <span class="f-sub">{fmtBytes(r.bytes)}</span>
      </button>
        {/snippet}
      </ContextMenu>
    {/each}
  </div>
{/if}
