<script lang="ts">
  import { Switch } from 'bits-ui'
  import { Bell, Check } from '@lucide/svelte'
  import { api } from '../lib/api'
  import { app, live } from '../lib/app.svelte'
  import { dayDiff, fmtShortDate, fmtTime, isOverdue } from '../lib/format'
  import Empty from './Empty.svelte'
  import type { NoteSummary } from '../lib/types'

  let showDone = $state(false)
  const list = live(() => api.listReminders({ query: app.query, includeDone: showDone }), [] as NoteSummary[])

  const groups = $derived.by(() => {
    const now = Date.now()
    const items = list.current
    const late = (n: NoteSummary) => isOverdue(n, now)
    const dd = (n: NoteSummary) => dayDiff(n.reminderAt!, now)
    return ([
      ['Atrasados', items.filter(late)],
      ['Hoje', items.filter((n) => !late(n) && dd(n) === 0)],
      ['Amanhã', items.filter((n) => !late(n) && dd(n) === 1)],
      ['Próximos', items.filter((n) => !late(n) && dd(n) > 1)],
      ['Concluídos', items.filter((n) => n.reminderDone && dd(n) < 0)],
    ] as [string, NoteSummary[]][]).filter(([, g]) => g.length)
  })

  async function toggle(n: NoteSummary) {
    await api.setReminderDone(n.id, !n.reminderDone)
    app.say(n.reminderDone ? 'Lembrete reaberto' : 'Lembrete concluído')
  }
</script>

<div class="toolbar">
  <p class="hint">Lembretes ficam dentro das notas. Esta aba reúne todos por data.</p>
  <label class="switch-row">
    <Switch.Root id="mostrar-concluidos" class="switch" bind:checked={showDone}><Switch.Thumb class="thumb" /></Switch.Root>
    Concluídos
  </label>
</div>

{#if list.ready && !list.current.length}
  <Empty icon={Bell} title="Nenhum lembrete" text="Abra uma nota e toque no sino para lembrar dela depois." />
{/if}

{#each groups as [label, g] (label)}
  <section class="r-group">
    <h2 class="section-label" class:late={label === 'Atrasados'}>{label}<span class="count">{g.length}</span></h2>
    <div class="r-list">
      {#each g as n (n.id)}
        {@const cat = app.category(n.categoryId)}
        {@const dd = dayDiff(n.reminderAt!)}
        <div class="r-item" class:done={n.reminderDone}>
          <button class="r-check" aria-label={n.reminderDone ? 'Reabrir lembrete' : 'Concluir lembrete'} onclick={() => toggle(n)}>
            {#if n.reminderDone}<Check size={14} strokeWidth={3} />{/if}
          </button>
          <button class="r-main" onclick={() => app.openNote(n.id)}>
            <span class="r-title">{n.title || n.excerpt || n.checklist[0]?.text || 'Sem título'}</span>
            <span class="r-sub">
              {#if cat}<i class="dot" style:background={cat.color}></i>{cat.name}{:else}Sem categoria{/if}
            </span>
          </button>
          <span class="r-time" class:late={isOverdue(n)}>
            <b>{fmtTime(n.reminderAt!)}</b>
            {#if Math.abs(dd) > 1}<small>{fmtShortDate(n.reminderAt!)}</small>{/if}
            {#if dd === -1}<small>ontem</small>{/if}
          </span>
        </div>
      {/each}
    </div>
  </section>
{/each}
