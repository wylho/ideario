<script lang="ts">
  import { app } from '../lib/app.svelte'
  import { t } from '@wylho/atrio'
  import { VIEWS } from '../lib/views'

  // Celular e janela média: abas embaixo, perto do dedo. Só Lembretes mostra quantos estão pendentes.
</script>

<!-- Uma coluna por visão (o CSS do Atrio supõe seis; com Links são sete). -->
<nav class="tabbar" class:many={VIEWS.length > 6} aria-label={t('Visão')} style:grid-template-columns="repeat({VIEWS.length}, minmax(0, 1fr))">
  {#each VIEWS as v (v.id)}
    {@const { id, label, Icon } = v}
    {@const n = id === 'reminders' ? app.counts.reminders : 0}
    <button class:on={app.view === id} aria-current={app.view === id ? 'page' : undefined} onclick={() => app.setView(id)}>
      <span class="tab-ico">
        <Icon size={20} />
        {#if id === 'reminders' && n}<span class="tab-n" class:late={app.counts.overdue > 0}>{n}</span>{/if}
      </span>
      {label}
    </button>
  {/each}
</nav>

<style>
  /* Sete abas num celular estreito: letra um pouco menor, e reticências se ainda não couber. */
  .tabbar.many :global(button) { font-size: 9px; letter-spacing: -.02em; overflow: hidden; text-overflow: ellipsis; }
</style>
