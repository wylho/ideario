<script lang="ts">
  import { Plus, Repeat } from '@lucide/svelte'
  import { api } from '../lib/api'
  import { app, live } from '../lib/app.svelte'
  import { boardDrag } from '../lib/boarddrag'
  import { byDay, dayKey, fromKey, gridDays, onDay, type CalItem } from '../lib/calendar'
  import { fmtReminder, fmtTime, isOverdue } from '../lib/format'
  import { reminderMenu } from '../lib/menus'
  import { changeStatus } from '../lib/status'
  import { statusOf, type NoteSummary } from '../lib/types'
  import ContextMenu from './ContextMenu.svelte'
  import StatusToggle from './StatusToggle.svelte'

  // Calendário: os lembretes (os mesmos de Lembretes) no dia deles, com o status em cor. Arrastar para outro dia muda
  // a data (a hora fica); o "+" do dia cria uma nota com lembrete nele. Os que se repetem mostram as próximas vezes.
  const list = live(() => api.listReminders({ filter: $state.snapshot(app.filter), query: app.query, includeDone: true }), [] as NoteSummary[])

  const WEEK = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
  const days = $derived(gridDays(app.calDate, app.calMode))
  const items = $derived(byDay(list.current, days[0], days[days.length - 1]))
  const month = $derived(new Date(app.calDate).getMonth())
  const today = $derived((void app.revision, dayKey(Date.now())))
  /** Celular: a grade mostra pontinhos; a lista do dia tocado fica embaixo. */
  let selected = $state(dayKey(Date.now()))

  const title = $derived.by(() => {
    const a = new Date(app.calDate)
    if (app.calMode === 'month') return a.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).replace(/^./, (c) => c.toUpperCase())
    const [f, l] = [days[0], days[6]]
    const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleDateString('pt-BR', o)
    return f.getMonth() === l.getMonth()
      ? `${f.getDate()} a ${fmt(l, { day: 'numeric', month: 'long' })}`
      : `${fmt(f, { day: 'numeric', month: 'short' })} a ${fmt(l, { day: 'numeric', month: 'short' })}`
  })
  const counts = $derived.by(() => {
    const all = [...items.values()].flat().filter((it) => !it.repeat)
    return { total: all.length, late: all.filter((it) => isOverdue(it.n)).length }
  })

  async function moveTo(n: NoteSummary, key: string) {
    if (n.reminderAt == null) return
    const before = n.reminderAt
    const at = onDay(before, key)
    await api.updateNote(n.id, { reminderAt: at })
    app.say(`Lembrete: ${fmtReminder(at)}`, { label: 'Desfazer', run: () => void api.updateNote(n.id, { reminderAt: before }) })
  }

  function newOn(key: string) {
    app.calDate = fromKey(key).getTime()
    app.openNew()
  }
</script>

{#snippet chip(it: CalItem, key: string, big = false)}
  {@const n = it.n}
  <ContextMenu items={() => reminderMenu(n)}>
    {#snippet children(trigger)}
      <div
        {...trigger}
        class="cal-chip c-{n.color} st-{statusOf(n)}"
        class:big
        class:late={!it.repeat && isOverdue(n)}
        class:done={n.reminderDone}
        class:repeat={it.repeat}
        role="button"
        tabindex="0"
        title={`${fmtTime(it.at)} ${n.label}`}
        use:boardDrag={{ from: key, disabled: it.repeat, ondrop: (k) => moveTo(n, k) }}
        onclick={() => app.openNote(n.id)}
        onkeydown={(e) => e.key === 'Enter' && app.openNote(n.id)}
      >
        {#if big}
          <StatusToggle value={statusOf(n)} onchange={(s) => changeStatus(n, s)} />
        {:else}
          <i class="st-mark" aria-hidden="true"></i>
        {/if}
        <b>{fmtTime(it.at)}</b>
        <span class="cal-t">{#if n.emoji}{n.emoji} {/if}{n.label}</span>
        {#if n.reminderRepeat}<Repeat size={11} aria-label="se repete" />{/if}
      </div>
    {/snippet}
  </ContextMenu>
{/snippet}

<div class="cal-view">
  <div class="cal-head">
    <h2>{title}</h2>
    <span>
      {counts.total === 1 ? '1 lembrete' : `${counts.total} lembretes`}{#if counts.late}&nbsp;·&nbsp;<em>{counts.late === 1 ? '1 atrasado' : `${counts.late} atrasados`}</em>{/if}
    </span>
  </div>

  <div class="cal-grid" class:week={app.calMode === 'week'} role="grid" aria-label={title}>
    {#each WEEK as w (w)}<div class="cal-dow" role="columnheader">{w}</div>{/each}
    {#each days as d (d.getTime())}
      {@const key = dayKey(d)}
      {@const its = items.get(key) ?? []}
      {@const max = app.calMode === 'month' ? 3 : 99}
      <div
        class="cal-day"
        class:out={app.calMode === 'month' && d.getMonth() !== month}
        class:today={key === today}
        class:sel={key === selected}
        role="gridcell"
        tabindex="-1"
        data-drop={key}
        aria-label={d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
        onclick={() => (selected = key)}
        onkeydown={(e) => e.key === 'Enter' && (selected = key)}
      >
        <div class="cal-top">
          <span class="cal-num">{d.getDate()}</span>
          <button class="cal-add" aria-label="Novo lembrete neste dia" title="Novo lembrete neste dia" onclick={(e) => (e.stopPropagation(), newOn(key))}><Plus size={14} /></button>
        </div>
        <div class="cal-items">
          {#each its.slice(0, max) as it (it.n.id + it.at)}{@render chip(it, key)}{/each}
          {#if its.length > max}
            <button class="cal-more" onclick={(e) => (e.stopPropagation(), (app.calDate = d.getTime()), (app.calMode = 'week'))}>+{its.length - max} mais</button>
          {/if}
        </div>
        {#if its.length}
          <span class="cal-dots" aria-hidden="true">
            {#each its.slice(0, 4) as it (it.n.id + it.at)}<i class="st-{statusOf(it.n)}"></i>{/each}
          </span>
        {/if}
      </div>
    {/each}
  </div>

  <!-- Celular: os lembretes do dia tocado. -->
  <section class="cal-daylist" aria-label="Lembretes do dia">
    <h3 class="section-label">{fromKey(selected).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
    {#each items.get(selected) ?? [] as it (it.n.id + it.at)}{@render chip(it, selected, true)}{:else}
      <p class="muted">Nenhum lembrete neste dia.</p>
    {/each}
    <button class="btn ghost" onclick={() => newOn(selected)}><Plus size={16} />Novo lembrete</button>
  </section>
</div>
