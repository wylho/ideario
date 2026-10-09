<script lang="ts">
  import { tick } from 'svelte'
  import { Menu, Search, X } from '@lucide/svelte'
  import SyncIndicator from './SyncIndicator.svelte'
  import ViewActions from './ViewActions.svelte'
  import BrandMark from './BrandMark.svelte'
  import SelectionBar from './SelectionBar.svelte'
  import ViewSwitch from './ViewSwitch.svelte'
  import { app } from '../lib/app.svelte'
  import { viewInfo } from '../lib/views'

  // Desktop: barra superior fixa. ☰ e marca à esquerda; o resto ancorado à direita, com as visões no canto.
  // O que aparece ou cresce (nuvem, campo de busca) fica à esquerda dos itens fixos e só ocupa a folga livre:
  // nada que já estava ali sai do lugar. A busca é um ícone que vira campo e fica aberto enquanto houver texto.
  // Celular: ☰ + campo de busca no topo do conteúdo.
  const where = $derived(app.box === 'archive' ? 'Arquivo' : app.box === 'trash' ? 'Lixeira' : app.filterLabel)
  const placeholder = $derived(`Buscar ${viewInfo(app.view).many}${where ? ` em ${where}` : ''}`)
  const navLabel = $derived(!app.wide ? 'Abrir menu' : app.sidebarOpen ? 'Recolher barra lateral' : 'Expandir barra lateral')
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
      <button class="icon-btn sm" aria-label="Limpar busca" onclick={() => { app.query = ''; input?.focus() }}><X size={14} /></button>
    {/if}
  </label>
{/snippet}

<header class="topbar" class:appbar={app.wide} class:selecting={app.selected.size > 0}>
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
      <Menu size={20} />
    </button>
    {#if app.wide}
      <span class="brand-area">
        <BrandMark />
        <span class="brand">Ideario</span>
      </span>
    {:else}
      {@render searchField()}
    {/if}
  </div>

  <div class="top-actions">
    <SyncIndicator />
    {#if app.wide}
      {#if searchShown}
        {@render searchField()}
      {:else}
        <button class="icon-btn" aria-label="Buscar" title="Buscar (Ctrl+F)" onclick={() => (app.searchOpen = true)}><Search size={19} /></button>
      {/if}
    {/if}
    <ViewActions />
  </div>

  {/if}

  {#if app.wide}
    <span class="top-sep" aria-hidden="true"></span>
    <ViewSwitch />
  {/if}
</header>
