<script lang="ts">
  import { t } from '@wylho/atrio'
  import { Bell, BellRing, Check, Clock, X } from '@lucide/svelte'
  import { alerts, complete, dismiss, openAlert, snooze } from '../lib/notify.svelte'
  import { fmtReminder } from '../lib/format'

  // Lembretes que acabaram de vencer, num cartão no canto (além da notificação do sistema).
</script>

{#if alerts.list.length}
  <div class="alerts" role="region" aria-label={t('Lembretes')}>
    {#each alerts.list as a (a.id)}
      <div class="alert" role="alert">
        <span class="alert-ico" class:late={a.late}>{#if a.late}<Bell size={18} />{:else}<BellRing size={18} />{/if}</span>
        <button class="alert-text" onclick={() => openAlert(a)}>
          <b>{a.title || t('Lembrete')}</b>
          <small>{a.late ? t('Atrasado · {quando}', { quando: fmtReminder(a.at) }) : t('Agora')}</small>
        </button>
        <div class="alert-actions">
          <button class="icon-btn sm" aria-label={t('Adiar 10 minutos')} title={t('Adiar 10 min')} onclick={() => snooze(a)}><Clock size={16} /></button>
          {#if !a.repeats}<button class="icon-btn sm" aria-label={t('Concluir')} title={t('Concluir')} onclick={() => complete(a)}><Check size={16} /></button>{/if}
          <button class="icon-btn sm" aria-label={t('Fechar aviso')} title={t('Fechar')} onclick={() => dismiss(a.id)}><X size={16} /></button>
        </div>
      </div>
    {/each}
  </div>
{/if}
