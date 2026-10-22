<script lang="ts">
  // O anexo aberto (foto, PDF, vídeo, áudio): o visualizador do Atrio, o mesmo do Nodo. Aqui fica só o que é do
  // Ideario: baixar pelo núcleo e "Abrir nota" quando o anexo veio de outra nota (Arquivos, Moodboard).
  import { AttachmentViewer } from '@wylho/atrio/viewer'
  import { api } from '../lib/api'
  import { download } from '../lib/menus'
  import { app } from '../lib/app.svelte'
</script>

<AttachmentViewer
  att={app.lightbox}
  imageUrl={(h) => api.imageUrl(h, 'full')}
  mediaUrl={(h) => api.mediaUrl(h)}
  onclose={() => (app.lightbox = null)}
  ondownload={(a) => void download(a)}
>
  {#snippet actions()}
    {@const img = app.lightbox}
    {#if img && app.editor?.id !== img.noteId}
      <button class="btn primary" onclick={() => app.openNote(img.noteId)}>Abrir nota</button>
    {/if}
  {/snippet}
</AttachmentViewer>
