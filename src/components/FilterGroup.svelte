<script lang="ts" generics="T extends string">
  import type { Component } from 'svelte'
  import { DropdownMenu } from 'bits-ui'
  import { Check, ListFilter } from '@lucide/svelte'
  import { app } from '../lib/app.svelte'

  // Filtro de uma visão, na barra superior. Desktop: um botão por opção (tocar de novo tira o filtro).
  // Celular: um botão só, que abre a lista. Mesmo componente para tipos de arquivo e tons do moodboard.
  type Option = { id: T; label: string; icon?: Component<{ size?: number }>; swatch?: string }
  let { label, all, options, value, onchange }: {
    label: string
    /** Nome da opção "sem filtro" no menu do celular. */
    all: string
    options: Option[]
    value: T | null
    onchange: (v: T | null) => void
  } = $props()
  const current = $derived(options.find((o) => o.id === value))
</script>

{#snippet mark(o: Option, size = 18)}
  {#if o.icon}<o.icon {size} />{:else if o.swatch}<i class="fg-swatch" style:background={o.swatch}></i>{/if}
{/snippet}

{#if app.wide}
  <div class="filter-group" role="group" aria-label={label}>
    {#each options as o (o.id)}
      <button
        class="icon-btn"
        class:on={value === o.id}
        aria-pressed={value === o.id}
        aria-label={o.label}
        title={o.label}
        onclick={() => onchange(value === o.id ? null : o.id)}
      >
        {@render mark(o)}
      </button>
    {/each}
  </div>
{:else}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger
      class="icon-btn {current ? 'on' : ''}"
      aria-label="{label}: {current?.label ?? all}"
      title="{label}: {current?.label ?? all}"
    >
      {#if current}{@render mark(current)}{:else}<ListFilter size={19} />{/if}
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content class="menu" align="end" sideOffset={6}>
        <div class="menu-heading" aria-hidden="true">{label}</div>
        <DropdownMenu.RadioGroup value={value ?? ''} onValueChange={(v) => onchange((v || null) as T | null)}>
          {#each [{ id: '' as T, label: all } as Option, ...options] as o (o.id)}
            <DropdownMenu.RadioItem value={o.id} class="menu-item">
              {#snippet children({ checked })}
                {@render mark(o, 16)}
                <span class="grow">{o.label}</span>
                <span class="menu-check" class:hidden={!checked}><Check size={15} /></span>
              {/snippet}
            </DropdownMenu.RadioItem>
          {/each}
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
{/if}
