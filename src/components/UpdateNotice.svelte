<script lang="ts">
  import { t } from '@wylho/atrio'
  import { Download, RotateCw, X } from '@lucide/svelte'
  import { updates } from '../lib/updates.svelte'

  // Versão nova do app, num cartão no canto (como os lembretes). Só aparece quando há novidade.
  const pct = $derived(updates.progress === null ? null : Math.round(updates.progress * 100))
</script>

{#if updates.info && (!updates.dismissed || updates.phase === 'downloading')}
  <div class="alerts update-alerts" role="region" aria-label={t('Atualização')}>
    <div class="alert" role="status">
      <span class="alert-ico"><Download size={18} /></span>
      <div class="alert-text">
        <b>{t('Ideario {versao} disponível', { versao: updates.info.version })}</b>
        <small>
          {#if updates.phase === 'downloading'}
            {pct === null ? t('Baixando…') : t('Baixando… {pct}%', { pct })}
          {:else if updates.phase === 'error'}
            {t('Não foi possível atualizar agora.')}
          {:else}
            {t('Atualiza e reabre o app.')}
          {/if}
        </small>
      </div>
      <div class="alert-actions">
        {#if updates.phase === 'error'}
          <button class="btn ghost sm" onclick={() => updates.install()}><RotateCw size={14} />{t('Tentar de novo')}</button>
        {:else if updates.phase !== 'downloading'}
          <button class="btn primary sm" onclick={() => updates.install()}>{t('Atualizar')}</button>
        {/if}
        {#if updates.phase !== 'downloading'}
          <button class="icon-btn sm" aria-label={t('Depois')} title={t('Depois')} onclick={() => (updates.dismissed = true)}><X size={16} /></button>
        {/if}
      </div>
    </div>
  </div>
{/if}
