<script lang="ts">
  import { Archive, ChevronDown, Hash, LayoutGrid, Plus, Settings, Trash2 } from '@lucide/svelte'
  import { app } from '../lib/app.svelte'
  import { categoryMenu, newCategory, tagMenu } from '../lib/menus'
  import ContextMenu from './ContextMenu.svelte'

  // Só filtra (o que ver). A visão (como ver) fica na barra de baixo.
  // Na gaveta, escolher categoria fecha; tags podem ser várias, então a gaveta fica aberta.
  // Tags recolhíveis; a escolha fica no aparelho.
  let tagsOpen = $state(readTagsOpen())
  function readTagsOpen() {
    try {
      return localStorage.getItem('ideario.tagsOpen') !== '0'
    } catch {
      return true
    }
  }
  function toggleTags() {
    tagsOpen = !tagsOpen
    try {
      localStorage.setItem('ideario.tagsOpen', tagsOpen ? '1' : '0')
    } catch {
      // sem armazenamento: vale só nesta sessão
    }
  }
  const total = $derived(app.categories.reduce((s, c) => s + c.noteCount, 0))
  const pickCategory = (id: string | null) => {
    if (id === null) app.filter.categoryId = null
    else app.setCategory(id)
    app.box = 'active'
    app.drawerOpen = false
  }
</script>

<div class="drawer-scroll">
  <div class="d-label">
    <span>Categorias</span>
    <button class="icon-btn sm d-add" aria-label="Nova categoria" title="Nova categoria" onclick={() => newCategory((id) => pickCategory(id))}><Plus size={16} /></button>
  </div>
  <button class="d-item" class:on={!app.filter.categoryId && app.box === 'active'} title="Tudo" onclick={() => pickCategory(null)}>
    <LayoutGrid size={19} /><span class="grow">Tudo</span>
  </button>
  {#each app.categories as c (c.id)}
    <ContextMenu items={() => categoryMenu(c.id)}>
      {#snippet children(trigger)}
    <button
      {...trigger}
      class="d-item"
      class:on={app.filter.categoryId === c.id && app.box === 'active'}
      aria-pressed={app.filter.categoryId === c.id}
      onclick={() => pickCategory(c.id)}
      title={c.name}
    >
      <i class="dot lg" style:background={c.color}></i>
      <span class="grow">{c.name}</span>
      <span class="count">{c.noteCount}</span>
    </button>
      {/snippet}
    </ContextMenu>
  {/each}

  <div class="d-sep"></div>
  <!-- No trilho recolhido as tags viram um ícone que expande a barra. -->
  <button class="d-item rail-only" class:on={app.filter.tags.length > 0} title="Tags" aria-label="Tags" onclick={() => app.toggleSidebar()}>
    <Hash size={19} />
  </button>
  <div class="d-label">
    <button class="d-toggle" aria-expanded={tagsOpen} aria-controls="nav-tags" onclick={toggleTags}>
      Tags<ChevronDown size={15} />
    </button>
    {#if app.filter.tags.length}<button class="link" onclick={() => (app.filter.tags = [])}>Limpar</button>{/if}
  </div>
  {#if tagsOpen}
  <div class="tag-cloud" id="nav-tags">
    {#each app.tags as t (t.name)}
      <ContextMenu items={() => tagMenu(t.name)}>
        {#snippet children(trigger)}
          <button {...trigger} class="chip" class:on={app.filter.tags.includes(t.name)} aria-pressed={app.filter.tags.includes(t.name)} onclick={() => app.toggleTag(t.name)}>
            #{t.name}<span class="count">{t.count}</span>
          </button>
        {/snippet}
      </ContextMenu>
    {/each}
  </div>
  {/if}

  <div class="d-sep"></div>
  <button class="d-item" class:on={app.box === 'archive'} title="Arquivo" onclick={() => app.openBox('archive')}><Archive size={19} /><span class="grow">Arquivo</span></button>
  <button class="d-item" class:on={app.box === 'trash'} title="Lixeira" onclick={() => app.openBox('trash')}><Trash2 size={19} /><span class="grow">Lixeira</span></button>
  <button class="d-item" title="Configurações" onclick={() => { app.drawerOpen = false; app.settingsOpen = true }}><Settings size={19} /><span class="grow">Configurações</span></button>
</div>
