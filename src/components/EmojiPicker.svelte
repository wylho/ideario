<script lang="ts">
  import { Popover } from 'bits-ui'
  import { cleanEmoji, loadEmojis, recentEmojis, rememberEmoji, searchEmojis, type EmojiGroup } from '../lib/emoji'

  // Emoji grande de capa da nota. Sem emoji, o seletor abre pelo menu ⋮ ("Emoji de capa"); com emoji, ele fica grande
  // acima do título e um clique nele abre o mesmo seletor.
  let {
    value, onchange, open = $bindable(false),
  }: {
    value: string | null
    onchange: (v: string | null) => void
    open?: boolean
  } = $props()

  let all = $state.raw<EmojiGroup[]>([])
  let q = $state('')
  let recent = $state<string[]>([])
  let search: HTMLInputElement | undefined = $state()

  $effect(() => {
    if (!open) return
    q = ''
    recent = recentEmojis()
    void loadEmojis().then((g) => (all = g))
  })

  const found = $derived(q.trim() ? searchEmojis(all, q) : [])
  /** Emoji digitado ou colado direto na busca (também pelo seletor de emoji do sistema). */
  const typed = $derived(cleanEmoji(q))

  function pick(e: string) {
    rememberEmoji(e)
    onchange(e)
    open = false
  }
  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const first = typed ?? found[0]?.e
    if (first) pick(first)
  }
</script>

<Popover.Root bind:open>
  {#if value}
    <Popover.Trigger class="ed-emoji" aria-label="Mudar o emoji de capa">{value}</Popover.Trigger>
  {:else}
    <!-- Sem emoji, só a âncora do seletor (aberto pelo menu ⋮): não ocupa espaço nem empurra o título. -->
    <Popover.Trigger class="ed-emoji-anchor" tabindex={-1} aria-hidden="true"></Popover.Trigger>
  {/if}
  <Popover.Portal>
    <Popover.Content
      class="pop emoji-pop"
      align="start"
      sideOffset={6}
      onOpenAutoFocus={(e) => {
        e.preventDefault()
        search?.focus()
      }}
    >
      <input bind:this={search} class="emoji-search" type="search" placeholder="Buscar emoji (ex.: bolo, viagem)" aria-label="Buscar emoji" bind:value={q} onkeydown={onKey} />
      <div class="emoji-scroll">
        {#if q.trim()}
          {#if typed || found.length}
            <div class="emoji-grid" role="listbox" aria-label="Resultados">
              {#if typed}<button class="emoji-cell" role="option" aria-selected="false" title="Usar {typed}" aria-label="Usar {typed}" onclick={() => pick(typed)}>{typed}</button>{/if}
              {#each found as it (it.e)}
                <button class="emoji-cell" role="option" aria-selected="false" title={it.label} aria-label={it.label} onclick={() => pick(it.e)}>{it.e}</button>
              {/each}
            </div>
          {:else if all.length}
            <p class="emoji-none">Nenhum emoji para “{q.trim()}”</p>
          {/if}
        {:else}
          {#if recent.length}
            <p class="emoji-group">Recentes</p>
            <div class="emoji-grid">
              {#each recent as e (e)}
                <button class="emoji-cell" title={e} aria-label={e} onclick={() => pick(e)}>{e}</button>
              {/each}
            </div>
          {/if}
          {#each all as g (g.name)}
            <section class="emoji-section">
              <p class="emoji-group">{g.name}</p>
              <div class="emoji-grid">
                {#each g.items as it (it.e)}
                  <button class="emoji-cell" title={it.label} aria-label={it.label} onclick={() => pick(it.e)}>{it.e}</button>
                {/each}
              </div>
            </section>
          {/each}
        {/if}
      </div>
      {#if value}
        <div class="pop-actions">
          <button class="btn ghost" onclick={() => { onchange(null); open = false }}>Remover emoji</button>
        </div>
      {/if}
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>
