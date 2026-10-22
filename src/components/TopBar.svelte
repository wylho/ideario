<script lang="ts">
  // macOS: a barra do app é também a barra de título (transparente): arrastar por ela move a janela.
  const overlayTitlebar = document.documentElement.dataset.titlebar === 'overlay'
  import { tick } from 'svelte'
  import { Menu, PanelLeft, Search, X } from '@lucide/svelte'
  import SyncIndicator from './SyncIndicator.svelte'
  import ViewActions from './ViewActions.svelte'
  import SelectionBar from './SelectionBar.svelte'
  import ViewSwitch from './ViewSwitch.svelte'
  import { app } from '../lib/app.svelte'
  import { viewInfo } from '../lib/views'
  import { t } from '@wylho/atrio'

  // Desktop: barra superior fixa. ☰ e as visões à esquerda (o nome do app já está no Dock/barra de título);
  // o resto ancorado à direita: a busca na ponta (sempre no mesmo lugar) e, à esquerda dela, as ações da visão.
  // O que aparece (nuvem) fica à esquerda de tudo e só ocupa a folga livre. A busca é um ícone que vira campo e fica aberto enquanto houver texto.
  // Celular: ☰ + campo de busca no topo do conteúdo.
  const where = $derived(app.box === 'archive' ? t('Arquivo') : app.box === 'trash' ? t('Lixeira') : app.filterLabel)
  const placeholder = $derived(where ? viewInfo(app.view).searchIn(where) : viewInfo(app.view).search)
  const navLabel = $derived(!app.wide ? t('Abrir menu') : app.sidebarOpen ? t('Recolher barra lateral') : t('Expandir barra lateral'))
  const searchShown = $derived(!app.wide || app.searchOpen || !!app.query)

  let input: HTMLInputElement | undefined = $state()
  $effect(() => {
    if (app.searchOpen) tick().then(() => input?.focus())
  })

  function closeIfEmpty() {
    if (!app.query) app.searchOpen = false
  }
</script>

{#snippet searchField()}
  <label class="search" class:inline={app.wide}>
    <Search size={16} aria-hidden="true" />
    <input
      id="busca"
      bind:this={input}
      bind:value={app.query}
      {placeholder}
      autocomplete="off"
      spellcheck="false"
      onblur={closeIfEmpty}
      onkeydown={(e) => {
        if (e.key === 'Escape') {
          if (app.query) app.query = ''
          else e.currentTarget.blur()
        }
      }}
    />
    {#if app.query}
      <button class="icon-btn sm" aria-label={t('Limpar busca')} onclick={() => { app.query = ''; input?.focus() }}><X size={14} /></button>
    {/if}
  </label>
{/snippet}

<header
  class="topbar"
  class:appbar={app.wide}
  class:selecting={app.selected.size > 0}
  data-tauri-drag-region={overlayTitlebar ? 'deep' : undefined}
>
  {#if app.selected.size}
    <SelectionBar />
  {:else}
  <div class="top-left">
    <button
      class="icon-btn nav-btn"
      aria-label={navLabel}
      aria-expanded={app.wide ? app.sidebarOpen : undefined}
      title={app.wide ? `${navLabel} (Ctrl+\\)` : undefined}
      onclick={() => app.toggleNav()}
    >
      {#if app.wide}<PanelLeft size={20} />{:else}<Menu size={20} />{/if}
    </button>
    {#if app.wide}
      <ViewSwitch />
    {:else}
      {@render searchField()}
    {/if}
  </div>

  <!-- Da direita para a esquerda: primeiro o que está sempre lá (busca), no mesmo lugar em todas as visões; à
       esquerda dele, as ações da visão, que mudam de uma visão para outra. -->
  <div class="top-actions">
    <SyncIndicator />
    <ViewActions />
    {#if app.wide}
      {#if searchShown}
        {@render searchField()}
      {:else}
        <button class="icon-btn" aria-label={t('Buscar')} title={`${t('Buscar')} (Ctrl+F)`} onclick={() => (app.searchOpen = true)}><Search size={19} /></button>
      {/if}
    {/if}
  </div>

  {/if}
</header>
