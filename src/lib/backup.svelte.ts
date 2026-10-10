import { isTauri } from '@tauri-apps/api/core'
import { api } from './api'
import { app } from './app.svelte'
import { fmtBytes } from './format'

// Backup local (Configurações → Backup local): um arquivo .ideario com tudo; restaurar junta com o que está aqui.

const plural = (n: number, um: string, varios: string) => `${n.toLocaleString('pt-BR')} ${n === 1 ? um : varios}`
const today = () => new Date().toISOString().slice(0, 10)

/** Escolhe onde salvar e faz o backup agora. */
export async function backupNow() {
  if (!isTauri()) return
  const { save } = await import('@tauri-apps/plugin-dialog')
  const status = await api.backupStatus()
  const name = `Ideario backup ${today()}.ideario`
  const path = await save({
    title: 'Salvar o backup',
    defaultPath: status.dir ? `${status.dir}/${name}` : name,
    filters: [{ name: 'Backup do Ideario', extensions: ['ideario'] }],
  })
  if (!path) return
  app.task = { label: 'Fazendo o backup', done: 0, total: 0 }
  try {
    const r = await api.backupExport(path, (done, total) => (app.task = { label: 'Fazendo o backup', done, total }))
    const lines = [plural(r.notes, 'nota', 'notas') + ' e ' + plural(r.attachments, 'anexo', 'anexos') + ` (${fmtBytes(r.bytes)})`, `Salvo em ${r.path}`]
    if (r.skippedAttachments) lines.push(`${plural(r.skippedAttachments, 'anexo está', 'anexos estão')} só no Google Drive (não baixados aqui) e ficaram de fora`)
    app.info({ title: 'Backup feito', lines })
  } catch (e) {
    app.info({ title: 'Não foi possível fazer o backup', lines: [String(e)] })
  } finally {
    app.task = null
  }
}

/** Escolhe um backup, mostra o que tem e, confirmado, junta com o que está no app. */
export async function restoreBackup() {
  if (!isTauri()) return
  const { open } = await import('@tauri-apps/plugin-dialog')
  const path = await open({ title: 'Escolha o backup', filters: [{ name: 'Backup do Ideario', extensions: ['ideario'] }] })
  if (typeof path !== 'string') return
  let m
  try {
    m = await api.backupInspect(path)
  } catch (e) {
    app.info({ title: 'Não foi possível abrir o backup', lines: [String(e)] })
    return
  }
  const when = new Date(m.createdAt).toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' })
  app.confirm({
    title: 'Restaurar este backup?',
    text: `Feito em ${when}, com ${plural(m.notes, 'nota', 'notas')} e ${plural(m.attachments, 'anexo', 'anexos')}. Ele se junta com o que está aqui: nada é apagado, e o que você escreveu depois do backup continua.`,
    confirm: 'Restaurar',
    onconfirm: () => void runRestore(path),
  })
}

async function runRestore(path: string) {
  app.task = { label: 'Restaurando o backup', done: 0, total: 0 }
  try {
    const r = await api.backupRestore(path, (done, total) => (app.task = { label: 'Restaurando o backup', done, total }))
    const lines: string[] = []
    if (r.newNotes) lines.push(`${plural(r.newNotes, 'nota voltou', 'notas voltaram')}`)
    if (r.mergedNotes) lines.push(`${plural(r.mergedNotes, 'nota que já estava aqui foi juntada', 'notas que já estavam aqui foram juntadas')} com a do backup`)
    if (r.categories) lines.push(`${plural(r.categories, 'categoria voltou', 'categorias voltaram')}`)
    if (r.attachments) lines.push(`${plural(r.attachments, 'anexo voltou', 'anexos voltaram')}`)
    app.info({ title: 'Backup restaurado', lines: lines.length ? lines : ['Tudo do backup já estava aqui.'] })
  } catch (e) {
    app.info({ title: 'Não foi possível restaurar', lines: [String(e)] })
  } finally {
    app.task = null
  }
}

/** Escolhe a pasta dos backups automáticos. Devolve a pasta (ou null se cancelou). */
export async function pickBackupDir(): Promise<string | null> {
  if (!isTauri()) return null
  const { open } = await import('@tauri-apps/plugin-dialog')
  const dir = await open({ title: 'Pasta dos backups automáticos', directory: true })
  return typeof dir === 'string' ? dir : null
}
