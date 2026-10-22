<script lang="ts">
  import { t } from '@wylho/atrio'
  import { Dialog } from 'bits-ui'
  import { EyeOff, Hash, Lock, X } from '@lucide/svelte'
  import { app } from '../lib/app.svelte'
  import { categoryMenu } from '../lib/menus'
  import { ContextMenu } from '@wylho/atrio'
  import { NO_CATEGORY, NO_TAGS } from '../lib/types'

  // O que está sendo visto. No desktop com a lateral aberta: título com a categoria e as tags ativas.
  // No celular, na janela média e no desktop com a lateral fechada: linha de categorias sempre à mão e as tags numa folha.
  let tagsOpen = $state(false)
  const cat = $derived(app.category(app.filter.categoryId))
  const noCategory = $derived(app.filter.categoryId === NO_CATEGORY)
  const showNoCategory = $derived(noCategory || (app.orphans.uncategorized > 0 && app.categories.length > 0))
  const showNoTags = $derived(app.filter.tags.includes(NO_TAGS) || (app.orphans.untagged > 0 && app.tags.length > 0))
  const tagLabel = (tag: string) => (tag === NO_TAGS ? t('Sem tags') : `#${tag}`)
  const boxLabel = $derived(app.box === 'archive' ? t('Arquivo') : app.box === 'trash' ? t('Lixeira') : null)
</script>

{#snippet activeTags()}
  {#each app.filter.tags as tag (tag)}
    <button class="chip on" onclick={() => app.toggleTag(tag)} aria-label={t('Tirar {nome} do filtro', { nome: tagLabel(tag) })}>{tagLabel(tag)}<X size={13} /></button>
  {/each}
{/snippet}

{#if boxLabel}
  <div class="filter-bar">
    <span class="scope-pill">
      {boxLabel}
      <button aria-label={t('Voltar às notas')} onclick={() => (app.box = 'active')}><X size={13} /></button>
    </span>
    {#if app.hasFilter}<span class="filter-hint">{t('Filtro: {filtro}', { filtro: app.filterLabel ?? '' })}</span>{/if}
  </div>
{:else if app.wide && app.sidebarOpen}
  {#if app.hasFilter}
    <div class="filter-bar">
      {#if cat || noCategory}
        <h1 class="filter-title">
          {#if cat}<i class="dot" style:background={cat.color}></i>{cat.name}{:else}<i class="dot none"></i>{t('Sem categoria')}{/if}
          <button class="icon-btn sm" aria-label={t('Tirar {nome} do filtro', { nome: cat?.name ?? t('Sem categoria') })} onclick={() => (app.filter.categoryId = null)}><X size={16} /></button>
        </h1>
      {:else}
        <span class="filter-hint">{t('Filtrando:')}</span>
      {/if}
      {@render activeTags()}
      <button class="link" onclick={() => app.clearFilter()}>{t('Limpar filtro')}</button>
    </div>
  {/if}
{:else}
  <div class="filter-row" role="group" aria-label={t('Categoria')}>
    <button class="chip" class:on={!app.filter.categoryId} onclick={() => (app.filter.categoryId = null)}>{t('Tudo')}</button>
    {#each app.categories as c (c.id)}
      <ContextMenu items={() => categoryMenu(c.id)}>
        {#snippet children(trigger)}
          <button {...trigger} class="chip" class:on={app.filter.categoryId === c.id} aria-pressed={app.filter.categoryId === c.id} onclick={() => app.openCategory(c.id)}>
            <i class="dot" style:background={c.color}></i>{c.name}
            {#if c.locked && !c.unlocked}<Lock size={12} class="cat-flag" />{:else if c.hidden}<EyeOff size={12} class="cat-flag" />{/if}
          </button>
        {/snippet}
      </ContextMenu>
    {/each}
    {#if showNoCategory}
      <button class="chip" class:on={noCategory} aria-pressed={noCategory} onclick={() => app.setCategory(NO_CATEGORY)}><i class="dot none"></i>{t('Sem categoria')}</button>
    {/if}
    <button class="chip" class:on={app.filter.tags.length > 0} onclick={() => (tagsOpen = true)}>
      <Hash size={14} />{t('Tags')}{#if app.filter.tags.length}<span class="count">{app.filter.tags.length}</span>{/if}
    </button>
  </div>
  {#if app.filter.tags.length}
    <div class="filter-row">{@render activeTags()}<button class="link" onclick={() => (app.filter.tags = [])}>{t('Limpar')}</button></div>
  {/if}
{/if}

<Dialog.Root bind:open={tagsOpen}>
  <Dialog.Portal>
    <Dialog.Overlay class="overlay" />
    <Dialog.Content class="sheet" aria-describedby={undefined}>
      <div class="sheet-head">
        <Dialog.Title class="sheet-title">{t('Tags')}</Dialog.Title>
        <Dialog.Close class="icon-btn" aria-label={t('Fechar')}><X size={20} /></Dialog.Close>
      </div>
      <div class="sheet-scroll">
        <div class="tag-cloud">
          {#each app.tags as tag (tag.name)}
            <button class="chip" class:on={app.filter.tags.includes(tag.name)} aria-pressed={app.filter.tags.includes(tag.name)} onclick={() => app.toggleTag(tag.name)}>
              #{tag.name}<span class="count">{tag.count}</span>
            </button>
          {/each}
          {#if showNoTags}
            <button class="chip no-tags" class:on={app.filter.tags.includes(NO_TAGS)} aria-pressed={app.filter.tags.includes(NO_TAGS)} onclick={() => app.toggleTag(NO_TAGS)}>
              {t('Sem tags')}<span class="count">{app.orphans.untagged}</span>
            </button>
          {/if}
        </div>
        <div class="sheet-actions">
          {#if app.filter.tags.length}<button class="btn ghost" onclick={() => (app.filter.tags = [])}>{t('Limpar tags')}</button>{/if}
          <Dialog.Close class="btn primary">{t('Pronto')}</Dialog.Close>
        </div>
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
