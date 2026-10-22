import { isTauri } from '@tauri-apps/api/core'
import { api } from './api'
import { app } from './app.svelte'
import { intlLocale, t, tn } from '@wylho/atrio'

// Importar do Google Keep: pelo zip do Takeout arrastado para a janela ou escolhido nas Configurações.

/** `tn` com o número no formato do idioma ({n} = 1.234 / 1,234). */
const plural = (n: number, one: string, other: string) => tn(n, one, other, { n: n.toLocaleString(intlLocale()) })

/** Se o zip for um Takeout do Keep, pergunta e importa. Devolve false se for um zip qualquer (vira anexo). */
export async function offerKeepImport(path: string): Promise<boolean> {
  const found = await api.inspectTakeout(path).catch(() => null)
  if (!found) return false
  app.confirm({
    title: t('Importar do Google Keep?'),
    text: t('{encontradas} neste Takeout. Categorias, cores, checklists e fotos vêm junto; as fotos passam pela otimização. Notas que já entraram antes não se repetem.', {
      encontradas: plural(found.notes, '{n} nota encontrada', '{n} notas encontradas'),
    }),
    confirm: t('Importar'),
    onconfirm: () => void runImport(path),
  })
  return true
}

/** Escolher o zip numa janela do sistema (Configurações). */
export async function pickKeepTakeout() {
  if (!isTauri()) return
  const { open } = await import('@tauri-apps/plugin-dialog')
  const path = await open({ title: t('Escolha o zip do Google Takeout'), filters: [{ name: 'Google Takeout', extensions: ['zip'] }] })
  if (typeof path !== 'string') return
  if (!(await offerKeepImport(path))) app.say(t('Este zip não é uma exportação do Google Keep'))
}

async function runImport(path: string) {
  app.task = { label: t('Importando do Keep'), done: 0, total: 0 }
  try {
    const r = await api.importKeep(path, (done, total) => (app.task = { label: t('Importando do Keep'), done, total }))
    const lines = [plural(r.notes, '{n} nota importada', '{n} notas importadas')]
    if (r.archived) lines.push(plural(r.archived, '{n} arquivada (está no Arquivo)', '{n} arquivadas (estão no Arquivo)'))
    if (r.trashed) lines.push(plural(r.trashed, '{n} na lixeira (some em 30 dias)', '{n} na lixeira (somem em 30 dias)'))
    if (r.photos) lines.push(plural(r.photos, '{n} foto otimizada', '{n} fotos otimizadas'))
    if (r.categories.length) lines.push(t('Categorias novas: {nomes}', { nomes: r.categories.join(', ') }))
    if (r.missingMedia) lines.push(plural(r.missingMedia, '{n} anexo não estava no zip e ficou de fora', '{n} anexos não estavam no zip e ficaram de fora'))
    if (r.skipped) lines.push(plural(r.skipped, '{n} nota já tinha entrado antes', '{n} notas já tinham entrado antes'))
    app.info({ title: t('Importação do Keep concluída'), lines })
  } catch (e) {
    app.info({ title: t('Não foi possível importar'), lines: [String(e)] })
  } finally {
    app.task = null
  }
}
