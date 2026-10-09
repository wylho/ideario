<script lang="ts">
  import { Popover } from 'bits-ui'
  import { Bell, Check, Clock, RotateCcw, X } from '@lucide/svelte'
  import { fmtReminder, isOverdue, toLocalInput } from '../lib/format'
  import { quickTimes } from '../lib/reminders'
  import type { Millis } from '../lib/types'

  // O mesmo menu de lembrete abre pelo sino do topo do editor ('icon') e pela pílula do lembrete ('pill').
  let {
    value, done = false, onchange, ondone, variant = 'icon',
  }: {
    value: Millis | null
    done?: boolean
    onchange: (v: Millis | null) => void
    ondone?: (done: boolean) => void
    variant?: 'icon' | 'pill'
  } = $props()

  let open = $state(false)
  const quick = $derived.by(() => (void open, quickTimes()))

  const pick = (v: Millis | null) => {
    onchange(v)
    open = false
  }
</script>

<Popover.Root bind:open>
  {#if variant === 'pill' && value != null}
    <span class="pill rem-pill" class:late={isOverdue({ reminderAt: value, reminderDone: done })} class:done>
      <Popover.Trigger class="rem-pill-btn" aria-label="Alterar lembrete: {fmtReminder(value)}"><Bell size={11} />{fmtReminder(value)}</Popover.Trigger>
      <button aria-label="Remover lembrete" onclick={() => onchange(null)}><X size={12} /></button>
    </span>
  {:else}
    <Popover.Trigger class="icon-btn {value != null ? 'active' : ''}" aria-label="Lembrete"><Bell size={19} /></Popover.Trigger>
  {/if}
  <Popover.Portal>
    <Popover.Content class="pop" align={variant === 'pill' ? 'start' : 'end'} sideOffset={6}>
      <p class="pop-title">Lembrar de mim</p>
      <div class="quick">
        {#each quick as [label, at] (label)}
          <button onclick={() => pick(at)}><Clock size={15} /><span>{label}</span><small>{fmtReminder(at)}</small></button>
        {/each}
      </div>
      <label class="field">
        <span>Data e hora</span>
        <input
          id="lembrete-data"
          type="datetime-local"
          value={value != null ? toLocalInput(value) : ''}
          onchange={(e) => e.currentTarget.value && onchange(new Date(e.currentTarget.value).getTime())}
        />
      </label>
      {#if value != null}
        <div class="pop-actions">
          {#if ondone}
            <button class="btn ghost" onclick={() => { ondone(!done); open = false }}>
              {#if done}<RotateCcw size={15} />Reabrir{:else}<Check size={15} />Concluir{/if}
            </button>
          {/if}
          <button class="btn ghost" onclick={() => pick(null)}>Remover</button>
        </div>
      {/if}
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>
