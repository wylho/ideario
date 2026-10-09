<script lang="ts">
  import { ContextMenu } from 'bits-ui'
  import { Check, ChevronRight } from '@lucide/svelte'
  import type { Snippet } from 'svelte'
  import type { MenuEntry } from '../lib/menu'

  // Menu de contexto: clique direito, tecla de menu/Shift+F10 e toque longo no celular.
  // `children` recebe as props do gatilho e as espalha no próprio elemento (card, linha, chip…).
  let { items, children }: { items: () => MenuEntry[]; children: Snippet<[Record<string, unknown>]> } = $props()

  let open = $state(false)
  let openedAt = -Infinity
  $effect(() => {
    if (open) openedAt = performance.now()
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

{#snippet list(entries: MenuEntry[])}
  {#each entries as e, i (i)}
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
      {@render children({ ...props, tabindex: undefined, onclickcapture: guardClick, oncontextmenucapture: keyboardAnchor })}
    {/snippet}
  </ContextMenu.Trigger>
  <ContextMenu.Portal>
    <ContextMenu.Content class="menu ctx">
      {#if open}{@render list(items())}{/if}
    </ContextMenu.Content>
  </ContextMenu.Portal>
</ContextMenu.Root>
