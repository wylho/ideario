<script lang="ts">
  import { app } from '../lib/app.svelte'
  import { VIEWS } from '../lib/views'

  // Celular e janela média: abas embaixo, perto do dedo. Só Lembretes mostra quantos estão pendentes.
</script>

<nav class="tabbar" aria-label="Visão">
  {#each VIEWS as { id, label, Icon } (id)}
    {@const n = app.counts[id]}
    <button class:on={app.view === id} aria-current={app.view === id ? 'page' : undefined} onclick={() => app.setView(id)}>
      <span class="tab-ico">
        <Icon size={20} />
        {#if id === 'reminders' && n}<span class="tab-n" class:late={app.counts.overdue > 0}>{n}</span>{/if}
      </span>
      {label}
    </button>
  {/each}
</nav>
