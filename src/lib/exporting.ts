import { isTauri } from '@tauri-apps/api/core'
import { FileCode2, FileText, Printer } from '@lucide/svelte'
import { api } from './api'
import { app } from './app.svelte'
import type { Component } from 'svelte'

/** Item de exportar (serve de item de menu no card e no editor). */
export interface ExportItem {
  label: string
  icon: Component<{ size?: number }>
  onSelect: () => void
}

// Exportar uma nota (Markdown, HTML) e imprimir / salvar como PDF. Com anexos, Markdown e HTML saem num .zip com a
// pasta anexos/ (no HTML áudio e vídeo tocam); no PDF, áudio e vídeo viram um cartão com o nome.

const safe = (s: string) => s.replace(/[/\\:*?"<>|\n\r\t]/g, '_').trim().slice(0, 80) || 'Nota'

export async function exportNote(id: string, title: string, format: 'md' | 'html', hasAttachments: boolean) {
  if (!isTauri()) return
  const { save } = await import('@tauri-apps/plugin-dialog')
  const ext = hasAttachments ? 'zip' : format
  const label = format === 'md' ? 'Markdown' : 'HTML'
  const path = await save({
    title: `Exportar em ${label}`,
    defaultPath: `${safe(title)}.${ext}`,
    filters: [{ name: hasAttachments ? `${label} com os anexos (.zip)` : label, extensions: [ext] }],
  })
  if (!path) return
  try {
    const r = await api.exportNote(id, format, path)
    const missing = r.missing ? ` (${r.missing} anexo${r.missing > 1 ? 's' : ''} só no Drive ficou de fora)` : ''
    app.say(`Exportada em ${label}${missing}`)
  } catch (e) {
    app.say(`Não foi possível exportar: ${e instanceof Error ? e.message : e}`)
  }
}

/** Imprime só a nota aberta (a classe esconde o resto do app); "Salvar como PDF" fica na janela do sistema. */
export async function printNote() {
  const body = document.body
  body.classList.add('print-note')
  const done = () => body.classList.remove('print-note')
  addEventListener('afterprint', done, { once: true })
  // a impressão do app nativo pode voltar antes de a janela do sistema fechar: tira a classe no próximo toque também
  setTimeout(() => {
    addEventListener('pointerdown', done, { once: true })
    addEventListener('keydown', done, { once: true })
  }, 500)
  try {
    await api.printWindow()
  } catch (e) {
    done()
    app.say(`Não foi possível imprimir: ${e instanceof Error ? e.message : e}`)
  }
}

/** Itens do submenu "Exportar" (card e editor). `print` abre a impressão; no card, abre a nota antes. */
export function exportEntries(id: string, title: string, hasAttachments: boolean, print: () => void): ExportItem[] {
  const files: ExportItem[] = isTauri()
    ? [
        { label: hasAttachments ? 'Markdown (.zip com anexos)' : 'Markdown (.md)', icon: FileText, onSelect: () => void exportNote(id, title, 'md', hasAttachments) },
        { label: hasAttachments ? 'HTML (.zip com anexos)' : 'HTML (.html)', icon: FileCode2, onSelect: () => void exportNote(id, title, 'html', hasAttachments) },
      ]
    : []
  return [...files, { label: 'PDF (imprimir)', icon: Printer, onSelect: print }]
}
