<script lang="ts">
  import { Popover } from 'bits-ui'
  import { Bell, Check, Clock, Repeat, RotateCcw, X } from '@lucide/svelte'
  import { fmtReminder, isOverdue, toLocalInput } from '../lib/format'
  import { quickTimes } from '../lib/reminders'
  import type { Millis, RepeatKind } from '../lib/types'
  import Picker from './Picker.svelte'

  // O mesmo menu de lembrete abre pelo sino do topo do editor ('icon') e pela pílula do lembrete ('pill').
  let {
    value, done = false, repeat = null, onchange, ondone, onrepeat, variant = 'icon',
  }: {
    value: Millis | null
    done?: boolean
    repeat?: RepeatKind | null
    onchange: (v: Millis | null) => void
    ondone?: (done: boolean) => void
    /** Sem isso, não mostra a escolha de repetir. */
    onrepeat?: (r: RepeatKind | null) => void
    variant?: 'icon' | 'pill'
  } = $props()

  const REPEATS: [RepeatKind | 'none', string][] = [
    ['none', 'Não repetir'], ['day', 'Todo dia'], ['week', 'Toda semana'], ['month', 'Todo mês'], ['year', 'Todo ano'],
  ]

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
      <Popover.Trigger class="rem-pill-btn" aria-label="Alterar lembrete: {fmtReminder(value)}">
        <Bell size={11} />{fmtReminder(value)}{#if repeat}<Repeat size={11} aria-label="se repete" />{/if}
      </Popover.Trigger>
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
      {#if value != null && onrepeat}
        <div class="field">
          <span>Repetir</span>
          <Picker id="lembrete-repetir" bind:value={() => repeat ?? 'none', (v) => onrepeat(v === 'none' ? null : v)} options={REPEATS} />
        </div>
      {/if}
      {#if value != null}
        <div class="pop-actions">
          {#if ondone && !repeat}
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
