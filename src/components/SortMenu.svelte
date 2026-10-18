<script lang="ts" generics="T extends string">
  import { DropdownMenu } from 'bits-ui'
  import { ArrowDownUp, Check } from '@lucide/svelte'

  // Mesmo botão de ordenar em todas as visões que ordenam; muda só a lista de opções.
  let { heading, options, value, onchange, small = false, label = 'Ordenar' }: {
    heading: string
    /** Nome do botão (antes da opção escolhida). */
    label?: string
    /** Botão pequeno (cabeçalho da lateral). */
    small?: boolean
    options: { id: T; label: string; hint?: string }[]
    value: T
    onchange: (v: T) => void
  } = $props()
  const current = $derived(options.find((s) => s.id === value) ?? options[0])
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger class="icon-btn{small ? ' sm' : ''}" aria-label="{label}: {current.label}" title="{label}: {current.label}">
    <ArrowDownUp size={small ? 15 : 18} />
  </DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content class="menu" align="end" sideOffset={6}>
      <div class="menu-heading" aria-hidden="true">{heading}</div>
      <DropdownMenu.RadioGroup {value} onValueChange={(v) => onchange(v as T)}>
        {#each options as s (s.id)}
          <DropdownMenu.RadioItem value={s.id} class="menu-item">
            {#snippet children({ checked })}
              <span class="grow">{s.label}</span>
              {#if s.hint}<small class="menu-hint">{s.hint}</small>{/if}
              <span class="menu-check" class:hidden={!checked}><Check size={15} /></span>
            {/snippet}
          </DropdownMenu.RadioItem>
        {/each}
      </DropdownMenu.RadioGroup>
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>
