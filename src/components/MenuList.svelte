<script lang="ts">
  import { ContextMenu } from 'bits-ui'
  import { ArrowLeft, Check, ChevronRight } from '@lucide/svelte'
  import type { MenuEntry } from '../lib/menu'

  // Itens de um menu de contexto (ContextMenu e MenuAt). Submenu: ao lado na tela larga; na estreita (celular) não
  // cabe ao lado, então ele toma o lugar do menu, com uma linha para voltar (como nos menus do Android).
  let { entries }: { entries: MenuEntry[] } = $props()

  const narrow = matchMedia('(max-width: 639px)').matches
  let stack = $state.raw<{ label: string; items: MenuEntry[] }[]>([])
  const shown = $derived(stack.at(-1)?.items ?? entries)
</script>

{#snippet list(items: MenuEntry[])}
  {#each items as e, i (i)}
    {#if 'separator' in e}
      <ContextMenu.Separator class="menu-sep" />
    {:else if 'sub' in e && narrow}
      <ContextMenu.Item class="menu-item" onSelect={(ev) => { ev.preventDefault(); stack = [...stack, { label: e.label, items: e.sub }] }}>
        {#if e.swatch}<i class="menu-swatch" style:background={e.swatch}></i>{:else if e.icon}<e.icon size={16} />{/if}<span class="grow">{e.label}</span><span class="menu-chev"><ChevronRight size={15} /></span>
      </ContextMenu.Item>
    {:else if 'sub' in e}
      <ContextMenu.Sub>
        <ContextMenu.SubTrigger class="menu-item">
          {#if e.swatch}<i class="menu-swatch" style:background={e.swatch}></i>{:else if e.icon}<e.icon size={16} />{/if}<span class="grow">{e.label}</span><span class="menu-chev"><ChevronRight size={15} /></span>
        </ContextMenu.SubTrigger>
        <ContextMenu.SubContent class="menu ctx" sideOffset={2}>{@render list(e.sub)}</ContextMenu.SubContent>
      </ContextMenu.Sub>
    {:else}
      <ContextMenu.Item class="menu-item{e.danger ? ' danger' : ''}" disabled={e.disabled} onSelect={e.onSelect}>
        {#if e.swatch}<i class="menu-swatch" style:background={e.swatch}></i>{:else if e.icon}<e.icon size={16} />{/if}
        <span class="grow">{e.label}</span>
        {#if e.hint}<small class="menu-hint">{e.hint}</small>{/if}
        {#if e.checked}<span class="menu-check"><Check size={15} /></span>{/if}
      </ContextMenu.Item>
    {/if}
  {/each}
{/snippet}

{#if stack.length}
  <ContextMenu.Item class="menu-item menu-back" onSelect={(ev) => { ev.preventDefault(); stack = stack.slice(0, -1) }}>
    <ArrowLeft size={16} /><span class="grow">{stack.at(-1)?.label}</span>
  </ContextMenu.Item>
  <ContextMenu.Separator class="menu-sep" />
{/if}
{@render list(shown)}
