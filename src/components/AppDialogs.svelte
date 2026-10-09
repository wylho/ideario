<script lang="ts">
  import { Dialog } from 'bits-ui'
  import { Check } from '@lucide/svelte'
  import { app } from '../lib/app.svelte'
  import ConfirmDialog from './ConfirmDialog.svelte'
  import { CATEGORY_COLORS, COLOR_NAMES } from '../lib/colors'

  // Diálogos simples do app: dar nome (e cor) a uma categoria ou tag, e confirmar o que não tem volta.

  const d = $derived(app.dialog)
  let name = $state('')
  let color = $state<string | undefined>(undefined)
  $effect(() => {
    if (d?.kind === 'name') {
      name = d.value
      color = d.color
    }
  })

  function submit(e: SubmitEvent) {
    e.preventDefault()
    if (d?.kind !== 'name' || !name.trim()) return
    d.submit(name.trim(), color)
    app.dialog = null
  }
</script>

<Dialog.Root open={d?.kind === 'name'} onOpenChange={(o) => !o && (app.dialog = null)}>
  <Dialog.Portal>
    <Dialog.Overlay class="overlay" />
    <Dialog.Content class="confirm" aria-describedby={undefined}>
      {#if d?.kind === 'name'}
        <form onsubmit={submit} class="name-form">
          <Dialog.Title class="confirm-title">{d.title}</Dialog.Title>
          <label class="field">
            <span>{d.label}</span>
            <!-- svelte-ignore a11y_autofocus -->
            <input bind:value={name} autocomplete="off" spellcheck="false" autofocus maxlength="60" />
          </label>
          {#if color !== undefined}
            <div class="color-pick" role="radiogroup" aria-label="Cor">
              {#each CATEGORY_COLORS as c (c)}
                <button type="button" class="color-dot" role="radio" aria-checked={color === c} aria-label={COLOR_NAMES[c] ?? c} title={COLOR_NAMES[c]} style:background={c} onclick={() => (color = c)}>
                  {#if color === c}<Check size={14} strokeWidth={3} />{/if}
                </button>
              {/each}
            </div>
          {/if}
          <div class="confirm-actions">
            <button type="button" class="btn ghost" onclick={() => (app.dialog = null)}>Cancelar</button>
            <button type="submit" class="btn primary" disabled={!name.trim()}>{d.confirm}</button>
          </div>
        </form>
      {/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

{#if d?.kind === 'confirm'}
  <ConfirmDialog bind:open={() => true, (v) => !v && (app.dialog = null)} title={d.title} text={d.text} confirm={d.confirm} onconfirm={d.onconfirm} />
{/if}

<Dialog.Root open={d?.kind === 'info'} onOpenChange={(o) => !o && (app.dialog = null)}>
  <Dialog.Portal>
    <Dialog.Overlay class="overlay" />
    <Dialog.Content class="confirm" aria-describedby={undefined}>
      {#if d?.kind === 'info'}
        <Dialog.Title class="confirm-title">{d.title}</Dialog.Title>
        <ul class="info-lines">
          {#each d.lines as l (l)}<li>{l}</li>{/each}
        </ul>
        <div class="confirm-actions">
          <button class="btn primary" onclick={() => (app.dialog = null)}>OK</button>
        </div>
      {/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
