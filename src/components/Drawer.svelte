<script lang="ts">
  import { Dialog } from 'bits-ui'
  import { Archive, Bell, Images, Paperclip, Plus, Settings, StickyNote, Trash2 } from '@lucide/svelte'
  import { app } from '../lib/app.svelte'
  import type { Scope } from '../lib/types'

  const isOn = (kind: Scope['kind'], id?: string) => {
    const s = app.scope
    if (s.kind !== kind) return false
    if (id === undefined) return true
    return (s.kind === 'category' && s.id === id) || (s.kind === 'tag' && s.tag === id)
  }
  // Filtrar a partir de Lembretes leva para Notas (Lembretes não tem filtro).
  const target = () => (app.view === 'reminders' ? 'notes' : app.view)
</script>

<Dialog.Root bind:open={app.drawerOpen}>
  <Dialog.Portal>
    <Dialog.Overlay class="overlay" />
    <Dialog.Content class="drawer" aria-describedby={undefined}>
      <div class="drawer-head">
        <Dialog.Title class="brand">Ideário</Dialog.Title>
        <span class="meta">Sincronizado · Drive</span>
      </div>
      <div class="drawer-scroll">
        <button class="d-item" class:on={app.view === 'notes' && app.scope.kind === 'all'} onclick={() => app.go('notes', { kind: 'all' })}>
          <StickyNote size={19} />Notas
        </button>
        <button class="d-item" class:on={app.view === 'reminders'} onclick={() => app.go('reminders')}><Bell size={19} />Lembretes</button>
        <button class="d-item" class:on={app.view === 'files'} onclick={() => app.go('files')}><Paperclip size={19} />Arquivos</button>
        <button class="d-item" class:on={app.view === 'moodboard'} onclick={() => app.go('moodboard')}><Images size={19} />Moodboard</button>

        <div class="d-sep"></div>
        <div class="d-label"><span>Categorias</span><button class="link">Editar</button></div>
        {#each app.categories as c (c.id)}
          <button class="d-item" class:on={isOn('category', c.id)} onclick={() => app.go(target(), { kind: 'category', id: c.id })}>
            <i class="dot lg" style:background={c.color}></i>
            <span class="grow">{c.name}</span>
            <span class="count">{c.noteCount}</span>
          </button>
        {/each}
        <button class="d-item muted"><Plus size={19} />Nova categoria</button>

        <div class="d-sep"></div>
        <div class="d-label"><span>Tags</span></div>
        <div class="tag-cloud">
          {#each app.tags as t (t.name)}
            <button class="chip" class:on={isOn('tag', t.name)} onclick={() => app.go(target(), { kind: 'tag', tag: t.name })}>
              #{t.name}<span class="count">{t.count}</span>
            </button>
          {/each}
        </div>

        <div class="d-sep"></div>
        <button class="d-item" class:on={isOn('archive')} onclick={() => app.go('notes', { kind: 'archive' })}><Archive size={19} />Arquivo</button>
        <button class="d-item" class:on={isOn('trash')} onclick={() => app.go('notes', { kind: 'trash' })}><Trash2 size={19} />Lixeira</button>
        <button class="d-item" onclick={() => { app.drawerOpen = false; app.settingsOpen = true }}><Settings size={19} />Configurações</button>
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
