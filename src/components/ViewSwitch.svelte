<script lang="ts">
  import { app } from '../lib/app.svelte'
  import { VIEWS } from '../lib/views'

  // Desktop: seletor de visão na barra superior, ao lado da busca (no celular são as abas de baixo).
</script>

<nav class="view-switch" aria-label="Visão">
  {#each VIEWS as { id, label, Icon } (id)}
    {@const n = app.counts[id]}
    <button class="lens" class:on={app.view === id} aria-current={app.view === id ? 'page' : undefined} title={label} onclick={() => app.setView(id)}>
      <Icon size={17} /><span class="lens-label">{label}</span>
      <!-- Só Lembretes mostra número: pendentes dizem o que fazer; o total de notas não diz nada. -->
      {#if id === 'reminders' && n}<span class="n" class:late={app.counts.overdue > 0}>{n}</span>{/if}
    </button>
  {/each}
</nav>
