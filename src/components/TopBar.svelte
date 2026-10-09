<script lang="ts">
  import { LayoutGrid, Menu, Rows3, Search, X } from '@lucide/svelte'
  import SyncIndicator from './SyncIndicator.svelte'
  import SortMenu from './SortMenu.svelte'
  import ViewSwitch from './ViewSwitch.svelte'
  import { app } from '../lib/app.svelte'
  import { viewInfo } from '../lib/views'

  // Desktop: barra superior fixa (☰, marca, busca, ações) que não se move quando a lateral recolhe.
  // Celular: a mesma barra, sem a marca, no topo do conteúdo.
  const where = $derived(app.box === 'archive' ? 'Arquivo' : app.box === 'trash' ? 'Lixeira' : app.filterLabel)
  const placeholder = $derived(`Buscar ${viewInfo(app.view).many}${where ? ` em ${where}` : ''}`)
  const navLabel = $derived(!app.wide ? 'Abrir menu' : app.sidebarOpen ? 'Recolher barra lateral' : 'Expandir barra lateral')
</script>

<header class="topbar" class:appbar={app.wide}>
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
      <svg class="brand-mark" viewBox="0 0 1024 1024" aria-hidden="true">
        <rect width="1024" height="1024" rx="228" fill="#2547c9" />
        <path d="M300 236h332l156 156v356a40 40 0 0 1-40 40H300a40 40 0 0 1-40-40V276a40 40 0 0 1 40-40z" fill="#fff" />
        <path d="M632 236v116a40 40 0 0 0 40 40h116z" fill="#a9bcf5" />
        <rect x="340" y="460" width="300" height="40" rx="20" fill="#2547c9" />
        <rect x="340" y="560" width="220" height="40" rx="20" fill="#2547c9" opacity=".55" />
        <circle cx="380" cy="356" r="44" fill="#e86a3a" />
      </svg>
      <span class="brand">Ideario</span>
    </span>
  {/if}
  <label class="search">
    <Search size={16} aria-hidden="true" />
    <input id="busca" bind:value={app.query} {placeholder} autocomplete="off" spellcheck="false" />
    {#if app.query}
      <button class="icon-btn sm" aria-label="Limpar busca" onclick={() => (app.query = '')}><X size={14} /></button>
    {/if}
  </label>
  {#if app.wide}<ViewSwitch />{/if}
  <div class="top-actions">
    {#if app.view === 'notes'}
      <SortMenu />
      <button
        class="icon-btn"
        aria-label={app.layout === 'grid' ? 'Ver em lista' : 'Ver em grade'}
        title={app.layout === 'grid' ? 'Ver em lista' : 'Ver em grade'}
        onclick={() => (app.layout = app.layout === 'grid' ? 'list' : 'grid')}
      >
        {#if app.layout === 'grid'}<Rows3 size={19} />{:else}<LayoutGrid size={19} />{/if}
      </button>
    {/if}
    <SyncIndicator />
  </div>
</header>
