<script lang="ts">
  import { Dialog } from 'bits-ui'
  import { Hash, X } from '@lucide/svelte'
  import { app } from '../lib/app.svelte'
  import { categoryMenu } from '../lib/menus'
  import ContextMenu from './ContextMenu.svelte'

  // O que está sendo visto. No desktop: título com a categoria e as tags ativas.
  // No celular: linha de categorias sempre à mão e as tags numa folha.
  let tagsOpen = $state(false)
  const cat = $derived(app.category(app.filter.categoryId))
  const boxLabel = $derived(app.box === 'archive' ? 'Arquivo' : app.box === 'trash' ? 'Lixeira' : null)
</script>

{#snippet activeTags()}
  {#each app.filter.tags as t (t)}
    <button class="chip on" onclick={() => app.toggleTag(t)} aria-label="Tirar #{t} do filtro">#{t}<X size={13} /></button>
  {/each}
{/snippet}

{#if boxLabel}
  <div class="filter-bar">
    <span class="scope-pill">
      {boxLabel}
      <button aria-label="Voltar às notas" onclick={() => (app.box = 'active')}><X size={13} /></button>
    </span>
    {#if app.hasFilter}<span class="filter-hint">Filtro: {app.filterLabel}</span>{/if}
  </div>
{:else if app.wide}
  {#if app.hasFilter}
    <div class="filter-bar">
      {#if cat}
        <h1 class="filter-title">
          <i class="dot" style:background={cat.color}></i>{cat.name}
          <button class="icon-btn sm" aria-label="Tirar {cat.name} do filtro" onclick={() => (app.filter.categoryId = null)}><X size={16} /></button>
        </h1>
      {:else}
        <span class="filter-hint">Filtrando:</span>
      {/if}
      {@render activeTags()}
      <button class="link" onclick={() => app.clearFilter()}>Limpar filtro</button>
    </div>
  {/if}
{:else}
  <div class="filter-row" role="group" aria-label="Categoria">
    <button class="chip" class:on={!app.filter.categoryId} onclick={() => (app.filter.categoryId = null)}>Tudo</button>
    {#each app.categories as c (c.id)}
      <ContextMenu items={() => categoryMenu(c.id)}>
        {#snippet children(trigger)}
          <button {...trigger} class="chip" class:on={app.filter.categoryId === c.id} aria-pressed={app.filter.categoryId === c.id} onclick={() => app.setCategory(c.id)}>
            <i class="dot" style:background={c.color}></i>{c.name}
          </button>
        {/snippet}
      </ContextMenu>
    {/each}
    <button class="chip" class:on={app.filter.tags.length > 0} onclick={() => (tagsOpen = true)}>
      <Hash size={14} />Tags{#if app.filter.tags.length}<span class="count">{app.filter.tags.length}</span>{/if}
    </button>
  </div>
  {#if app.filter.tags.length}
    <div class="filter-row">{@render activeTags()}<button class="link" onclick={() => (app.filter.tags = [])}>Limpar</button></div>
  {/if}
{/if}

<Dialog.Root bind:open={tagsOpen}>
  <Dialog.Portal>
    <Dialog.Overlay class="overlay" />
    <Dialog.Content class="sheet" aria-describedby={undefined}>
      <div class="sheet-head">
        <Dialog.Title class="sheet-title">Tags</Dialog.Title>
        <Dialog.Close class="icon-btn" aria-label="Fechar"><X size={20} /></Dialog.Close>
      </div>
      <div class="sheet-scroll">
        <div class="tag-cloud">
          {#each app.tags as t (t.name)}
            <button class="chip" class:on={app.filter.tags.includes(t.name)} aria-pressed={app.filter.tags.includes(t.name)} onclick={() => app.toggleTag(t.name)}>
              #{t.name}<span class="count">{t.count}</span>
            </button>
          {/each}
        </div>
        <div class="sheet-actions">
          {#if app.filter.tags.length}<button class="btn ghost" onclick={() => (app.filter.tags = [])}>Limpar tags</button>{/if}
          <Dialog.Close class="btn primary">Pronto</Dialog.Close>
        </div>
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
