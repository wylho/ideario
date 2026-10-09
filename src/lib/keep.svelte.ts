import { isTauri } from '@tauri-apps/api/core'
import { api } from './api'
import { app } from './app.svelte'

// Importar do Google Keep: pelo zip do Takeout arrastado para a janela ou escolhido nas Configurações.

const plural = (n: number, um: string, varios: string) => `${n.toLocaleString('pt-BR')} ${n === 1 ? um : varios}`

/** Se o zip for um Takeout do Keep, pergunta e importa. Devolve false se for um zip qualquer (vira anexo). */
export async function offerKeepImport(path: string): Promise<boolean> {
  const found = await api.inspectTakeout(path).catch(() => null)
  if (!found) return false
  app.confirm({
    title: 'Importar do Google Keep?',
    text: `${plural(found.notes, 'nota encontrada', 'notas encontradas')} neste Takeout. Categorias, cores, checklists e fotos vêm junto; as fotos passam pela otimização. Notas que já entraram antes não se repetem.`,
    confirm: 'Importar',
    onconfirm: () => void runImport(path),
  })
  return true
}

/** Escolher o zip numa janela do sistema (Configurações). */
export async function pickKeepTakeout() {
  if (!isTauri()) return
  const { open } = await import('@tauri-apps/plugin-dialog')
  const path = await open({ title: 'Escolha o zip do Google Takeout', filters: [{ name: 'Google Takeout', extensions: ['zip'] }] })
  if (typeof path !== 'string') return
  if (!(await offerKeepImport(path))) app.say('Este zip não é uma exportação do Google Keep')
}

async function runImport(path: string) {
  app.task = { label: 'Importando do Keep', done: 0, total: 0 }
  try {
    const r = await api.importKeep(path, (done, total) => (app.task = { label: 'Importando do Keep', done, total }))
    const lines = [plural(r.notes, 'nota importada', 'notas importadas')]
    if (r.archived) lines.push(`${plural(r.archived, 'arquivada', 'arquivadas')} (estão no Arquivo)`)
    if (r.trashed) lines.push(`${plural(r.trashed, 'na lixeira', 'na lixeira')} (somem em 30 dias)`)
    if (r.photos) lines.push(plural(r.photos, 'foto otimizada', 'fotos otimizadas'))
    if (r.categories.length) lines.push(`Categorias novas: ${r.categories.join(', ')}`)
    if (r.missingMedia) lines.push(`${plural(r.missingMedia, 'anexo não estava', 'anexos não estavam')} no zip e ficaram de fora`)
    if (r.skipped) lines.push(`${plural(r.skipped, 'nota já tinha', 'notas já tinham')} entrado antes`)
    app.info({ title: 'Importação do Keep concluída', lines })
  } catch (e) {
    app.info({ title: 'Não foi possível importar', lines: [String(e)] })
  } finally {
    app.task = null
  }
}
