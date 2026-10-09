<script lang="ts">
  import { Dialog } from 'bits-ui'
  import { Download, X } from '@lucide/svelte'
  import { api } from '../lib/api'
  import { app } from '../lib/app.svelte'
  import { fmtBytes } from '../lib/format'

  const img = $derived(app.lightbox)

  async function copy(hex: string) {
    try {
      await navigator.clipboard.writeText(hex)
      app.say(`${hex} copiado`)
    } catch {
      app.say(hex)
    }
  }
</script>

<Dialog.Root open={!!img} onOpenChange={(o) => !o && (app.lightbox = null)}>
  <Dialog.Portal>
    <Dialog.Overlay class="overlay dark" />
    <Dialog.Content class="lightbox" aria-describedby={undefined}>
      {#if img}
        <div class="lb-top">
          <Dialog.Close class="icon-btn on-dark" aria-label="Fechar"><X size={20} /></Dialog.Close>
          <Dialog.Title class="lb-title">{img.name}</Dialog.Title>
        </div>
        <img class="lb-img" src={api.imageUrl(img.hash, 'full')} alt="" />
        <div class="lb-sheet">
          {#if img.palette}
            <div class="lb-pal">
              {#each img.palette as p (p)}
                <button onclick={() => copy(p)} aria-label="Copiar {p}">
                  <i style:background={p}></i>
                  <code>{p}</code>
                </button>
              {/each}
            </div>
          {/if}
          <p class="lb-opt">
            {#if img.origBytes}
              <span>Original {fmtBytes(img.origBytes)}</span>
              <span class="arrow">→</span>
              <b>WebP {fmtBytes(img.bytes)}</b>
              <span class="good">−{Math.round((1 - img.bytes / img.origBytes) * 100)}%</span>
            {:else}
              <b>WebP {fmtBytes(img.bytes)}</b>
            {/if}
          </p>
          <div class="lb-actions">
            <button class="btn ghost" onclick={() => app.say('Original mantido no Drive')}><Download size={16} />Original</button>
            <button class="btn primary" onclick={() => app.openNote(img.noteId)}>Abrir nota</button>
          </div>
        </div>
      {/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
