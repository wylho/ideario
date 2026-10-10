// Sonda no app nativo (WebKitGTK): tremor ao arrastar um card e cards recriados ao redimensionar a janela.
//   xvfb-run -a node tests/native/probe-grid.mjs   (não faz parte da suíte; imprime números)
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const APP = resolve(process.env.IDEARIO_APP ?? 'src-tauri/target/debug/ideario')
const DATA = mkdtempSync(join(tmpdir(), 'ideario-probe-'))
const PORT = 4446
const driver = spawn('tauri-driver', ['--port', String(PORT), '--native-port', String(PORT + 1)], { env: { ...process.env, XDG_DATA_HOME: DATA, XDG_CONFIG_HOME: DATA }, stdio: ['ignore', 'ignore', 'inherit'] })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function wd(method, path, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const json = await res.json().catch(() => ({}))
  if (json.value?.error) throw new Error(`${method} ${path}: ${json.value.error} ${json.value.message ?? ''}`)
  return json.value
}
let sid
for (let i = 0; i < 50 && !sid; i++) {
  try { sid = (await wd('POST', '/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP } } } })).sessionId } catch { await sleep(200) }
}
const p = (x) => `/session/${sid}${x}`
const exec = (script, ...args) => wd('POST', p('/execute/sync'), { script, args })
const execAsync = (script, ...args) => wd('POST', p('/execute/async'), { script, args })
const waitFor = async (script, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await exec(script).catch(() => null); if (v) return v; await sleep(100) } throw new Error('timeout ' + script) }
try {
  await waitFor(`return document.querySelectorAll('.card').length > 0`)
  await wd('POST', p('/window/rect'), { width: 1300, height: 1000 }).catch((e) => console.log('rect', e.message))
  // notas de tamanhos variados
  await execAsync(`const done = arguments[0]; const ps = []; for (let i = 0; i < 18; i++) {
    const lines = Array.from({ length: 1 + (i * 7) % 9 }, (_, j) => ({ type: 'paragraph', content: [{ type: 'text', text: 'Linha ' + j + ' da nota ' + i + ' com algum texto para quebrar' }] }))
    ps.push(window.__TAURI_INTERNALS__.invoke('save_note', { input: { id: '0199' + String(i).padStart(4, '0') + '-0000-7000-8000-000000000000', title: 'Nota ' + i, body: { type: 'doc', content: lines }, categoryId: null, color: ['none','sky','sage','rose'][i % 4], pinned: false, archived: false, trashedAt: null, reminderAt: null, reminderDone: false, reminderRepeat: null, tags: [] } }))
  } Promise.all(ps).then(() => done(true), (e) => done(String(e)))`)
  await exec(`location.reload(); return true`)
  await waitFor(`return document.querySelectorAll('.card').length >= 19`)
  await sleep(800)
  await exec(`window.__ev = []; for (const t of ['pointerdown','pointermove','pointerup','mousedown']) addEventListener(t, (e) => window.__ev.length < 400 && window.__ev.push(t + ':' + e.buttons), true); return true`)
  // registra, a cada quadro, a posição de cada card na tela
  const startRec = `window.__rec = []; const loop = () => { if (!window.__recOn) return; const fr = {}; for (const e of document.querySelectorAll('.drag-section [data-key]')) { const r = e.getBoundingClientRect(); fr[e.dataset.key] = [Math.round(r.left), Math.round(r.top)] } window.__rec.push(fr); requestAnimationFrame(loop) }; window.__recOn = true; requestAnimationFrame(loop); return true`
  const stopRec = `window.__recOn = false; const rec = window.__rec; let rev = 0, moves = 0; const keys = new Set(rec.flatMap((f) => Object.keys(f)));
    for (const k of keys) { let last = null, dir = [0, 0]; for (const f of rec) { const v = f[k]; if (!v) { last = null; continue } if (last) { for (const a of [0, 1]) { const d = Math.sign(v[a] - last[a]); if (d) { moves++; if (dir[a] && d !== dir[a]) rev++; dir[a] = d } } } last = v } }
    return { frames: rec.length, moves, reversals: rev }`
  const rect = (sel, n) => exec(`const r = [...document.querySelectorAll('.drag-section')].at(-1).querySelectorAll('.card')[arguments[1]].getBoundingClientRect(); return [r.left, r.top, r.width, r.height]`, sel, n)
  const cards = '.drag-section:last-of-type .card'
  const order = () => exec(`return [...document.querySelectorAll('.drag-section')].at(-1).querySelectorAll('[data-key]').length + ':' + [...[...document.querySelectorAll('.drag-section')].at(-1).querySelectorAll('[data-key]')].map((e) => e.dataset.key.slice(4, 8)).join(',')`)
  const visible = await exec(`return [...[...document.querySelectorAll('.drag-section')].at(-1).querySelectorAll('.card')].map((c, i) => [i, c.getBoundingClientRect()]).filter(([i, r]) => i > 0 && r.bottom < innerHeight - 70 && r.top > 0).map(([i]) => i)`)
  console.log('alvos visíveis', visible.join(','))
  for (const target of visible.slice(0, 6)) {
    const [ax, ay] = await rect('.drag-section .card', 0)
    const [tx, ty, tw, th] = await rect('.drag-section .card', target)
    const mx = Math.round(tx + tw / 2), my = Math.round(ty + th * 0.45)
    await exec(startRec)
    const moves = [{ type: 'pointerMove', duration: 0, x: Math.round(ax + 50), y: Math.round(ay + 30) }, { type: 'pointerDown', button: 0 }]
    moves.push({ type: 'pointerMove', duration: 120, x: Math.round(ax + 70), y: Math.round(ay + 50) })
    moves.push({ type: 'pointerMove', duration: 500, x: mx, y: my })
    for (let i = 0; i < 40; i++) moves.push({ type: 'pointerMove', duration: 40, x: mx + (i % 2 ? 4 : -4), y: my + ((i % 5) - 2) * 2 })
    const before = await order()
    await wd('POST', p('/actions'), { actions: [{ type: 'pointer', id: 'm', parameters: { pointerType: 'mouse' }, actions: moves }] })
    const during = await order()
    console.log('eventos', await exec(`const c = {}; for (const e of window.__ev) c[e] = (c[e] ?? 0) + 1; window.__ev = []; return JSON.stringify(c) + ' ghost=' + !!document.querySelector('.drag-ghost') + ' w=' + innerWidth + 'x' + innerHeight`))
    const stats = await exec(stopRec)
    await wd('POST', p('/actions'), { actions: [{ type: 'pointer', id: 'm', parameters: { pointerType: 'mouse' }, actions: [{ type: 'pointerUp', button: 0 }] }] })
    await wd('DELETE', p('/actions'))
    await sleep(500)
    console.log(`arrastar até o card ${target}: quadros ${stats.frames}, movimentos ${stats.moves}, idas-e-voltas ${stats.reversals}, mudou a ordem: ${before !== during}`)
  }
  // redimensionar
  await exec(`window.__added = 0; new MutationObserver((m) => { for (const x of m) for (const n of x.addedNodes) if (n.nodeType === 1 && n.querySelector?.('.card')) window.__added++ }).observe(document.body, { childList: true, subtree: true }); return true`)
  const r0 = await wd('GET', p('/window/rect'))
  for (let w = 1300; w >= 700; w -= 25) { await wd('POST', p('/window/rect'), { width: w, height: 900 }).catch((e) => console.log('rect', e.message)); await sleep(30) }
  await sleep(600)
  const overlaps = await exec(`const c = [...document.querySelectorAll('.masonry [data-key]')].map((e) => e.getBoundingClientRect()); let n = 0; for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) { const a = c[i], b = c[j]; if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) n++ } return n`)
  console.log(`redimensionar (janela começou em ${r0.width}px): cards recriados ${await exec('return window.__added')}, sobreposições no fim ${overlaps}, largura agora ${await exec('return innerWidth')}`)
} catch (e) {
  console.log('erro', e.message)
} finally {
  await wd('DELETE', p('')).catch(() => {})
  driver.kill()
  rmSync(DATA, { recursive: true, force: true })
}
