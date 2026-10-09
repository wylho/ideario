<script lang="ts">
  import { ContextMenu } from 'bits-ui'
  import { Check, ChevronRight } from '@lucide/svelte'
  import type { MenuEntry } from '../lib/menu'

  // Menu de contexto aberto por código, num ponto da tela (alça de bloco, clique direito numa foto…).
  // Mesmo visual e mesmo formato de itens dos outros menus de contexto (MenuEntry).
  let entries = $state.raw<MenuEntry[]>([])
  let anchor: HTMLElement | undefined = $state()
  let open = $state(false)

  export function openAt(x: number, y: number, items: MenuEntry[]) {
    entries = items
    anchor?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }))
  }
</script>

{#snippet list(items: MenuEntry[])}
  {#each items as e, i (i)}
    {#if 'separator' in e}
      <ContextMenu.Separator class="menu-sep" />
    {:else if 'sub' in e}
      <ContextMenu.Sub>
        <ContextMenu.SubTrigger class="menu-item">
          {#if e.icon}<e.icon size={16} />{/if}<span class="grow">{e.label}</span><span class="menu-chev"><ChevronRight size={15} /></span>
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

<ContextMenu.Root bind:open>
  <ContextMenu.Trigger>
    {#snippet child({ props })}
      <span {...props} bind:this={anchor} class="menu-anchor" aria-hidden="true"></span>
    {/snippet}
  </ContextMenu.Trigger>
  <ContextMenu.Portal>
    <ContextMenu.Content class="menu ctx">
      {#if open}{@render list(entries)}{/if}
    </ContextMenu.Content>
  </ContextMenu.Portal>
</ContextMenu.Root>
