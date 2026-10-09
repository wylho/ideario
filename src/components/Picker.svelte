<script lang="ts" generics="T extends string">
  import { Select } from 'bits-ui'
  import { Check, ChevronDown } from '@lucide/svelte'

  let { id, value = $bindable(), options, prefix }: {
    id: string
    value: T
    options: [T, string][]
    prefix?: string
  } = $props()

  const items = $derived(options.map(([v, label]) => ({ value: v, label })))
  const label = $derived(options.find(([v]) => v === value)?.[1] ?? '')
</script>

<Select.Root type="single" {items} bind:value={() => value, (v) => (value = v as T)}>
  <Select.Trigger {id} class="picker" aria-label={prefix}>
    {#if prefix}<span class="muted">{prefix}</span>{/if}
    <span>{label}</span>
    <ChevronDown size={15} />
  </Select.Trigger>
  <Select.Portal>
    <Select.Content class="menu" sideOffset={6}>
      <Select.Viewport>
        {#each options as [v, l] (v)}
          <Select.Item value={v} label={l} class="menu-item">
            {#snippet children({ selected })}
              {l}
              {#if selected}<span class="menu-check"><Check size={15} /></span>{/if}
            {/snippet}
          </Select.Item>
        {/each}
      </Select.Viewport>
    </Select.Content>
  </Select.Portal>
</Select.Root>
