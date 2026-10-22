import { isTauri } from '@tauri-apps/api/core'
import { FileCode2, FileText, Printer } from '@lucide/svelte'
import { api } from './api'
import { app } from './app.svelte'
import type { Component } from 'svelte'
import { t, tn } from '@wylho/atrio'

/** Item de exportar (serve de item de menu no card e no editor). */
export interface ExportItem {
  label: string
  icon: Component<{ size?: number }>
  onSelect: () => void
}

// Exportar uma nota (Markdown, HTML) e imprimir / salvar como PDF. Com anexos, Markdown e HTML saem num .zip com a
// pasta anexos/ (no HTML áudio e vídeo tocam); no PDF, áudio e vídeo viram um cartão com o nome.

const safe = (s: string) => s.replace(/[/\\:*?"<>|\n\r\t]/g, '_').trim().slice(0, 80) || t('Nota')

export async function exportNote(id: string, title: string, format: 'md' | 'html', hasAttachments: boolean) {
  if (!isTauri()) return
  const ext = hasAttachments ? 'zip' : format
  const label = format === 'md' ? 'Markdown' : 'HTML'
  // Android: sem "salvar em" com caminho; o arquivo vai pelo "Compartilhar" do sistema (Arquivos, Drive, e-mail…).
  if (document.documentElement.dataset.platform === 'android') {
    try {
      await api.exportShare(id, format, `${safe(title)}.${ext}`)
    } catch (e) {
      app.say(t('Não foi possível exportar: {erro}', { erro: e instanceof Error ? e.message : String(e) }))
    }
    return
  }
  const { save } = await import('@tauri-apps/plugin-dialog')
  const path = await save({
    title: t('Exportar em {formato}', { formato: label }),
    defaultPath: `${safe(title)}.${ext}`,
    filters: [{ name: hasAttachments ? t('{formato} com os anexos (.zip)', { formato: label }) : label, extensions: [ext] }],
  })
  if (!path) return
  try {
    const r = await api.exportNote(id, format, path)
    app.say(
      r.missing
        ? tn(r.missing, 'Exportada em {formato} ({n} anexo só no Drive ficou de fora)', 'Exportada em {formato} ({n} anexos só no Drive ficaram de fora)', { formato: label })
        : t('Exportada em {formato}', { formato: label }),
    )
  } catch (e) {
    app.say(t('Não foi possível exportar: {erro}', { erro: e instanceof Error ? e.message : String(e) }))
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
    await api.printWindow(document.querySelector<HTMLTextAreaElement>('#titulo')?.value || undefined)
  } catch (e) {
    done()
    app.say(t('Não foi possível imprimir: {erro}', { erro: e instanceof Error ? e.message : String(e) }))
  }
}

/** Itens do submenu "Exportar" (card e editor). `print` abre a impressão; no card, abre a nota antes. */
export function exportEntries(id: string, title: string, hasAttachments: boolean, print: () => void): ExportItem[] {
  const files: ExportItem[] = isTauri()
    ? [
        { label: hasAttachments ? t('Markdown (.zip com anexos)') : 'Markdown (.md)', icon: FileText, onSelect: () => void exportNote(id, title, 'md', hasAttachments) },
        { label: hasAttachments ? t('HTML (.zip com anexos)') : 'HTML (.html)', icon: FileCode2, onSelect: () => void exportNote(id, title, 'html', hasAttachments) },
      ]
    : []
  return [...files, { label: t('PDF (imprimir)'), icon: Printer, onSelect: print }]
}
