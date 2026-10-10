// Desempenho no app nativo (SPEC §4.1): lista visível a frio, consulta da lista e busca com 5 mil notas.
//   npx tauri build --no-bundle && xvfb-run -a node tests/native/perf.mjs
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const APP = resolve(process.env.IDEARIO_APP ?? 'src-tauri/target/release/ideario')
const DATA = mkdtempSync(join(tmpdir(), 'ideario-perf-'))
const PORT = 4447
const driver = spawn('tauri-driver', ['--port', String(PORT), '--native-port', '4448'], { env: { ...process.env, XDG_DATA_HOME: DATA }, stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function wd(method, path, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) })
  const j = await res.json()
  if (j.value?.error) throw new Error(j.value.message)
  return j.value
}
async function session() {
  for (let i = 0; ; i++) {
    try {
      return (await wd('POST', '/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP } } } })).sessionId
    } catch (e) {
      if (i > 50) throw e
      await sleep(200)
    }
  }
}
const run = (id, script, ...args) => wd('POST', `/session/${id}/execute/async`, { script, args })
const exec = (id, script, ...args) => wd('POST', `/session/${id}/execute/sync`, { script, args })
const waitList = async (id) => {
  for (let i = 0; i < 100; i++) {
    const t = await exec(id, `const m = performance.getEntriesByName('ideario:lista')[0]; return m ? m.startTime : null`).catch(() => null)
    if (t != null) return t
    await sleep(100)
  }
  throw new Error('lista não apareceu')
}

try {
  let id = await session()
  await wd('POST', `/session/${id}/timeouts`, { script: 300000 })
  console.log(`lista a frio (banco vazio), desde o início da página: ${(await waitList(id)).toFixed(0)} ms`)
  // 5 mil notas reais, pelo próprio núcleo
  const made = await run(
    id,
    `const done = arguments[arguments.length - 1]; (async () => {
      const inv = window.__TAURI_INTERNALS__.invoke
      const t0 = performance.now()
      for (let i = 0; i < 5000; i++) {
        const p = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
        await inv('save_note', { input: { id: crypto.randomUUID(), title: 'Nota ' + i, body: { type: 'doc', content: [p('Texto de exemplo número ' + i + ' com reunião, orçamento e #tag' + (i % 20)), p('Mais uma linha para o trecho.')] }, categoryId: null, color: 'none', pinned: false, archived: false, trashedAt: null, reminderAt: null, reminderDone: false, tags: [] } })
      }
      done(performance.now() - t0)
    })()`,
  )
  console.log(`criar 5000 notas: ${(made / 1000).toFixed(1)} s (${(made / 5000).toFixed(2)} ms por nota)`)
  const time = async (label, cmd, args) => {
    const ms = await run(
      id,
      `const done = arguments[arguments.length - 1]; (async () => { const inv = window.__TAURI_INTERNALS__.invoke; await inv(arguments[0], arguments[1]); const r = []; for (let i = 0; i < 5; i++) { const t = performance.now(); const v = await inv(arguments[0], arguments[1]); r.push(performance.now() - t) } r.sort((a, b) => a - b); done(r[2]) })()`,
      cmd,
      args,
    )
    console.log(`${label}: ${ms.toFixed(1)} ms (mediana de 5, com o IPC)`)
  }
  const filter = { categoryId: null, tags: [] }
  await time('listar 5000 notas (ordem personalizada)', 'list_notes', { filter, box: 'active', query: '', sort: 'custom' })
  await time('buscar "orcamento 4999" (FTS5, sem acento)', 'list_notes', { filter, box: 'active', query: 'orcamento 4999', sort: 'updated' })
  await time('buscar "reuni" (prefixo, ~5000 resultados)', 'list_notes', { filter, box: 'active', query: 'reuni', sort: 'updated' })
  await time('filtrar por #tag7 (250 notas)', 'list_notes', { filter: { categoryId: null, tags: ['tag7'] }, box: 'active', query: '', sort: 'updated' })
  await time('contagens das visões', 'view_counts', { filter, query: '' })
  await wd('DELETE', `/session/${id}`)
  id = await session()
  console.log(`reabrir com 5000 notas: lista visível em ${(await waitList(id)).toFixed(0)} ms desde o início da página`)
  await wd('DELETE', `/session/${id}`)
} finally {
  driver.kill()
  rmSync(DATA, { recursive: true, force: true })
}
