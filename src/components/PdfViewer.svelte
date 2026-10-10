<script lang="ts">
  import type { PDFDocumentProxy } from 'pdfjs-dist'
  import { openPdf } from '../lib/pdf'

  // Leitor de PDF próprio (pdf.js), igual nos três sistemas: a WebKitGTK do Linux não mostra PDF num iframe.
  // As páginas nascem como espaço reservado (com a proporção da primeira) e são desenhadas quando chegam perto
  // da tela, na largura do leitor; ao rolar para longe, a imagem é liberada.
  let { src, name }: { src: string; name: string } = $props()

  let host: HTMLDivElement | undefined = $state()
  let doc: PDFDocumentProxy | null = null
  let count = $state(0)
  let ratio = $state(1.414)
  let failed = $state(false)
  let current = $state(1)

  $effect(() => {
    let gone = false
    failed = false
    count = 0
    openPdf(src)
      .then(async (d) => {
        if (gone) return void d.destroy()
        doc = d
        const first = (await d.getPage(1)).getViewport({ scale: 1 })
        ratio = first.height / first.width
        count = d.numPages
      })
      .catch(() => (failed = true))
    return () => {
      gone = true
      void doc?.destroy()
      doc = null
    }
  })

  /** Desenha a página quando ela chega perto da tela e libera quando se afasta. */
  function page(el: HTMLDivElement, n: number) {
    let drawn = false
    let task: { cancel(): void } | null = null
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && !drawn) void draw()
        else if (!e.isIntersecting && drawn) {
          task?.cancel()
          el.querySelector('canvas')?.remove()
          drawn = false
        }
      },
      { root: host, rootMargin: '800px 0px' },
    )
    // Página mais visível = a atual (para o contador).
    const seen = new IntersectionObserver(([e]) => e.isIntersecting && (current = n), { root: host, threshold: 0.5 })
    async function draw() {
      if (!doc) return
      drawn = true
      const p = await doc.getPage(n)
      const base = p.getViewport({ scale: 1 })
      const dpr = Math.min(devicePixelRatio || 1, 2)
      const viewport = p.getViewport({ scale: (el.clientWidth / base.width) * dpr })
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      el.style.aspectRatio = `${base.width} / ${base.height}`
      const ctx = canvas.getContext('2d')
      if (!ctx || !drawn) return
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      const r = p.render({ canvasContext: ctx, viewport })
      task = r
      try {
        await r.promise
        if (drawn) el.replaceChildren(canvas)
      } catch {
        // cancelada ao rolar para longe
      }
    }
    io.observe(el)
    seen.observe(el)
    return () => {
      io.disconnect()
      seen.disconnect()
      task?.cancel()
    }
  }
</script>

<div class="pdf" bind:this={host} role="document" aria-label={name}>
  {#if failed}
    <p class="pdf-msg">Não foi possível abrir este PDF aqui. Baixe para abrir no aplicativo do sistema.</p>
  {:else}
    {#each Array.from({ length: count }, (_, i) => i + 1) as n (n)}
      <div class="pdf-page" style:aspect-ratio="1 / {ratio}" data-page={n} {@attach (el) => page(el, n)}></div>
    {/each}
  {/if}
</div>
{#if count > 1}<span class="pdf-count" aria-live="polite">{current} de {count}</span>{/if}
