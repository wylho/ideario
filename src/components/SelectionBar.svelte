<script lang="ts">
  import { DropdownMenu } from 'bits-ui'
  import { Archive, ArchiveRestore, Check, CheckCheck, Palette, Pin, PinOff, Tag, Trash2, X } from '@lucide/svelte'
  import { api } from '../lib/api'
  import { app } from '../lib/app.svelte'
  import { changeMany, manyMsg, NOTE_COLORS } from '../lib/menus'
  import ConfirmDialog from './ConfirmDialog.svelte'

  // Com notas selecionadas, a barra superior vira a barra de ações em lote (no lugar de ☰, marca e menu dinâmico).
  const notes = $derived(app.visibleNotes.filter((n) => app.selected.has(n.id)))
  const count = $derived(app.selected.size)
  const allPinned = $derived(notes.length > 0 && notes.every((n) => n.pinned))
  const inTrash = $derived(app.box === 'trash')
  const inArchive = $derived(app.box === 'archive')
  let confirmDelete = $state(false)

  // A seleção continua depois de cada ação, para encadear várias (fixar, depois mudar a cor…).
  // Só termina no ×, no Esc, num clique no vazio, ou quando as notas saem da tela (arquivar, lixeira).
  const done = (fn: () => void) => fn()
  async function deleteForever() {
    const n = notes.length
    for (const x of notes) await api.deleteNote(x.id)
    app.clearSelection()
    app.say(n === 1 ? 'Nota excluída' : `${n} notas excluídas`)
  }
</script>

<div class="sel-left">
  <button class="icon-btn" aria-label="Limpar seleção" title="Limpar seleção (Esc)" onclick={() => app.clearSelection()}><X size={20} /></button>
  <span class="sel-count" aria-live="polite">{count === 1 ? '1 selecionada' : `${count} selecionadas`}</span>
</div>

<div class="top-actions sel-actions" role="toolbar" aria-label="Ações nas notas selecionadas">
  {#if count < app.visibleNotes.length}
    <button class="icon-btn" aria-label="Selecionar tudo" title="Selecionar tudo (Ctrl+A)" onclick={() => app.selectAll()}><CheckCheck size={19} /></button>
  {/if}
  {#if inTrash}
    <button class="icon-btn" aria-label="Restaurar" title="Restaurar" onclick={() => done(() => changeMany(notes, { trashedAt: null }, manyMsg(notes.length, 'restaurada', 'restauradas')))}><ArchiveRestore size={19} /></button>
    <button class="icon-btn" aria-label="Excluir para sempre" title="Excluir para sempre" onclick={() => (confirmDelete = true)}><Trash2 size={19} /></button>
  {:else}
    <button
      class="icon-btn"
      aria-label={allPinned ? 'Desafixar' : 'Fixar'}
      title={allPinned ? 'Desafixar' : 'Fixar'}
      onclick={() => done(() => changeMany(notes, { pinned: !allPinned }, manyMsg(notes.length, allPinned ? 'desafixada' : 'fixada', allPinned ? 'desafixadas' : 'fixadas')))}
    >
      {#if allPinned}<PinOff size={19} />{:else}<Pin size={19} />{/if}
    </button>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger class="icon-btn" aria-label="Cor" title="Cor"><Palette size={19} /></DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="menu" align="end" sideOffset={6}>
          <div class="menu-heading" aria-hidden="true">Cor</div>
          {#each NOTE_COLORS as c (c.id)}
            <DropdownMenu.Item class="menu-item" onSelect={() => done(() => changeMany(notes, { color: c.id }, `Cor: ${c.label}`))}>
              <i class="swatch-dot" style:background={c.css}></i>{c.label}
            </DropdownMenu.Item>
          {/each}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger class="icon-btn" aria-label="Categoria" title="Categoria"><Tag size={19} /></DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="menu" align="end" sideOffset={6}>
          <div class="menu-heading" aria-hidden="true">Mover para</div>
          <DropdownMenu.Item class="menu-item" onSelect={() => done(() => changeMany(notes, { categoryId: null }, 'Sem categoria'))}>Sem categoria</DropdownMenu.Item>
          {#each app.categories as c (c.id)}
            <DropdownMenu.Item class="menu-item" onSelect={() => done(() => changeMany(notes, { categoryId: c.id }, `Movidas para ${c.name}`))}>
              <i class="dot" style:background={c.color}></i>{c.name}
              {#if notes.every((n) => n.categoryId === c.id)}<span class="menu-check"><Check size={15} /></span>{/if}
            </DropdownMenu.Item>
          {/each}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
    {#if inArchive}
      <button class="icon-btn" aria-label="Desarquivar" title="Desarquivar" onclick={() => done(() => changeMany(notes, { archived: false }, manyMsg(notes.length, 'desarquivada', 'desarquivadas')))}><ArchiveRestore size={19} /></button>
    {:else}
      <button class="icon-btn" aria-label="Arquivar" title="Arquivar" onclick={() => done(() => changeMany(notes, { archived: true }, manyMsg(notes.length, 'arquivada', 'arquivadas')))}><Archive size={19} /></button>
    {/if}
    <button class="icon-btn" aria-label="Mover para a lixeira" title="Mover para a lixeira" onclick={() => done(() => changeMany(notes, { trashedAt: Date.now() }, notes.length === 1 ? 'Nota movida para a lixeira' : `${notes.length} notas movidas para a lixeira`))}><Trash2 size={19} /></button>
  {/if}
</div>

<ConfirmDialog
  bind:open={confirmDelete}
  title="Excluir para sempre?"
  text={notes.length === 1 ? 'A nota será excluída para sempre. Não dá para desfazer.' : `As ${notes.length} notas serão excluídas para sempre. Não dá para desfazer.`}
  confirm="Excluir"
  onconfirm={deleteForever}
/>
