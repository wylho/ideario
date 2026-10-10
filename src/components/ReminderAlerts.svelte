<script lang="ts">
  import { Bell, BellRing, Check, Clock, X } from '@lucide/svelte'
  import { alerts, complete, dismiss, openAlert, snooze } from '../lib/notify.svelte'
  import { fmtReminder } from '../lib/format'

  // Lembretes que acabaram de vencer, num cartão no canto (além da notificação do sistema).
</script>

{#if alerts.list.length}
  <div class="alerts" role="region" aria-label="Lembretes">
    {#each alerts.list as a (a.id)}
      <div class="alert" role="alert">
        <span class="alert-ico" class:late={a.late}>{#if a.late}<Bell size={18} />{:else}<BellRing size={18} />{/if}</span>
        <button class="alert-text" onclick={() => openAlert(a)}>
          <b>{a.title || 'Lembrete'}</b>
          <small>{a.late ? `Atrasado · ${fmtReminder(a.at)}` : 'Agora'}</small>
        </button>
        <div class="alert-actions">
          <button class="icon-btn sm" aria-label="Adiar 10 minutos" title="Adiar 10 min" onclick={() => snooze(a)}><Clock size={16} /></button>
          {#if !a.repeats}<button class="icon-btn sm" aria-label="Concluir" title="Concluir" onclick={() => complete(a)}><Check size={16} /></button>{/if}
          <button class="icon-btn sm" aria-label="Fechar aviso" title="Fechar" onclick={() => dismiss(a.id)}><X size={16} /></button>
        </div>
      </div>
    {/each}
  </div>
{/if}
