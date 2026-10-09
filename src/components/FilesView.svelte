<script lang="ts">
  import { ToggleGroup } from 'bits-ui'
  import { File as FileIcon, FileAudio, FileSpreadsheet, FileText, LayoutGrid, Paperclip, Rows3 } from '@lucide/svelte'
  import { api } from '../lib/api'
  import { app, live } from '../lib/app.svelte'
  import { daysAgo, fmtBytes } from '../lib/format'
  import Empty from './Empty.svelte'
  import ViewEmpty from './ViewEmpty.svelte'
  import Picker from './Picker.svelte'
  import ContextMenu from './ContextMenu.svelte'
  import { attachmentMenu } from '../lib/menus'
  import type { AttachmentKind, AttachmentRow, FileFilter, FileSort } from '../lib/types'

  let filter = $state<FileFilter>('all')
  let sort = $state<FileSort>('recent')
  let mode = $state<'list' | 'grid'>('list')

  const rows = live(() => api.listAttachments({ filter: $state.snapshot(app.filter), query: app.query }), [] as AttachmentRow[])

  const FILTERS: [FileFilter, string][] = [
    ['all', 'Tudo'], ['image', 'Fotos'], ['pdf', 'PDFs'], ['doc', 'Documentos'], ['sheet', 'Planilhas'], ['audio', 'Áudio'],
  ]
  const count = (f: FileFilter) => (f === 'all' ? rows.current.length : rows.current.filter((r) => r.kind === f).length)

  const list = $derived(
    rows.current
      .filter((r) => filter === 'all' || r.kind === filter)
      .sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name, 'pt-BR') : sort === 'size' ? b.bytes - a.bytes : b.addedAt - a.addedAt)),
  )
  const total = $derived(rows.current.reduce((s, r) => s + r.bytes, 0))
  const saved = $derived(rows.current.reduce((s, r) => s + (r.origBytes ? r.origBytes - r.bytes : 0), 0))

  const icons: Partial<Record<AttachmentKind, typeof FileIcon>> = { pdf: FileText, sheet: FileSpreadsheet, audio: FileAudio }
  const open = (r: AttachmentRow) => (r.kind === 'image' ? (app.lightbox = r) : app.openNote(r.noteId))
</script>

<div class="stats">
  <div><b>{rows.current.length}</b><span>arquivos</span></div>
  <div><b>{fmtBytes(total)}</b><span>no Drive</span></div>
  <div class="good"><b>−{fmtBytes(saved)}</b><span>economizados nas fotos</span></div>
</div>

<ToggleGroup.Root type="single" bind:value={() => filter, (v) => v && (filter = v as FileFilter)} class="seg scroll-x" aria-label="Tipo de arquivo">
  {#each FILTERS as [v, l] (v)}
    <ToggleGroup.Item value={v} class="seg-item">{l}<span class="count">{count(v)}</span></ToggleGroup.Item>
  {/each}
</ToggleGroup.Root>

<div class="toolbar">
  <Picker id="ordenar" bind:value={sort} prefix="Ordenar:" options={[['recent', 'Mais recentes'], ['name', 'Nome'], ['size', 'Tamanho']]} />
  <ToggleGroup.Root type="single" bind:value={() => mode, (v) => v && (mode = v as 'list' | 'grid')} class="seg tight" aria-label="Visualização">
    <ToggleGroup.Item value="list" class="seg-item" aria-label="Lista"><Rows3 size={16} /></ToggleGroup.Item>
    <ToggleGroup.Item value="grid" class="seg-item" aria-label="Grade"><LayoutGrid size={16} /></ToggleGroup.Item>
  </ToggleGroup.Root>
</div>

{#if rows.ready && !rows.current.length}
  <ViewEmpty view="files" />
{:else if rows.ready && !list.length}
  <Empty icon={Paperclip} title="Nenhum arquivo deste tipo" text="Escolha outro tipo acima." />
{/if}

{#snippet fileIcon(r: AttachmentRow, big = false)}
  {@const Icon = icons[r.kind] ?? FileIcon}
  <span class="f-ico t-{r.kind}" class:big><Icon size={20} /></span>
{/snippet}

{#if mode === 'list'}
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
