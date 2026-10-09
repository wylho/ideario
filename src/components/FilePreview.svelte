<script lang="ts">
  import type { Snippet } from 'svelte'
  import { thumbUrl } from '../lib/previews.svelte'
  import type { AttachmentKind } from '../lib/types'

  // Prévia de PDF (primeira página) ou de vídeo (um quadro) por cima do ícone do tipo. Sem prévia (ainda, ou
  // impossível), fica o ícone. Fotos não passam por aqui: já têm miniatura própria.
  let { hash, kind, children }: { hash: string; kind: AttachmentKind; children: Snippet } = $props()
  const url = $derived(kind === 'pdf' || kind === 'video' ? thumbUrl(hash) : '')
  let failed = $state('')
</script>

{@render children()}
{#if url && failed !== url}
  <img class="file-preview" class:video={kind === 'video'} src={url} alt="" decoding="async" onerror={() => (failed = url)} />
{/if}
