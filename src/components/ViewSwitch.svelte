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

<style>
  /* Com as sete visões, os nomes só cabem ao lado das ações da visão (o Calendário tem várias) com a janela bem
     larga: abaixo de 1600 px (margem para as fontes de cada sistema), só os ícones (o nome fica na dica) e o número vira um selo no canto. O atrio.css faz o
     mesmo abaixo de 1200 px, que bastava com seis visões. */
  @media (max-width: 1599px) {
    .lens { padding: 0 11px; }
    .lens-label { display: none; }
    .lens .n { position: absolute; top: 3px; right: 2px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 999px; display: grid; place-items: center; font-size: 10px; background: var(--bg); }
  }
</style>
