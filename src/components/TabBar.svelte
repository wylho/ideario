<script lang="ts">
  import { Bell, Images, Paperclip, StickyNote } from '@lucide/svelte'
  import { app } from '../lib/app.svelte'
  import type { View } from '../lib/types'

  const tabs = [
    { id: 'notes', label: 'Notas', Icon: StickyNote },
    { id: 'reminders', label: 'Lembretes', Icon: Bell },
    { id: 'files', label: 'Arquivos', Icon: Paperclip },
    { id: 'moodboard', label: 'Moodboard', Icon: Images },
  ] satisfies { id: View; label: string; Icon: typeof StickyNote }[]
</script>

<nav class="tabbar" aria-label="Seções">
  {#each tabs as { id, label, Icon } (id)}
    <button class:on={app.view === id} aria-current={app.view === id ? 'page' : undefined} onclick={() => app.setView(id)}>
      <span class="tab-ico"><Icon size={20} /></span>
      {label}
      {#if id === 'reminders' && app.overdue > 0}<i class="badge" aria-label="Lembretes atrasados"></i>{/if}
    </button>
  {/each}
</nav>
