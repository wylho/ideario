<script lang="ts">
  import { Plus, Repeat } from '@lucide/svelte'
  import { api } from '../lib/api'
  import { app, live } from '../lib/app.svelte'
  import { boardDrag } from '../lib/boarddrag'
  import { addDays, byDay, dayKey, fromKey, gridDays, onDay, shift, type CalItem } from '../lib/calendar'
  import { fmtReminder, fmtTime, isOverdue } from '../lib/format'
  import { reminderMenu } from '../lib/menus'
  import { changeStatus } from '../lib/status'
  import { statusOf, type NoteSummary } from '../lib/types'
  import { ContextMenu } from '@wylho/atrio'
  import { StatusToggle } from '@wylho/atrio'

  // Calendário: os lembretes (os mesmos de Lembretes) no dia deles, com o status em cor. Arrastar para outro dia muda
  // a data (a hora fica); o "+" do dia (ou dois cliques nele) cria uma nota com lembrete nele. Os que se repetem mostram
  // as próximas vezes. Concluídos só com "Mostrar concluídos", como em Lembretes. Teclado: setas mudam o dia,
  // PageUp/PageDown o mês (ou a semana), T volta para hoje e Enter cria um lembrete no dia escolhido.
  const list = live(() => api.listReminders({ filter: $state.snapshot(app.filter), query: app.query, includeDone: app.showDone }), [] as NoteSummary[])

  const WEEK = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
  const days = $derived(gridDays(fromKey(app.calDay).getTime(), app.calMode))
  const items = $derived(byDay(list.current, days[0], days[days.length - 1]))
  const month = $derived(fromKey(app.calDay).getMonth())
  const today = $derived((void app.revision, dayKey(Date.now())))
  /** O dia escolhido; no celular a grade mostra pontinhos e a lista dele fica embaixo. */
  const selected = $derived(app.calDay)

  const title = $derived.by(() => {
    const a = fromKey(app.calDay)
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
    app.calDay = key
    app.openNew()
  }

  const typing = (e: KeyboardEvent) => (e.target as HTMLElement).closest('input, textarea, [contenteditable="true"], [role="dialog"], [role="menu"]')
  function onKey(e: KeyboardEvent) {
    if (app.editor || app.settingsOpen || e.ctrlKey || e.metaKey || e.altKey || typing(e)) return
    const move = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]
    if (move) app.calDay = dayKey(addDays(fromKey(app.calDay), move))
    else if (e.key === 'PageUp' || e.key === 'PageDown') app.calDay = shift(app.calDay, app.calMode, e.key === 'PageUp' ? -1 : 1)
    else if (e.key === 't' || e.key === 'T') app.calDay = dayKey(Date.now())
    else if (e.key === 'Enter' && !(e.target as HTMLElement).closest('button, [role="button"]')) newOn(app.calDay)
    else return
    e.preventDefault()
  }

  // Celular: arrastar o dedo para o lado na grade muda o mês (ou a semana).
  let swipe: { x: number; y: number } | null = null
  const swipeStart = (e: PointerEvent) => e.pointerType === 'touch' && (swipe = { x: e.clientX, y: e.clientY })
  function swipeEnd(e: PointerEvent) {
    if (!swipe) return
    const [dx, dy] = [e.clientX - swipe.x, e.clientY - swipe.y]
    swipe = null
    if (Math.abs(dx) > 60 && Math.abs(dy) < 40) app.calDay = shift(app.calDay, app.calMode, dx < 0 ? 1 : -1)
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

<svelte:window onkeydown={onKey} />

<div class="cal-view">
  <div class="cal-head">
    <h2>{title}</h2>
    <span>
      {counts.total === 1 ? '1 lembrete' : `${counts.total} lembretes`}{#if counts.late}&nbsp;·&nbsp;<em>{counts.late === 1 ? '1 atrasado' : `${counts.late} atrasados`}</em>{/if}
    </span>
  </div>

  <div class="cal-grid" class:week={app.calMode === 'week'} role="grid" aria-label={title} tabindex="-1" onpointerdown={swipeStart} onpointerup={swipeEnd} onpointercancel={() => (swipe = null)}>
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
        aria-selected={key === selected}
        onclick={() => (app.calDay = key)}
        onkeydown={(e) => e.key === ' ' && (e.preventDefault(), (app.calDay = key))}
        ondblclick={(e) => !(e.target as HTMLElement).closest('.cal-chip, button') && newOn(key)}
      >
        <div class="cal-top">
          <span class="cal-num">{d.getDate()}</span>
          <button class="cal-add" aria-label="Novo lembrete neste dia" title="Novo lembrete neste dia" onclick={(e) => (e.stopPropagation(), newOn(key))}><Plus size={14} /></button>
        </div>
        <div class="cal-items">
          {#each its.slice(0, max) as it (it.n.id + it.at)}{@render chip(it, key)}{/each}
          {#if its.length > max}
            <button class="cal-more" onclick={(e) => (e.stopPropagation(), (app.calDay = key), (app.calMode = 'week'))}>+{its.length - max} mais</button>
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
