<script lang="ts">
  import { tick } from 'svelte'
  import { LayoutGrid, Menu, Rows3, Search, X } from '@lucide/svelte'
  import SyncIndicator from './SyncIndicator.svelte'
  import SortMenu from './SortMenu.svelte'
  import ViewSwitch from './ViewSwitch.svelte'
  import { app } from '../lib/app.svelte'
  import { viewInfo } from '../lib/views'

  // Desktop: barra superior fixa. Marca, visões e ações com folgas iguais entre os três grupos;
  // a busca é um ícone que abre o campo por cima da folga e fica aberto enquanto houver texto.
  // Celular: ☰ + campo de busca no topo do conteúdo.
  const where = $derived(app.box === 'archive' ? 'Arquivo' : app.box === 'trash' ? 'Lixeira' : app.filterLabel)
  const placeholder = $derived(`Buscar ${viewInfo(app.view).many}${where ? ` em ${where}` : ''}`)
  const navLabel = $derived(!app.wide ? 'Abrir menu' : app.sidebarOpen ? 'Recolher barra lateral' : 'Expandir barra lateral')
  const searchShown = $derived(!app.wide || app.searchOpen || !!app.query)

  let input: HTMLInputElement | undefined = $state()
  $effect(() => {
    if (app.searchOpen) tick().then(() => input?.focus())
  })

  // O campo cresce para a esquerda até perto das visões, nunca por cima delas.
  let bar: HTMLElement | undefined = $state()
  let searchW = $state(300)
  $effect(() => {
    if (!bar || !app.wide) return
    const fit = () => {
      const views = bar!.querySelector('.view-switch')?.getBoundingClientRect()
      const slot = bar!.querySelector('.search-slot')?.getBoundingClientRect()
      if (views && slot) searchW = Math.max(180, Math.min(320, Math.floor(slot.right - views.right - 16)))
    }
    const ro = new ResizeObserver(fit)
    ro.observe(bar)
    const views = bar.querySelector('.view-switch')
    if (views) ro.observe(views)
    return () => ro.disconnect()
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

<header class="topbar" class:appbar={app.wide} bind:this={bar} style:--search-w={app.wide ? `${searchW}px` : undefined}>
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
    {:else}
      {@render searchField()}
    {/if}
  </div>

  {#if app.wide}<ViewSwitch />{/if}

  <!-- Largura fixa e a nuvem como primeiro item, num espaço reservado: nada aqui muda de tamanho
       (nem ao trocar de visão, nem quando a nuvem aparece), então as visões não saem do lugar.
       No desktop o campo de busca abre por cima da folga, a partir da lupa, sem empurrar nada. -->
  <div class="top-actions">
    {#if app.wide}
      <span class="sync-slot"><SyncIndicator /></span>
      <span class="search-slot">
        {#if searchShown}
          {@render searchField()}
        {:else}
          <button class="icon-btn" aria-label="Buscar" title="Buscar (Ctrl+F)" onclick={() => (app.searchOpen = true)}><Search size={19} /></button>
        {/if}
      </span>
    {/if}
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
    {#if !app.wide}<SyncIndicator />{/if}
  </div>
</header>
