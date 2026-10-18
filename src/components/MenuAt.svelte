<script lang="ts">
  import { ContextMenu } from 'bits-ui'
  import type { MenuEntry } from '../lib/menu'
  import MenuList from './MenuList.svelte'

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

<ContextMenu.Root bind:open>
  <ContextMenu.Trigger>
    {#snippet child({ props })}
      <span {...props} bind:this={anchor} class="menu-anchor" aria-hidden="true"></span>
    {/snippet}
  </ContextMenu.Trigger>
  <ContextMenu.Portal>
    <ContextMenu.Content class="menu ctx">
      {#if open}<MenuList entries={entries} />{/if}
    </ContextMenu.Content>
  </ContextMenu.Portal>
</ContextMenu.Root>
