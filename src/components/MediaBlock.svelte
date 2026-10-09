<script lang="ts">
  import { Download } from '@lucide/svelte'
  import { api } from '../lib/api'
  import { fmtBytes } from '../lib/format'
  import { KIND_ICONS, KIND_LABELS } from '../lib/file-kinds'
  import AudioPlayer from './AudioPlayer.svelte'
  import type { Attachment } from '../lib/types'

  // Anexo no meio do texto: vídeo com player, áudio com player compacto, documentos como cartão.
  let { a }: { a: Attachment } = $props()
  const src = $derived(api.mediaUrl(a.hash))
  const Icon = $derived(KIND_ICONS[a.kind])
</script>

{#if a.kind === 'video'}
  <figure class="nf-video">
    {#if src}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video {src} controls preload="metadata" playsinline></video>
    {:else}
      <div class="nf-video-empty"><Icon size={28} /><span>Vídeo de exemplo, sem conteúdo nesta prévia</span></div>
    {/if}
    <figcaption><span class="nf-name">{a.name}</span><small>{fmtBytes(a.bytes)}</small></figcaption>
  </figure>
{:else}
  <div class="nf-card">
    <span class="f-ico t-{a.kind}"><Icon size={20} /></span>
    <div class="nf-text">
      <span class="nf-name">{a.name}</span>
      {#if a.kind === 'audio'}
        <AudioPlayer {src} label={a.name} />
      {:else}
        <small>{KIND_LABELS[a.kind]} · {fmtBytes(a.bytes)}</small>
      {/if}
    </div>
    <button class="icon-btn sm" aria-label="Baixar {a.name}" title="Baixar" onclick={() => void api.downloadAttachment(a)}><Download size={16} /></button>
  </div>
{/if}
