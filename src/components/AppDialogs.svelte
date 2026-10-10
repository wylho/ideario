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

  // PIN: só números, de 4 a 8.
  let pins = $state<string[]>([])
  let pinError = $state<string | null>(null)
  let pinBusy = $state(false)
  $effect(() => {
    if (d?.kind === 'pin') {
      pins = d.fields.map(() => '')
      pinError = null
    }
  })
  const pinsOk = $derived(pins.length > 0 && pins.every((p) => /^\d{4,8}$/.test(p)))
  async function submitPin(e: SubmitEvent) {
    e.preventDefault()
    if (d?.kind !== 'pin' || !pinsOk || pinBusy) return
    pinBusy = true
    try {
      const err = await d.submit(pins)
      if (err) {
        pinError = err
        pins = pins.map(() => '')
      } else app.dialog = null
    } catch (x) {
      pinError = x instanceof Error ? x.message : String(x)
    } finally {
      pinBusy = false
    }
  }

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

<Dialog.Root open={d?.kind === 'pin'} onOpenChange={(o) => !o && (app.dialog = null)}>
  <Dialog.Portal>
    <Dialog.Overlay class="overlay" />
    <Dialog.Content class="confirm" aria-describedby={undefined}>
      {#if d?.kind === 'pin'}
        <form onsubmit={submitPin} class="name-form">
          <Dialog.Title class="confirm-title">{d.title}</Dialog.Title>
          {#if d.text}<p class="confirm-text">{d.text}</p>{/if}
          {#each d.fields as label, i (label)}
            <label class="field">
              <span>{label}</span>
              <!-- svelte-ignore a11y_autofocus -->
              <input
                class="pin-input"
                type="password"
                inputmode="numeric"
                autocomplete="off"
                maxlength="8"
                autofocus={i === 0}
                value={pins[i] ?? ''}
                oninput={(e) => {
                  const v = e.currentTarget.value.replace(/\D/g, '').slice(0, 8)
                  e.currentTarget.value = v
                  pins[i] = v
                  pinError = null
                }}
              />
            </label>
          {/each}
          <small class="pin-hint" class:bad={!!pinError} role={pinError ? 'alert' : undefined}>{pinError ?? 'De 4 a 8 números.'}</small>
          <div class="confirm-actions">
            <button type="button" class="btn ghost" onclick={() => (app.dialog = null)}>Cancelar</button>
            <button type="submit" class="btn primary" disabled={!pinsOk || pinBusy}>{d.confirm}</button>
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
