<script lang="ts">
  import { Dialog } from 'bits-ui'
  import { Download, X } from '@lucide/svelte'
  import { api } from '../lib/api'
  import { download } from '../lib/menus'
  import { app } from '../lib/app.svelte'
  import { fmtBytes } from '../lib/format'
  import { KIND_ICONS, KIND_LABELS } from '../lib/file-kinds'
  import AudioPlayer from './AudioPlayer.svelte'

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
        {#if img.kind === 'image'}
          <img class="lb-img" src={api.imageUrl(img.hash, 'full')} alt="" />
        {:else if img.kind === 'pdf' && api.mediaUrl(img.hash)}
          <iframe class="lb-img lb-doc" src={api.mediaUrl(img.hash)} title={img.name}></iframe>
        {:else if img.kind === 'video' && api.mediaUrl(img.hash)}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video class="lb-img" src={api.mediaUrl(img.hash)} controls autoplay playsinline></video>
        {:else}
          {@const Icon = KIND_ICONS[img.kind]}
          <div class="lb-media">
            <span class="lb-media-ico"><Icon size={40} /></span>
            {#if img.kind === 'audio'}<div class="lb-audio"><AudioPlayer src={api.mediaUrl(img.hash)} label={img.name} /></div>{/if}
            {#if img.kind === 'video'}<p>Vídeo de exemplo, sem conteúdo nesta prévia</p>{/if}
            {#if img.kind !== 'audio' && img.kind !== 'video'}
              <p>{api.mediaUrl(img.hash) ? 'Sem visualização para este tipo: baixe para abrir no aplicativo do sistema.' : 'Arquivo de exemplo, sem conteúdo nesta prévia.'}</p>
            {/if}
          </div>
        {/if}
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
            {#if img.kind !== 'image'}
              <b>{KIND_LABELS[img.kind]} · {fmtBytes(img.bytes)}</b>
            {:else if img.origBytes}
              <span>Original {fmtBytes(img.origBytes)}</span>
              <span class="arrow">→</span>
              <b>WebP {fmtBytes(img.bytes)}</b>
              <span class="good">−{Math.round((1 - img.bytes / img.origBytes) * 100)}%</span>
            {:else}
              <b>WebP {fmtBytes(img.bytes)}</b>
            {/if}
          </p>
          <div class="lb-actions">
            <button class="btn ghost" onclick={() => void download(img)}><Download size={16} />Baixar</button>
            {#if app.editor?.id !== img.noteId}
              <button class="btn primary" onclick={() => app.openNote(img.noteId)}>Abrir nota</button>
            {/if}
          </div>
        </div>
      {/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
