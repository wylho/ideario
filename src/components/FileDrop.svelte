<script lang="ts">
  import { FilePlus2, Paperclip } from '@lucide/svelte'
  import { isTauri } from '@tauri-apps/api/core'
  import { app, type DroppedFile } from '../lib/app.svelte'
  import { offerKeepImport } from '../lib/keep.svelte'

  // Arquivos arrastados do computador para a janela: com uma nota aberta, entram nela (no ponto do texto
  // onde caírem, ou no fim se caírem fora do texto); sem nota aberta, viram uma nota nova.
  //
  // No app, quem recebe o arrasto é o Tauri (evento nativo, com o caminho de cada arquivo): o drop do HTML não
  // chega com os arquivos em todos os sistemas. No navegador (prévia e testes), vale o drop do HTML.
  // Arrastar cards e blocos dentro do app não passa por aqui (não traz arquivos).
  let over = $state(false)
  let timer = 0

  // Configurações, visualizador ou diálogo por cima: não é lugar de soltar.
  const blocked = () => app.settingsOpen || !!app.lightbox || !!app.dialog

  function deliver(files: DroppedFile[], at?: { x: number; y: number }) {
    if (!files.length || blocked()) return
    if (app.editor && app.dropIntoEditor) app.dropIntoEditor(files, at)
    else if (app.editor) app.pendingDrop = { files, at }
    else app.openNew(undefined, { files })
  }

  // ---------- app (Tauri) ----------
  $effect(() => {
    if (!isTauri()) return
    let stop: (() => void) | undefined
    let gone = false
    void import('@tauri-apps/api/webview').then(({ getCurrentWebview }) =>
      getCurrentWebview()
        .onDragDropEvent(({ payload: p }) => {
          if (p.type === 'enter') over = p.paths.length > 0 && !blocked()
          else if (p.type === 'leave') over = false
          else if (p.type === 'drop') {
            over = false
            const at = { x: p.position.x / devicePixelRatio, y: p.position.y / devicePixelRatio }
            const files = p.paths.map((path) => ({ path }))
            // Um zip do Google Takeout: oferece importar as notas do Keep em vez de anexar o zip.
            const zip = p.paths.length === 1 && /\.zip$/i.test(p.paths[0]) ? p.paths[0] : null
            if (zip && !blocked()) void offerKeepImport(zip).then((keep) => keep || deliver(files, at))
            else deliver(files, at)
          }
        })
        .then((un) => (gone ? un() : (stop = un))),
    )
    return () => {
      gone = true
      stop?.()
    }
  })

  // ---------- navegador ----------
  const hasFiles = (e: DragEvent) => !isTauri() && !!e.dataTransfer?.types.includes('Files')

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
    deliver([...(e.dataTransfer?.files ?? [])])
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
