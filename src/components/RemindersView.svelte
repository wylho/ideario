<script lang="ts">
  import { Check, ChevronDown } from '@lucide/svelte'
  import { api } from '../lib/api'
  import { app, live } from '../lib/app.svelte'
  import { dayDiff, fmtShortDate, fmtTime, isOverdue } from '../lib/format'
  import ViewEmpty from './ViewEmpty.svelte'
  import type { NoteSummary } from '../lib/types'

  let showDone = $state(false)
  const list = live(() => api.listReminders({ filter: $state.snapshot(app.filter), query: app.query, includeDone: true }), [] as NoteSummary[])

  const pending = $derived(list.current.filter((n) => !n.reminderDone))
  // Concluídos: os mais recentes primeiro.
  const done = $derived(list.current.filter((n) => n.reminderDone).reverse())

  const groups = $derived.by(() => {
    const now = Date.now()
    const late = (n: NoteSummary) => isOverdue(n, now)
    const dd = (n: NoteSummary) => dayDiff(n.reminderAt!, now)
    return ([
      ['Atrasados', pending.filter(late)],
      ['Hoje', pending.filter((n) => !late(n) && dd(n) === 0)],
      ['Amanhã', pending.filter((n) => !late(n) && dd(n) === 1)],
      ['Próximos', pending.filter((n) => !late(n) && dd(n) > 1)],
    ] as [string, NoteSummary[]][]).filter(([, g]) => g.length)
  })

  async function toggle(n: NoteSummary) {
    await api.setReminderDone(n.id, !n.reminderDone)
    app.say(n.reminderDone ? 'Lembrete reaberto' : 'Lembrete concluído')
  }
</script>

{#snippet item(n: NoteSummary)}
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
      {#if dd === 1 && n.reminderDone}<small>amanhã</small>{/if}
      {#if dd === 0 && n.reminderDone}<small>hoje</small>{/if}
    </span>
  </div>
{/snippet}

{#if list.ready && !pending.length}
  {#if done.length && !app.query}
    <div class="empty"><h3>Tudo em dia</h3><p>Nenhum lembrete pendente{app.filterLabel ? ` em ${app.filterLabel}` : ''}.</p></div>
  {:else}
    <ViewEmpty view="reminders" hint={app.filterLabel ? undefined : 'Abra uma nota e toque no sino para lembrar dela depois.'} />
  {/if}
{/if}

{#each groups as [label, g] (label)}
  <section class="r-group">
    <h2 class="section-label" class:late={label === 'Atrasados'}>{label}<span class="count">{g.length}</span></h2>
    <div class="r-list">
      {#each g as n (n.id)}{@render item(n)}{/each}
    </div>
  </section>
{/each}

{#if done.length}
  <section class="r-group">
    <button class="section-label done-toggle" aria-expanded={showDone} onclick={() => (showDone = !showDone)}>
      Concluídos<span class="count">{done.length}</span>
      <ChevronDown size={15} />
    </button>
    {#if showDone}
      <div class="r-list">
        {#each done as n (n.id)}{@render item(n)}{/each}
      </div>
    {/if}
  </section>
{/if}
