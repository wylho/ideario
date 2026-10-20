<script lang="ts">
  import { Plus, Repeat } from '@lucide/svelte'
  import { api } from '../lib/api'
  import { app, live } from '../lib/app.svelte'
  import { boardDrag } from '../lib/boarddrag'
  import { fmtReminder, isOverdue } from '../lib/format'
  import { reminderMenu } from '../lib/menus'
  import { STATUS, changeStatus } from '../lib/status'
  import { statusOf, type NoteSummary, type ReminderStatus } from '../lib/types'
  import ContextMenu from './ContextMenu.svelte'
  import StatusToggle from './StatusToggle.svelte'
  import ViewEmpty from './ViewEmpty.svelte'

  // Kanban: os lembretes (os mesmos de Lembretes) em três colunas pelo status: a fazer (vermelho), em andamento
  // (amarelo) e concluído (verde). Arrastar entre colunas ou tocar no seletor de cores muda o status.
  const list = live(() => api.listReminders({ filter: $state.snapshot(app.filter), query: app.query, includeDone: true }), [] as NoteSummary[])

  const DONE_SHOWN = 30
  let allDone = $state(false)
  const cols = $derived.by(() => {
    const by: Record<ReminderStatus, NoteSummary[]> = { todo: [], doing: [], done: [] }
    for (const n of list.current) by[statusOf(n)].push(n)
    // concluídos: os mais recentes primeiro
    by.done.reverse()
    return by
  })

  /** Primeira linha de texto da prévia (abaixo do título). */
  const excerpt = (n: NoteSummary) => {
    if (!n.title) return undefined
    for (const b of n.preview) if (b.kind !== 'more' && b.kind !== 'file' && b.text) return b.text
  }
</script>

{#if list.ready && !list.current.length}
  <ViewEmpty view="kanban" hint={app.filterLabel ? undefined : 'Toda nota com lembrete aparece aqui, na coluna do status dela.'} />
{:else}
  <div class="kanban">
    {#each ['todo', 'doing', 'done'] as const as st (st)}
      {@const notes = st === 'done' && !allDone ? cols.done.slice(0, DONE_SHOWN) : cols[st]}
      <section class="kb-col st-{st}" data-drop={st} aria-label={STATUS[st].label}>
        <h2 class="kb-head">
          <i class="st-mark" aria-hidden="true"></i>{STATUS[st].label}<span class="count">{cols[st].length}</span>
          {#if st !== 'done'}
            <button class="kb-add" aria-label="Novo lembrete em {STATUS[st].label}" title="Novo lembrete em {STATUS[st].label}" onclick={() => app.openNewInColumn(st === 'doing')}><Plus size={16} /></button>
          {/if}
        </h2>
        <div class="kb-cards">
          {#each notes as n (n.id)}
            {@const cat = app.category(n.categoryId)}
            <ContextMenu items={() => reminderMenu(n)}>
              {#snippet children(trigger)}
                <div
                  {...trigger}
                  class="kb-card c-{n.color}"
                  role="button"
                  tabindex="0"
                  use:boardDrag={{ from: st, ondrop: (to) => changeStatus(n, to as ReminderStatus) }}
                  onclick={() => app.openNote(n.id)}
                  onkeydown={(e) => e.key === 'Enter' && app.openNote(n.id)}
                >
                  <div class="kb-top">
                    <h3>{#if n.emoji}{n.emoji} {/if}{n.label}</h3>
                    <StatusToggle value={st} onchange={(s) => changeStatus(n, s)} />
                  </div>
                  {#if excerpt(n)}<p>{excerpt(n)}</p>{/if}
                  <div class="kb-meta">
                    <span class="pill" class:late={isOverdue(n)} class:done={n.reminderDone}>
                      {fmtReminder(n.reminderAt!)}{#if n.reminderRepeat}<Repeat size={11} aria-label="se repete" />{/if}
                    </span>
                    {#if cat}<span class="pill"><i class="dot" style:background={cat.color}></i>{cat.name}</span>{/if}
                  </div>
                </div>
              {/snippet}
            </ContextMenu>
          {:else}
            <p class="kb-empty">{st === 'doing' ? 'Arraste para cá o que está em andamento' : st === 'done' ? 'Nada concluído ainda' : 'Nada a fazer'}</p>
          {/each}
          {#if st === 'done' && !allDone && cols.done.length > DONE_SHOWN}
            <button class="btn ghost" onclick={() => (allDone = true)}>Mostrar todos ({cols.done.length})</button>
          {/if}
        </div>
      </section>
    {/each}
  </div>
{/if}
