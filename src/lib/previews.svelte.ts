import { isTauri } from '@tauri-apps/api/core'
import { api } from './api'
import { openPdf } from './pdf'
import type { AttachmentKind } from './types'

// Prévias de PDF (primeira página, pelo pdf.js embutido) e de vídeo (um quadro do começo), feitas aqui na interface,
// que já sabe desenhar os dois, e guardadas pelo núcleo como miniatura WebP (ao lado das fotos).
// Roda em segundo plano, uma de cada vez, ao abrir o app e depois de cada anexo novo.

/** Sobe quando chega uma prévia nova: as miniaturas de PDF e vídeo pedem a imagem de novo. */
export const previews = $state({ rev: 0 })

/** URL da miniatura que acompanha as prévias novas (fotos não precisam: já nascem com miniatura). */
export const thumbUrl = (hash: string) => {
  const url = api.imageUrl(hash, 'thumb')
  return url && previews.rev ? `${url}&r=${previews.rev}` : url
}

/** Lado maior da imagem enviada ao núcleo (ele reduz para 400 px). */
const SIDE = 800

let running: Promise<void> | null = null
let again = false

export function makePreviews() {
  if (!isTauri()) return
  if (running) {
    again = true
    return
  }
  running = (async () => {
    do {
      again = false
      for (const { hash, kind } of await api.pendingPreviews().catch(() => [])) {
        const png = await render(api.mediaUrl(hash), kind).catch((e) => (console.warn('prévia', hash, e), null))
        await api.setPreview(hash, png ?? new Uint8Array()).catch(() => {})
        if (png) previews.rev++
      }
    } while (again)
  })().finally(() => (running = null))
}

function render(url: string, kind: AttachmentKind) {
  return kind === 'pdf' ? pdfPage(url) : videoFrame(url)
}

async function pdfPage(url: string): Promise<Uint8Array | null> {
  const doc = await openPdf(url)
  try {
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: SIDE / Math.max(base.width, base.height) })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    const ctx = canvas.getContext('2d')!
    // fundo branco: página sem fundo ficaria transparente
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport }).promise
    return toPng(canvas)
  } finally {
    void doc.destroy()
  }
}

/** Um quadro perto do começo (não o primeiro, que costuma ser preto). */
function videoFrame(url: string): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const v = document.createElement('video')
    v.muted = true
    v.preload = 'auto'
    const done = (r: Uint8Array | null) => {
      clearTimeout(timer)
      v.removeAttribute('src')
      v.load()
      resolve(r)
    }
    const timer = setTimeout(() => done(null), 15000)
    v.onerror = () => done(null)
    v.onloadedmetadata = () => (v.currentTime = Math.min(1, (v.duration || 0) / 3))
    v.onseeked = async () => {
      const scale = SIDE / Math.max(v.videoWidth, v.videoHeight, 1)
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(v.videoWidth * scale))
      canvas.height = Math.max(1, Math.round(v.videoHeight * scale))
      canvas.getContext('2d')!.drawImage(v, 0, 0, canvas.width, canvas.height)
      done(await toPng(canvas))
    }
    v.src = url
  })
}

async function toPng(canvas: HTMLCanvasElement): Promise<Uint8Array | null> {
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null
}
