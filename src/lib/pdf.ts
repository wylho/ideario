// pdf.js embutido (sem rede): carregado só quando um PDF aparece. Serve às prévias dos cards e ao leitor.
import type { PDFDocumentProxy } from 'pdfjs-dist'

export async function openPdf(url: string): Promise<PDFDocumentProxy> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const worker = (await import('pdfjs-dist/legacy/build/pdf.worker.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = worker
  const data = new Uint8Array(await (await fetch(url)).arrayBuffer())
  return pdfjs.getDocument({ data, isEvalSupported: false }).promise
}
