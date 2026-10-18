<script lang="ts">
  import { ContextMenu } from 'bits-ui'
  import type { Snippet } from 'svelte'
  import type { MenuEntry } from '../lib/menu'
  import MenuList from './MenuList.svelte'

  // Menu de contexto: clique direito, tecla de menu/Shift+F10 e toque longo no celular.
  // `children` recebe as props do gatilho e as espalha no próprio elemento (card, linha, chip…).
  let { items, children }: { items: () => MenuEntry[]; children: Snippet<[Record<string, unknown>]> } = $props()

  let open = $state(false)
  let openedAt = -Infinity
  let lastPointer = ''
  // Só o toque longo precisa de proteção: com mouse (clique direito) não sobra clique para engolir.
  $effect(() => {
    if (open) openedAt = lastPointer === 'touch' ? performance.now() : -Infinity
  })

  // O toque longo termina num "click": não pode abrir a nota que está por baixo do menu.
  function guardClick(e: MouseEvent) {
    if (performance.now() - openedAt < 700) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  // Pelo teclado o evento chega sem posição: abre o menu ancorado no próprio elemento.
  function keyboardAnchor(e: MouseEvent) {
    if (!e.isTrusted || e.clientX !== 0 || e.clientY !== 0) return
    e.preventDefault()
    e.stopImmediatePropagation()
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    e.currentTarget!.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 16, clientY: r.top + Math.min(r.height, 40) }),
    )
  }
</script>

<ContextMenu.Root bind:open>
  <ContextMenu.Trigger>
    {#snippet child({ props })}
      {@render children({
        ...props,
        tabindex: undefined,
        onclickcapture: guardClick,
        oncontextmenucapture: keyboardAnchor,
        onpointerdowncapture: (e: PointerEvent) => (lastPointer = e.pointerType),
      })}
    {/snippet}
  </ContextMenu.Trigger>
  <ContextMenu.Portal>
    <ContextMenu.Content class="menu ctx">
      {#if open}<MenuList entries={items()} />{/if}
    </ContextMenu.Content>
  </ContextMenu.Portal>
</ContextMenu.Root>
