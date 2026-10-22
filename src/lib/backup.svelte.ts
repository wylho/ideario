import { isTauri } from '@tauri-apps/api/core'
import { api } from './api'
import { app } from './app.svelte'
import { fmtBytes } from './format'
import { intlLocale, t, tn } from '@wylho/atrio'

// Backup local (Configurações → Backup local): um arquivo .ideario com tudo; restaurar junta com o que está aqui.

/** `tn` com o número no formato do idioma ({n} = 1.234 / 1,234). */
const plural = (n: number, one: string, other: string) => tn(n, one, other, { n: n.toLocaleString(intlLocale()) })
const today = () => new Date().toISOString().slice(0, 10)

/** Escolhe onde salvar e faz o backup agora. */
export async function backupNow() {
  if (!isTauri()) return
  const { save } = await import('@tauri-apps/plugin-dialog')
  const status = await api.backupStatus()
  const name = `${t('Ideario backup')} ${today()}.ideario`
  const path = await save({
    title: t('Salvar o backup'),
    defaultPath: status.dir ? `${status.dir}/${name}` : name,
    filters: [{ name: t('Backup do Ideario'), extensions: ['ideario'] }],
  })
  if (!path) return
  app.task = { label: t('Fazendo o backup'), done: 0, total: 0 }
  try {
    const r = await api.backupExport(path, (done, total) => (app.task = { label: t('Fazendo o backup'), done, total }))
    const lines = [
      t('{notas} e {anexos} ({tamanho})', { notas: plural(r.notes, '{n} nota', '{n} notas'), anexos: plural(r.attachments, '{n} anexo', '{n} anexos'), tamanho: fmtBytes(r.bytes) }),
      t('Salvo em {caminho}', { caminho: r.path }),
    ]
    if (r.skippedAttachments) lines.push(plural(r.skippedAttachments, '{n} anexo está só no Google Drive (não baixado aqui) e ficou de fora', '{n} anexos estão só no Google Drive (não baixados aqui) e ficaram de fora'))
    app.info({ title: t('Backup feito'), lines })
  } catch (e) {
    app.info({ title: t('Não foi possível fazer o backup'), lines: [String(e)] })
  } finally {
    app.task = null
  }
}

/** Escolhe um backup, mostra o que tem e, confirmado, junta com o que está no app. */
export async function restoreBackup() {
  if (!isTauri()) return
  const { open } = await import('@tauri-apps/plugin-dialog')
  const path = await open({ title: t('Escolha o backup'), filters: [{ name: t('Backup do Ideario'), extensions: ['ideario'] }] })
  if (typeof path !== 'string') return
  let m
  try {
    m = await api.backupInspect(path)
  } catch (e) {
    app.info({ title: t('Não foi possível abrir o backup'), lines: [String(e)] })
    return
  }
  const when = new Date(m.createdAt).toLocaleString(intlLocale(), { dateStyle: 'long', timeStyle: 'short' })
  app.confirm({
    title: t('Restaurar este backup?'),
    text: t('Feito em {quando}, com {notas} e {anexos}. Ele se junta com o que está aqui: nada é apagado, e o que você escreveu depois do backup continua.', {
      quando: when,
      notas: plural(m.notes, '{n} nota', '{n} notas'),
      anexos: plural(m.attachments, '{n} anexo', '{n} anexos'),
    }),
    confirm: t('Restaurar'),
    onconfirm: () => void runRestore(path),
  })
}

async function runRestore(path: string) {
  app.task = { label: t('Restaurando o backup'), done: 0, total: 0 }
  try {
    const r = await api.backupRestore(path, (done, total) => (app.task = { label: t('Restaurando o backup'), done, total }))
    const lines: string[] = []
    if (r.newNotes) lines.push(plural(r.newNotes, '{n} nota voltou', '{n} notas voltaram'))
    if (r.mergedNotes) lines.push(plural(r.mergedNotes, '{n} nota que já estava aqui foi juntada com a do backup', '{n} notas que já estavam aqui foram juntadas com as do backup'))
    if (r.categories) lines.push(plural(r.categories, '{n} categoria voltou', '{n} categorias voltaram'))
    if (r.attachments) lines.push(plural(r.attachments, '{n} anexo voltou', '{n} anexos voltaram'))
    app.info({ title: t('Backup restaurado'), lines: lines.length ? lines : [t('Tudo do backup já estava aqui.')] })
  } catch (e) {
    app.info({ title: t('Não foi possível restaurar'), lines: [String(e)] })
  } finally {
    app.task = null
  }
}

/** Escolhe a pasta dos backups automáticos. Devolve a pasta (ou null se cancelou). */
export async function pickBackupDir(): Promise<string | null> {
  if (!isTauri()) return null
  const { open } = await import('@tauri-apps/plugin-dialog')
  const dir = await open({ title: t('Pasta dos backups automáticos'), directory: true })
  return typeof dir === 'string' ? dir : null
}
