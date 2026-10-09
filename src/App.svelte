<script lang="ts">
  import { Plus } from '@lucide/svelte'
  import { app } from './lib/app.svelte'
  import TopBar from './components/TopBar.svelte'
  import TabBar from './components/TabBar.svelte'
  import Drawer from './components/Drawer.svelte'
  import NavList from './components/NavList.svelte'
  import FilterBar from './components/FilterBar.svelte'
  import ViewDock from './components/ViewDock.svelte'
  import NotesView from './components/NotesView.svelte'
  import RemindersView from './components/RemindersView.svelte'
  import FilesView from './components/FilesView.svelte'
  import MoodboardView from './components/MoodboardView.svelte'
  import Lightbox from './components/Lightbox.svelte'
  import SettingsSheet from './components/SettingsSheet.svelte'

  // O editor (TipTap) fica fora do pacote inicial: carrega em paralelo,
  // sem atrasar a primeira pintura da lista.
  const editorModule = import('./components/Editor.svelte')

  function onKeydown(e: KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey
    if (!mod || e.altKey || app.editor) return
    if (e.key.toLowerCase() === 'n' && !e.shiftKey) {
      e.preventDefault()
      app.openNew()
    } else if (e.key.toLowerCase() === 'f') {
      e.preventDefault()
      document.getElementById('busca')?.focus()
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="shell" class:wide={app.wide}>
  {#if app.wide}
    <aside class="sidebar" aria-label="Navegação">
      <div class="drawer-head">
        <span class="brand">Ideario</span>
        <span class="meta">Sincronizado · Drive</span>
      </div>
      <NavList />
    </aside>
  {/if}

  <div class="main view-{app.view}" class:list={app.view === 'notes' && app.layout === 'list'}>
    <TopBar />

    <FilterBar />

    <main class="content">
      {#if app.view === 'notes'}
        <NotesView />
      {:else if app.view === 'reminders'}
        <RemindersView />
      {:else if app.view === 'files'}
        <FilesView />
      {:else}
        <MoodboardView />
      {/if}
    </main>

    {#if app.box !== 'trash'}
      <button class="fab" onclick={() => app.openNew()} aria-label="Nova nota" title="Nova nota (Ctrl+N)"><Plus size={26} strokeWidth={2.2} /></button>
    {/if}

    {#if app.wide}<ViewDock />{:else}<TabBar />{/if}

    <div class="toast" class:show={!!app.toast} role="status" aria-live="polite">{app.toast}</div>
  </div>

  {#if !app.wide}<Drawer />{/if}
  <SettingsSheet />
  {#if app.editor}
    {#await editorModule then { default: Editor }}
      {#key app.editor.id}
        <Editor target={app.editor} />
      {/key}
    {/await}
  {/if}
  <Lightbox />
</div>
