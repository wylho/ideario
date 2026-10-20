<script lang="ts">
  import type { ReminderStatus } from '../lib/types'

  // Status do lembrete num seletor de três cores (vermelho, amarelo, verde): cada bolinha é um botão.
  let { value, onchange, label = 'Status do lembrete' }: { value: ReminderStatus; onchange: (s: ReminderStatus) => void; label?: string } = $props()

  const STATES: [ReminderStatus, string][] = [['todo', 'A fazer'], ['doing', 'Em andamento'], ['done', 'Concluído']]
</script>

<span class="status-toggle" role="radiogroup" aria-label={label}>
  {#each STATES as [s, name] (s)}
    <button
      type="button"
      role="radio"
      class="st-dot st-{s}"
      class:on={value === s}
      aria-checked={value === s}
      aria-label={name}
      title={name}
      onclick={(e) => {
        e.stopPropagation()
        if (value !== s) onchange(s)
      }}
      onpointerdown={(e) => e.stopPropagation()}
    ></button>
  {/each}
</span>
