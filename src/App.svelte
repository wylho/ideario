<script lang="ts">
  import { app } from './lib/app.svelte'
  import { makePreviews } from './lib/previews.svelte'
  import TopBar from './components/TopBar.svelte'
  import TabBar from './components/TabBar.svelte'
  import Drawer from './components/Drawer.svelte'
  import NavList from './components/NavList.svelte'
  import FilterBar from './components/FilterBar.svelte'
  import NotesView from './components/NotesView.svelte'
  import RemindersView from './components/RemindersView.svelte'
  import FilesView from './components/FilesView.svelte'
  import MoodboardView from './components/MoodboardView.svelte'
  import Lightbox from './components/Lightbox.svelte'
  import FabMenu from './components/FabMenu.svelte'
  import AppDialogs from './components/AppDialogs.svelte'
  import FileDrop from './components/FileDrop.svelte'
  import SettingsSheet from './components/SettingsSheet.svelte'

  // O editor (TipTap) fica fora do pacote inicial: carrega em paralelo,
  // sem atrasar a primeira pintura da lista.
  const editorModule = import('./components/Editor.svelte')

  const typing = (e: KeyboardEvent) => !!(e.target as Element | null)?.closest?.('input, textarea, [contenteditable="true"]')

  function onKeydown(e: KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey
    // Seleção múltipla: Esc limpa; Ctrl+A marca todas as notas da tela.
    if (e.key === 'Escape' && app.selected.size && !app.editor && !e.defaultPrevented) {
      app.clearSelection()
      return
    }
    if (mod && e.key.toLowerCase() === 'a' && app.view === 'notes' && !app.editor && !typing(e)) {
      e.preventDefault()
      app.selectAll()
      return
    }
    if (!mod || e.altKey || app.editor) return
    if (e.key === '\\' && app.wide) {
      e.preventDefault()
      app.toggleSidebar()
    } else if (e.key.toLowerCase() === 'n' && !e.shiftKey) {
      e.preventDefault()
      app.openNew()
    } else if (e.key.toLowerCase() === 'f') {
      e.preventDefault()
      if (app.wide) app.searchOpen = true
      document.getElementById('busca')?.focus()
    }
  }

  // Prévias de PDF e vídeo que ainda faltam: depois que a lista apareceu, em segundo plano.
  setTimeout(makePreviews, 1500)
</script>

<svelte:window onkeydown={onKeydown} />

<div class="shell" class:wide={app.wide} class:rail={app.wide && !app.sidebarOpen} class:selecting-notes={app.selected.size > 0}>
  {#if app.wide}<TopBar />{/if}
  <div class="body">
  {#if app.wide}
    <!-- Como no Keep: aberta mostra tudo; recolhida vira um trilho só de ícones. A barra superior não se move. -->
    <aside class="sidebar" aria-label="Navegação">
      <NavList />
    </aside>
  {/if}

  <div class="main view-{app.view}" class:list={app.view === 'notes' && app.layout === 'list'}>
    {#if !app.wide}<TopBar />{/if}

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
      <FabMenu />
    {/if}

    {#if !app.wide}<TabBar />{/if}

    <div class="toast" class:show={!!app.toast} class:has-action={!!app.toastAction} role="status" aria-live="polite">
      <span>{app.toast}</span>
      {#if app.toastAction}
        <button onclick={() => { app.toastAction?.run(); app.toast = null; app.toastAction = null }}>{app.toastAction.label}</button>
      {/if}
    </div>
  </div>
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
  <AppDialogs />
  <FileDrop />
</div>
