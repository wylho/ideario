<script lang="ts">
  import { app } from '../lib/app.svelte'
  import { VIEWS } from '../lib/views'

  // Desktop: seletor de visão centralizado embaixo.
</script>

<nav class="view-dock" aria-label="Visão">
  {#each VIEWS as { id, label, Icon } (id)}
    {@const n = app.counts[id]}
    <button class="lens" class:on={app.view === id} aria-current={app.view === id ? 'page' : undefined} onclick={() => app.setView(id)}>
      <Icon size={16} />{label}
      <!-- Só Lembretes mostra número: pendentes dizem o que fazer; o total de notas não diz nada. -->
      {#if id === 'reminders' && n}<span class="n" class:late={app.counts.overdue > 0}>{n}</span>{/if}
    </button>
  {/each}
</nav>
