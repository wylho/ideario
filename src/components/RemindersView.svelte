<script lang="ts">
  import { t } from '@wylho/atrio'
  import { Repeat } from '@lucide/svelte'
  import { api } from '../lib/api'
  import { changeStatus } from '../lib/status'
  import { StatusToggle } from '@wylho/atrio'
  import { app, live } from '../lib/app.svelte'
  import { dayDiff, fmtShortDate, fmtTime, isOverdue } from '../lib/format'
  import ViewEmpty from './ViewEmpty.svelte'
  import { ContextMenu } from '@wylho/atrio'
  import { reminderMenu } from '../lib/menus'
  import { statusOf, type NoteSummary } from '../lib/types'

  const list = live(() => api.listReminders({ filter: $state.snapshot(app.filter), query: app.query, includeDone: true }), [] as NoteSummary[])

  const pending = $derived(list.current.filter((n) => !n.reminderDone))
  // Concluídos: os mais recentes primeiro.
  const done = $derived(list.current.filter((n) => n.reminderDone).reverse())

  type GroupId = 'late' | 'today' | 'tomorrow' | 'later'
  const groupLabel = (id: GroupId) =>
    id === 'late' ? t('Atrasados') : id === 'today' ? t('Hoje') : id === 'tomorrow' ? t('Amanhã') : t('Próximos')
  const groups = $derived.by(() => {
    const now = Date.now()
    const late = (n: NoteSummary) => isOverdue(n, now)
    const dd = (n: NoteSummary) => dayDiff(n.reminderAt!, now)
    return ([
      ['late', pending.filter(late)],
      ['today', pending.filter((n) => !late(n) && dd(n) === 0)],
      ['tomorrow', pending.filter((n) => !late(n) && dd(n) === 1)],
      ['later', pending.filter((n) => !late(n) && dd(n) > 1)],
    ] as [GroupId, NoteSummary[]][]).filter(([, g]) => g.length)
  })

</script>

{#snippet item(n: NoteSummary)}
  {@const cat = app.category(n.categoryId)}
  {@const dd = dayDiff(n.reminderAt!)}
  <ContextMenu items={() => reminderMenu(n)}>
    {#snippet children(trigger)}
  <div {...trigger} class="r-item" class:done={n.reminderDone}>
    <StatusToggle value={statusOf(n)} onchange={(s) => changeStatus(n, s)} />
    <button class="r-main" onclick={() => app.openNote(n.id)}>
      <span class="r-title">{#if n.emoji}{n.emoji} {/if}{n.label}</span>
      <span class="r-sub">
        {#if cat}<i class="dot" style:background={cat.color}></i>{cat.name}{:else}{t('Sem categoria')}{/if}
      </span>
    </button>
    <span class="r-time" class:late={isOverdue(n)}>
      <b>{fmtTime(n.reminderAt!)}{#if n.reminderRepeat}<Repeat size={12} aria-label={t('se repete')} />{/if}</b>
      {#if Math.abs(dd) > 1}<small>{fmtShortDate(n.reminderAt!)}</small>{/if}
      {#if dd === -1}<small>{t('ontem')}</small>{/if}
      {#if dd === 1 && n.reminderDone}<small>{t('amanhã')}</small>{/if}
      {#if dd === 0 && n.reminderDone}<small>{t('hoje')}</small>{/if}
    </span>
  </div>
    {/snippet}
  </ContextMenu>
{/snippet}

{#if list.ready && !pending.length}
  {#if done.length && !app.query}
    <div class="empty"><h3>{t('Tudo em dia')}</h3><p>{app.filterLabel ? t('Nenhum lembrete pendente em {onde}.', { onde: app.filterLabel }) : t('Nenhum lembrete pendente.')}</p></div>
  {:else}
    <ViewEmpty view="reminders" hint={app.filterLabel ? undefined : t('Abra uma nota e toque no sino para lembrar dela depois.')} />
  {/if}
{/if}

{#each groups as [id, g] (id)}
  <section class="r-group">
    <h2 class="section-label" class:late={id === 'late'}>{groupLabel(id)}<span class="count">{g.length}</span></h2>
    <div class="r-list">
      {#each g as n (n.id)}{@render item(n)}{/each}
    </div>
  </section>
{/each}

{#if app.showDone && done.length}
  <section class="r-group">
    <h2 class="section-label">{t('Concluídos')}<span class="count">{done.length}</span></h2>
    <div class="r-list">
      {#each done as n (n.id)}{@render item(n)}{/each}
    </div>
  </section>
{/if}
