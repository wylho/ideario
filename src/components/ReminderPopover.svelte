<script lang="ts">
  import { Popover } from 'bits-ui'
  import { Bell, Clock } from '@lucide/svelte'
  import { atLocal, fmtReminder, toLocalInput } from '../lib/format'
  import type { Millis } from '../lib/types'

  let { value, onchange }: { value: Millis | null; onchange: (v: Millis | null) => void } = $props()

  let open = $state(false)

  // Recalculadas a cada abertura, para "hoje à noite" não ficar no passado.
  const quick = $derived.by(() => {
    void open
    const now = new Date()
    const toMonday = (8 - now.getDay()) % 7 || 7
    return [
      ['Hoje à noite', atLocal(now.getHours() >= 18 ? 1 : 0, 18)],
      ['Amanhã de manhã', atLocal(1, 9)],
      ['Segunda que vem', atLocal(toMonday, 9)],
    ] as [string, Millis][]
  })

  const pick = (v: Millis | null) => {
    onchange(v)
    open = false
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger class="icon-btn {value != null ? 'active' : ''}" aria-label="Lembrete"><Bell size={19} /></Popover.Trigger>
  <Popover.Portal>
    <Popover.Content class="pop" align="end" sideOffset={6}>
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
        <button class="btn ghost full" onclick={() => pick(null)}>Remover lembrete</button>
      {/if}
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>
