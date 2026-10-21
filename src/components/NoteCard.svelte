<script lang="ts">
  import { KIND_ICONS } from '../lib/file-kinds'
  import { CardBody, CardPills } from '@wylho/atrio'
  import { Check, Pin, PinOff } from '@lucide/svelte'
  import { api } from '../lib/api'
  import { app } from '../lib/app.svelte'
  import { noteMenu } from '../lib/menus'
  import { ContextMenu } from '@wylho/atrio'
  import FilePreview from './FilePreview.svelte'
  import type { NoteSummary } from '../lib/types'
  import { changeStatus } from '../lib/status'

  let { n }: { n: NoteSummary } = $props()

  const cat = $derived(app.category(n.categoryId))
  // Nota que é só um anexo (um áudio, um PDF…): o card vira a miniatura quadrada do arquivo, como na visão Arquivos.
  const solo = $derived(!n.cover.length && n.preview.length === 1 && n.preview[0].kind === 'file' ? n.preview[0] : null)
  const hasMeta = $derived(n.reminderAt != null || n.statusOn || !!cat || n.tags.length > 0 || (n.fileCount > 0 && !solo))
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


{#snippet pills()}
  <CardPills
    reminderAt={n.reminderAt}
    reminderRepeat={n.reminderRepeat}
    reminderDone={n.reminderDone}
    reminderDoing={n.reminderDoing}
    statusOn={n.statusOn}
    category={cat}
    fileCount={solo ? 0 : n.fileCount}
    tags={n.tags}
    oncategory={() => cat && app.setCategory(cat.id)}
    ontag={(t) => app.toggleTag(t)}
    onstatus={n.trashedAt == null ? (s) => void changeStatus(n, s) : undefined}
  />
{/snippet}

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
  ><Check size={11} strokeWidth={3.2} /></button>
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
  <CardBody title={n.title} emoji={n.emoji} blocks={solo ? [] : n.preview} meta={hasMeta ? pills : undefined}>
    {#if solo}<p class="card-file-name">{solo.text}</p>{/if}
  </CardBody>
</div>
  {/snippet}
</ContextMenu>
