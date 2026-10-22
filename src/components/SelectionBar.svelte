<script lang="ts">
  import { t, tn } from '@wylho/atrio'
  import { DropdownMenu } from 'bits-ui'
  import { Archive, ArchiveRestore, Check, CheckCheck, Palette, Pin, PinOff, Plus, Tag, Trash2, X } from '@lucide/svelte'
  import { api } from '../lib/api'
  import { app } from '../lib/app.svelte'
  import { changeMany, newCategory, NOTE_COLORS } from '../lib/menus'
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
  async function deleteForever() {
    let n = 0
    try {
      for (const x of notes) {
        await api.deleteNote(x.id)
        n++
      }
    } catch {
      app.say(n ? t('{n} de {total} notas excluídas; as outras não puderam ser excluídas', { n, total: notes.length }) : t('Não foi possível excluir as notas'))
      app.clearSelection()
      return
    }
    app.clearSelection()
    app.say(tn(n, 'Nota excluída', '{n} notas excluídas'))
  }
</script>

<div class="sel-left">
  <button class="icon-btn" aria-label={t('Limpar seleção')} title={t('Limpar seleção (Esc)')} onclick={() => app.clearSelection()}><X size={20} /></button>
  <span class="sel-count" aria-live="polite">{count}<span class="sel-word">{' '}{count === 1 ? t('selecionada') : t('selecionadas')}</span></span>
</div>

<div class="top-actions sel-actions" role="toolbar" aria-label={t('Ações nas notas selecionadas')}>
  {#if count < app.visibleNotes.length}
    <button class="icon-btn" aria-label={t('Selecionar tudo')} title={t('Selecionar tudo (Ctrl+A)')} onclick={() => app.selectAll()}><CheckCheck size={19} /></button>
  {/if}
  {#if inTrash}
    <button class="icon-btn" aria-label={t('Restaurar')} title={t('Restaurar')} onclick={() => changeMany(notes, { trashedAt: null }, tn(notes.length, 'Nota restaurada', '{n} notas restauradas'))}><ArchiveRestore size={19} /></button>
    <button class="icon-btn" aria-label={t('Excluir para sempre')} title={t('Excluir para sempre')} onclick={() => (confirmDelete = true)}><Trash2 size={19} /></button>
  {:else}
    <button
      class="icon-btn"
      aria-label={allPinned ? t('Desafixar') : t('Fixar')}
      title={allPinned ? t('Desafixar') : t('Fixar')}
      onclick={() => changeMany(notes, { pinned: !allPinned }, allPinned ? tn(notes.length, 'Nota desafixada', '{n} notas desafixadas') : tn(notes.length, 'Nota fixada', '{n} notas fixadas'))}
    >
      {#if allPinned}<PinOff size={19} />{:else}<Pin size={19} />{/if}
    </button>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger class="icon-btn" aria-label={t('Cor')} title={t('Cor')}><Palette size={19} /></DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="menu" align="end" sideOffset={6}>
          <div class="menu-heading" aria-hidden="true">{t('Cor')}</div>
          {#each NOTE_COLORS as c (c.id)}
            <DropdownMenu.Item class="menu-item" onSelect={() => changeMany(notes, { color: c.id }, t('Cor: {cor}', { cor: c.label }))}>
              <i class="swatch-dot" style:background={c.css}></i>{c.label}
            </DropdownMenu.Item>
          {/each}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger class="icon-btn" aria-label={t('Categoria')} title={t('Categoria')}><Tag size={19} /></DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="menu" align="end" sideOffset={6}>
          <div class="menu-heading" aria-hidden="true">{t('Mover para')}</div>
          <DropdownMenu.Item class="menu-item" onSelect={() => changeMany(notes, { categoryId: null }, t('Sem categoria'))}>{t('Sem categoria')}</DropdownMenu.Item>
          {#each app.categories as c (c.id)}
            <DropdownMenu.Item class="menu-item" onSelect={() => (notes.every((n) => n.categoryId === c.id) ? changeMany(notes, { categoryId: null }, t('Sem categoria')) : changeMany(notes, { categoryId: c.id }, t('Movidas para {nome}', { nome: c.name })))}>
              <i class="dot" style:background={c.color}></i>{c.name}
              {#if notes.every((n) => n.categoryId === c.id)}<span class="menu-check"><Check size={15} /></span>{/if}
            </DropdownMenu.Item>
          {/each}
          <DropdownMenu.Separator class="menu-sep" />
          <DropdownMenu.Item class="menu-item" onSelect={() => newCategory((id, name) => changeMany(notes, { categoryId: id }, t('Movidas para {nome}', { nome: name })))}>
            <Plus size={16} />{t('Nova categoria…')}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
    {#if inArchive}
      <button class="icon-btn" aria-label={t('Desarquivar')} title={t('Desarquivar')} onclick={() => changeMany(notes, { archived: false }, tn(notes.length, 'Nota desarquivada', '{n} notas desarquivadas'))}><ArchiveRestore size={19} /></button>
    {:else}
      <button class="icon-btn" aria-label={t('Arquivar')} title={t('Arquivar')} onclick={() => changeMany(notes, { archived: true }, tn(notes.length, 'Nota arquivada', '{n} notas arquivadas'))}><Archive size={19} /></button>
    {/if}
    <button class="icon-btn" aria-label={t('Mover para a lixeira')} title={t('Mover para a lixeira')} onclick={() => changeMany(notes, { trashedAt: Date.now() }, tn(notes.length, 'Nota movida para a lixeira', '{n} notas movidas para a lixeira'))}><Trash2 size={19} /></button>
  {/if}
</div>

<ConfirmDialog
  bind:open={confirmDelete}
  title={t('Excluir para sempre?')}
  text={tn(notes.length, 'A nota será excluída para sempre. Não dá para desfazer.', 'As {n} notas serão excluídas para sempre. Não dá para desfazer.')}
  confirm={t('Excluir')}
  onconfirm={deleteForever}
/>
