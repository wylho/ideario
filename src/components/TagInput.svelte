<script lang="ts">
  import { Hash, Plus } from '@lucide/svelte'
  import { app } from '../lib/app.svelte'
  import { fold, normalizeTag } from '../lib/format'

  // Campo "+ tag" do editor com sugestões das tags que já existem: ninguém precisa lembrar como organizou.
  // Ao focar, as mais usadas; digitando, as que começam (depois as que contêm) com o que foi digitado, sem
  // acento nem maiúsculas. Setas escolhem, Enter/Tab põem; espaço e vírgula põem o que foi digitado.
  let { exclude, onpick }: { exclude: string[]; onpick: (tag: string) => void } = $props()

  const MAX = 8
  let draft = $state('')
  let open = $state(false)
  let active = $state(-1)
  let input: HTMLInputElement | undefined = $state()
  const listId = 'tag-sugestoes'

  const typed = $derived(normalizeTag(draft))
  const suggestions = $derived.by(() => {
    const free = app.tags.filter((t) => !exclude.includes(t.name))
    const q = fold(typed)
    if (!q) return free.slice(0, MAX)
    const starts = free.filter((t) => fold(t.name).startsWith(q))
    const contains = free.filter((t) => !fold(t.name).startsWith(q) && fold(t.name).includes(q))
    return [...starts, ...contains].slice(0, MAX)
  })
  /** O que foi digitado ainda não existe: a última opção cria. */
  const canCreate = $derived(!!typed && !exclude.includes(typed) && !app.tags.some((t) => t.name === typed))
  const options = $derived([...suggestions.map((t) => ({ tag: t.name, count: t.count, isNew: false })), ...(canCreate ? [{ tag: typed, count: 0, isNew: true }] : [])])

  // Digitando, a primeira opção já fica escolhida (Enter põe a tag existente que começa assim).
  $effect(() => {
    void typed
    active = typed && options.length ? 0 : -1
  })

  function pick(tag: string) {
    if (tag && !exclude.includes(tag)) onpick(tag)
    draft = ''
    active = -1
  }

  function commitTyped() {
    if (typed) pick(typed)
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!options.length) return
      e.preventDefault()
      open = true
      const d = e.key === 'ArrowDown' ? 1 : -1
      active = (active + d + options.length) % options.length
    } else if (e.key === 'Enter' || (e.key === 'Tab' && active >= 0 && open)) {
      e.preventDefault()
      if (open && active >= 0 && options[active]) pick(options[active].tag)
      else commitTyped()
    } else if (e.key === ' ' || e.key === ',') {
      e.preventDefault()
      commitTyped()
    } else if (e.key === 'Escape' && open) {
      // fecha a lista, não o editor
      e.preventDefault()
      e.stopPropagation()
      open = false
    } else if (e.key === 'Backspace' && !draft) {
      open = false
    } else {
      open = true
    }
  }
</script>

<span class="tag-field">
  <input
    bind:this={input}
    id="nova-tag"
    class="tag-input"
    placeholder="+ tag"
    autocomplete="off"
    role="combobox"
    aria-label="Nova tag"
    aria-autocomplete="list"
    aria-expanded={open && options.length > 0}
    aria-controls={listId}
    aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
    bind:value={draft}
    {onkeydown}
    onfocus={() => (open = true)}
    oninput={() => (open = true)}
    onblur={() => {
      open = false
      commitTyped()
    }}
  />
  {#if open && options.length}
    <div class="menu tag-suggest" id={listId} role="listbox" aria-label="Tags que já existem">
      {#if !typed}<div class="tag-suggest-head">Tags usadas</div>{/if}
      {#each options as o, i (o.tag + o.isNew)}
        <div
          id="{listId}-{i}"
          class="menu-item"
          role="option"
          tabindex="-1"
          aria-selected={i === active}
          data-highlighted={i === active ? '' : undefined}
          onmousedown={(e) => e.preventDefault()}
          onmouseenter={() => (active = i)}
          onclick={() => {
            pick(o.tag)
            input?.focus()
          }}
          onkeydown={() => {}}
        >
          {#if o.isNew}<Plus size={16} /><span class="grow">Criar <b>#{o.tag}</b></span>
          {:else}<Hash size={16} /><span class="grow">{o.tag}</span><span class="count">{o.count}</span>{/if}
        </div>
      {/each}
    </div>
  {/if}
</span>
