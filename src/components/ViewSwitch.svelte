<script lang="ts">
  import { app } from '../lib/app.svelte'
  import { t } from '@wylho/atrio'
  import { VIEWS } from '../lib/views'

  // Desktop: seletor de visão na barra superior, ao lado da busca (no celular são as abas de baixo).
</script>

<nav class="view-switch" aria-label={t('Visão')}>
  {#each VIEWS as v (v.id)}
    {@const { id, label, Icon } = v}
    {@const n = id === 'reminders' ? app.counts.reminders : 0}
    <button class="lens" class:on={app.view === id} aria-current={app.view === id ? 'page' : undefined} title={label} onclick={() => app.setView(id)}>
      <Icon size={17} /><span class="lens-label">{label}</span>
      <!-- Só Lembretes mostra número: pendentes dizem o que fazer; o total de notas não diz nada. -->
      {#if id === 'reminders' && n}<span class="n" class:late={app.counts.overdue > 0}>{n}</span>{/if}
    </button>
  {/each}
</nav>
