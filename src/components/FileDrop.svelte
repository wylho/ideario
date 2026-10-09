<script lang="ts">
  import { FilePlus2, Paperclip } from '@lucide/svelte'
  import { app } from '../lib/app.svelte'

  // Arquivos arrastados do computador para a janela: com uma nota aberta, entram nela (no ponto do texto
  // onde caírem, ou no fim se caírem fora do texto); sem nota aberta, viram uma nota nova.
  // Arrastar cards e blocos dentro do app não passa por aqui (não traz "Files").
  let over = $state(false)
  let timer = 0

  const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')
  // Configurações, visualizador ou diálogo por cima: não é lugar de soltar.
  const blocked = () => app.settingsOpen || !!app.lightbox || !!app.dialog

  function dragover(e: DragEvent) {
    if (!hasFiles(e)) return
    // Sem isso a janela abriria o arquivo no lugar do app.
    e.preventDefault()
    if (blocked()) {
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'
      return
    }
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    over = true
    // dragleave dispara a cada elemento cruzado; o dragover se repete enquanto o arquivo está sobre a janela.
    clearTimeout(timer)
    timer = window.setTimeout(() => (over = false), 150)
  }

  function drop(e: DragEvent) {
    if (!hasFiles(e)) return
    clearTimeout(timer)
    over = false
    // O texto da nota já tratou (soltou no ponto exato).
    if (e.defaultPrevented) return
    e.preventDefault()
    const files = [...(e.dataTransfer?.files ?? [])]
    if (!files.length || blocked()) return
    if (app.editor) app.dropIntoEditor?.(files)
    else app.openNew(undefined, { files })
  }
</script>

<svelte:window ondragover={dragover} ondrop={drop} />

{#if over}
  <div class="file-drop" class:into-note={!!app.editor} aria-hidden="true">
    <div class="file-drop-hint">
      {#if app.editor}<Paperclip size={18} />Solte para anexar à nota{:else}<FilePlus2 size={18} />Solte para criar uma nota{/if}
    </div>
  </div>
{/if}
