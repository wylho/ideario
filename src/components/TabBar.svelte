<script lang="ts">
  import { app } from '../lib/app.svelte'
  import { VIEWS } from '../lib/views'

  // Celular e janela média: abas embaixo, perto do dedo. O número é quanto há em cada visão para o filtro atual.
</script>

<nav class="tabbar" aria-label="Visão">
  {#each VIEWS as { id, label, Icon } (id)}
    {@const n = app.counts[id]}
    <button class:on={app.view === id} aria-current={app.view === id ? 'page' : undefined} onclick={() => app.setView(id)}>
      <span class="tab-ico">
        <Icon size={20} />
        <span class="tab-n" class:zero={!n} class:late={id === 'reminders' && app.counts.overdue > 0}>{n}</span>
      </span>
      {label}
    </button>
  {/each}
</nav>
