<script lang="ts">
  import { CloudCheck, LayoutGrid, Menu, Rows3, Search, X } from '@lucide/svelte'
  import { app } from '../lib/app.svelte'

  const viewLabel = $derived({ notes: 'notas', reminders: 'lembretes', files: 'arquivos', moodboard: 'imagens' }[app.view])
  const placeholder = $derived(`Buscar ${viewLabel}${app.scopeLabel && app.view !== 'reminders' ? ` em ${app.scopeLabel}` : ''}`)
</script>

<header class="topbar">
  {#if !app.wide}
    <button class="icon-btn" aria-label="Abrir menu" onclick={() => (app.drawerOpen = true)}><Menu size={20} /></button>
  {/if}
  <label class="search">
    <Search size={16} aria-hidden="true" />
    <input id="busca" bind:value={app.query} {placeholder} autocomplete="off" spellcheck="false" />
    {#if app.query}
      <button class="icon-btn sm" aria-label="Limpar busca" onclick={() => (app.query = '')}><X size={14} /></button>
    {/if}
  </label>
  {#if app.view === 'notes'}
    <button
      class="icon-btn"
      aria-label={app.layout === 'grid' ? 'Ver em lista' : 'Ver em grade'}
      onclick={() => (app.layout = app.layout === 'grid' ? 'list' : 'grid')}
    >
      {#if app.layout === 'grid'}<Rows3 size={19} />{:else}<LayoutGrid size={19} />{/if}
    </button>
  {/if}
  <button class="sync" aria-label="Sincronização" onclick={() => (app.settingsOpen = true)}>
    <CloudCheck size={18} />
  </button>
</header>
