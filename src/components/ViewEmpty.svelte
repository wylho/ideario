<script lang="ts">
  import { app } from '../lib/app.svelte'
  import { t } from '@wylho/atrio'
  import { viewInfo } from '../lib/views'
  import type { View } from '../lib/types'

  // Estado vazio de uma visão. Com filtro ativo, diz onde não há nada e mantém o filtro;
  // oferece criar ali mesmo ou ver a mesma visão sem filtro.
  let { view, hint }: { view: View; hint?: string } = $props()

  const info = $derived(viewInfo(view))
  const where = $derived(app.filterLabel)
  // Lembretes cria nota (o lembrete se põe nela); Calendário e Kanban criam o lembrete já no dia/status.
  const reminderView = $derived(view === 'calendar' || view === 'kanban')
</script>

<div class="empty">
  <div class="empty-ico"><info.Icon /></div>
  {#if app.query}
    <h3>{t('Nada encontrado')}</h3>
    <p>{where ? t('Nenhum resultado para “{busca}” em {onde}.', { busca: app.query, onde: where }) : t('Nenhum resultado para “{busca}”.', { busca: app.query })}</p>
  {:else}
    <h3>{where ? info.noneIn(where) : info.none}</h3>
    <p>{hint ?? (where ? info.filterOn(where) : t('Nada por aqui ainda.'))}</p>
    <div class="empty-acts">
      <button class="btn primary" onclick={() => app.openNew()}>{#if reminderView}{where ? t('Novo lembrete em {onde}', { onde: where }) : t('Novo lembrete')}{:else}{where ? t('Nova nota em {onde}', { onde: where }) : t('Nova nota')}{/if}</button>
      {#if where}<button class="btn ghost" onclick={() => app.clearFilter()}>{info.seeAll}</button>{/if}
    </div>
  {/if}
</div>
