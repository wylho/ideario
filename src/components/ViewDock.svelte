<script lang="ts">
  import { app } from '../lib/app.svelte'
  import { VIEWS } from '../lib/views'

  // Desktop: seletor de visão centralizado embaixo, com a contagem de cada visão para o filtro atual.
</script>

<nav class="view-dock" aria-label="Visão">
  {#each VIEWS as { id, label, Icon } (id)}
    {@const n = app.counts[id]}
    <button class="lens" class:on={app.view === id} class:zero={!n} aria-current={app.view === id ? 'page' : undefined} onclick={() => app.setView(id)}>
      <Icon size={16} />{label}
      <span class="n" class:late={id === 'reminders' && app.counts.overdue > 0}>{n}</span>
    </button>
  {/each}
</nav>
