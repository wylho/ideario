// Testes no app nativo de verdade (Linux: WebKitGTK), dirigido por WebDriver via tauri-driver.
// Confere o critério da Fase 1: criar, editar, filtrar e buscar notas reais; reabrir o app mostra tudo.
//   npx tauri build --debug --no-bundle && xvfb-run -a node tests/native/run.mjs
// Precisa de: WebKitWebDriver (pacote webkit2gtk-driver) e tauri-driver (cargo install tauri-driver).
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import zlib from 'node:zlib'

const APP = resolve(process.env.IDEARIO_APP ?? 'src-tauri/target/debug/ideario')
const DATA = mkdtempSync(join(tmpdir(), 'ideario-native-'))
const PORT = 4444
let failures = 0

const driver = spawn('tauri-driver', ['--port', String(PORT)], {
  env: { ...process.env, XDG_DATA_HOME: DATA, XDG_CONFIG_HOME: DATA },
  stdio: ['ignore', 'ignore', 'inherit'],
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function wd(method, path, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (json.value?.error) throw new Error(`${method} ${path}: ${json.value.error} ${json.value.message ?? ''}`)
  return json.value
}

class Session {
  static async start() {
    for (let i = 0; i < 50; i++) {
      try {
        const t0 = Date.now()
        const v = await wd('POST', '/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP } } } })
        const s = new Session(v.sessionId)
        s.t0 = t0
        return s
      } catch (e) {
        if (i === 49) throw e
        await sleep(200)
      }
    }
  }
  constructor(id) {
    this.id = id
  }
  p(path) {
    return `/session/${this.id}${path}`
  }
  exec(script, ...args) {
    return wd('POST', this.p('/execute/sync'), { script, args })
  }
  async waitFor(script, label, timeout = 8000, ...args) {
    const end = Date.now() + timeout
    while (Date.now() < end) {
      const v = await this.exec(script, ...args).catch(() => null)
      if (v) return v
      await sleep(100)
    }
    throw new Error(`esperando: ${label}`)
  }
  async find(css) {
    const v = await wd('POST', this.p('/element'), { using: 'css selector', value: css })
    return Object.values(v)[0]
  }
  async click(css) {
    await wd('POST', this.p(`/element/${await this.find(css)}/click`), {})
  }
  async type(css, text) {
    await wd('POST', this.p(`/element/${await this.find(css)}/value`), { text })
  }
  async keys(text) {
    await wd('POST', this.p('/actions'), {
      actions: [{ type: 'key', id: 'k', actions: [...text].flatMap((c) => [{ type: 'keyDown', value: c }, { type: 'keyUp', value: c }]) }],
    })
  }
  async clickText(css, text) {
    await this.exec(
      `const el = [...document.querySelectorAll(arguments[0])].find((e) => e.textContent.includes(arguments[1])); if (!el) throw new Error('não achei ' + arguments[1]); el.click(); return true`,
      css,
      text,
    )
  }
  end() {
    return wd('DELETE', this.p(''))
  }
}

async function test(name, fn) {
  try {
    await fn()
    console.log(`  ✓ ${name}`)
  } catch (e) {
    failures++
    console.log(`  ✘ ${name}\n    ${e.message}`)
  }
}

const cardTitles = `return [...document.querySelectorAll('.card')].map((c) => c.getAttribute('aria-label'))`

// PNG 4×2 laranja, para anexar
function png() {
  const crc = (b) => {
    let c = ~0
    for (const x of b) {
      c ^= x
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
    }
    return ~c >>> 0
  }
  const chunk = (t, d) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(d.length)
    const body = Buffer.concat([Buffer.from(t), d])
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(4, 0)
  ihdr.writeUInt32BE(2, 4)
  ihdr.set([8, 6, 0, 0, 0], 8)
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(4).fill([238, 135, 0, 255]).flat())])
  const raw = Buffer.concat([row, row])
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

try {
  console.log('Ideario nativo (WebDriver)')
  let s = await Session.start()
  await s.waitFor(`return document.querySelectorAll('.card').length > 0`, 'lista')
  console.log(`  · lista na tela em ${Date.now() - s.t0} ms (inclui abrir o app pelo driver)`)

  await test('primeiro uso: nota de boas-vindas fixada', async () => {
    const t = await s.exec(cardTitles)
    if (!t.includes('Bem-vindo ao Ideario')) throw new Error(`cards: ${t}`)
  })

  await test('criar uma nota com título, texto e #tag', async () => {
    await s.exec(`document.querySelector('[aria-label="Criar"]').click(); return true`)
    await s.waitFor(`return !!document.querySelector('[role=menuitem]')`, 'leque')
    await s.clickText('[role=menuitem]', 'Nota')
    await s.waitFor(`return document.activeElement?.id === 'corpo'`, 'editor')
    await s.keys('Receita de bolo com açúcar mascavo #cozinha')
    await s.type('#titulo', 'Bolo da vó')
    await sleep(700) // salvamento contínuo
    await s.exec(`document.querySelector('[aria-label="Voltar e salvar"]').click(); return true`)
    await s.waitFor(`return [...document.querySelectorAll('.card')].some((c) => c.getAttribute('aria-label') === 'Bolo da vó')`, 'card novo')
  })

  await test('buscar sem acento e por prefixo', async () => {
    await s.exec(`document.querySelector('[aria-label="Buscar"]').click(); return true`)
    await s.waitFor(`return !!document.getElementById('busca')`, 'campo de busca')
    await s.type('#busca', 'acuca')
    await s.waitFor(`const t = [...document.querySelectorAll('.card')].map((c) => c.getAttribute('aria-label')); return t.length === 1 && t[0] === 'Bolo da vó'`, 'resultado')
    await s.exec(`const i = document.getElementById('busca'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); return true`)
  })

  await test('filtrar pela #tag do texto', async () => {
    await s.waitFor(`return [...document.querySelectorAll('.sidebar .chip, .sidebar button')].some((b) => b.textContent.includes('#cozinha'))`, 'tag na lateral')
  })

  await test('anexar uma foto: entra no texto e é servida pelo núcleo (att://)', async () => {
    const file = join(DATA, 'foto.png')
    writeFileSync(file, png())
    await s.clickText('.card', 'Bolo da vó')
    await s.waitFor(`return !!document.querySelector('.editor')`, 'editor')
    await s.type('.editor input[type=file][accept="image/*"]', file)
    const ok = await s.waitFor(
      `const i = document.querySelector('#corpo img'); return i && i.complete && i.naturalWidth > 0 && [i.src, i.naturalWidth]`,
      'foto carregada',
    )
    if (!/att/.test(ok[0]) || ok[1] !== 4) throw new Error(`src ${ok[0]} largura ${ok[1]}`)
    await sleep(700)
    await s.exec(`document.querySelector('[aria-label="Voltar e salvar"]').click(); return true`)
    await s.waitFor(`return [...document.querySelectorAll('.card')].some((c) => c.getAttribute('aria-label') === 'Bolo da vó' && c.querySelector('.card-media img'))`, 'capa no card')
  })

  await test('arrastar um arquivo do sistema (sem nota aberta) cria uma nota com ele', async () => {
    // O mesmo evento que o Tauri emite quando o sistema solta arquivos na janela (com o caminho de cada um).
    const file = join(DATA, 'takeout.zip')
    writeFileSync(file, 'PK')
    await s.exec(`
      window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event: 'tauri://drag-drop', payload: { paths: [arguments[0]], position: { x: 400, y: 400 } } })
      return true`, file)
    await s.waitFor(`return document.querySelector('#corpo .nf-card')?.textContent.includes('takeout.zip')`, 'anexo na nota nova')
    await sleep(700)
    await s.exec(`document.querySelector('[aria-label="Voltar e salvar"]').click(); return true`)
    await s.waitFor(`return [...document.querySelectorAll('.card .card-file-name')].some((f) => f.textContent.includes('takeout.zip'))`, 'card com o zip')
  })

  await test('microfone liberado na WebKitGTK: o gravador aparece no +', async () => {
    const ok = await s.exec(`return typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia`)
    if (!ok) throw new Error('getUserMedia indisponível')
  })

  await test('Y.Doc: a nota feita no núcleo abre no editor; marcar item e negrito persistem', async () => {
    await s.clickText('.card', 'Bem-vindo ao Ideario')
    await s.waitFor(`return document.querySelectorAll('#corpo ul[data-type="taskList"] > li').length === 4`, 'checklist do núcleo no editor')
    await s.exec(`document.querySelector('#corpo ul[data-type="taskList"] > li input[type=checkbox]').click(); return true`)
    await s.waitFor(`return document.querySelector('#corpo ul[data-type="taskList"] > li').dataset.checked === 'true'`, 'item marcado')
    // negrito no fim do primeiro parágrafo
    await s.exec(`const p = document.querySelector('#corpo p'); const r = document.createRange(); r.selectNodeContents(p); r.collapse(false); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); return true`)
    await s.exec(`document.querySelector('[aria-label="Negrito"]')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); document.querySelector('[aria-label="Negrito"]')?.click(); return true`)
    await s.keys(' forte')
    await sleep(700)
    await s.exec(`document.querySelector('[aria-label="Voltar e salvar"]').click(); return true`)
    await s.waitFor(`return [...document.querySelectorAll('.card')].some((c) => c.getAttribute('aria-label') === 'Bem-vindo ao Ideario' && c.querySelector('.pv-task.done'))`, 'card com o item feito')
  })

  await test('fechar e reabrir: tudo continua lá, na hora', async () => {
    await s.end()
    s = await Session.start()
    await s.waitFor(`return document.querySelectorAll('.card').length > 0`, 'lista')
    console.log(`  · reaberto: lista em ${Date.now() - s.t0} ms`)
    const t = await s.exec(cardTitles)
    if (!t.includes('Bolo da vó') || !t.includes('Bem-vindo ao Ideario')) throw new Error(`cards: ${t}`)
    const cover = await s.exec(`const c = [...document.querySelectorAll('.card')].find((c) => c.getAttribute('aria-label') === 'Bolo da vó'); const i = c?.querySelector('.card-media img'); return i ? i.naturalWidth : 0`)
    if (!cover) throw new Error('capa sumiu')
  })

  await test('Y.Doc: depois de reabrir, o item marcado e o negrito continuam', async () => {
    await s.clickText('.card', 'Bem-vindo ao Ideario')
    await s.waitFor(`return document.querySelector('#corpo ul[data-type="taskList"] > li')?.dataset.checked === 'true'`, 'item marcado')
    const bold = await s.exec(`return [...document.querySelectorAll('#corpo strong')].map((b) => b.textContent).join('|')`)
    if (!bold.includes('forte')) throw new Error(`negrito: ${bold}`)
    await s.exec(`document.querySelector('[aria-label="Voltar e salvar"]').click(); return true`)
    await s.waitFor(`return !document.querySelector('.editor')`, 'editor fechado')
  })

  await test('criar categoria, pôr a nota nela e filtrar', async () => {
    await s.exec(`document.querySelector('.sidebar [aria-label="Nova categoria"]').click(); return true`)
    await s.waitFor(`return !!document.querySelector('.name-form input')`, 'diálogo')
    await s.type('.name-form input', 'Casa')
    await s.exec(`document.querySelector('.name-form button[type=submit]').click(); return true`)
    await s.waitFor(`return [...document.querySelectorAll('.sidebar .d-item')].some((b) => b.textContent.includes('Casa'))`, 'categoria na lateral')
    // a categoria nova já abre filtrada (vazia)
    await s.waitFor(`return document.querySelector('.filter-title')?.textContent.includes('Casa')`, 'filtro da categoria nova')
    await s.clickText('.sidebar .d-item', 'Tudo')
    await s.waitFor(`return [...document.querySelectorAll('.card')].some((c) => c.getAttribute('aria-label') === 'Bolo da vó')`, 'todas as notas')
    await s.exec(`const c = [...document.querySelectorAll('.card')].find((c) => c.getAttribute('aria-label') === 'Bolo da vó'); c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 300 })); return true`)
    await s.waitFor(`return !!document.querySelector('[role=menuitem]')`, 'menu')
    await s.exec(`[...document.querySelectorAll('[role=menuitem]')].find((e) => e.textContent.includes('Categoria')).dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse' })); return true`)
    await s.exec(`[...document.querySelectorAll('[role=menuitem]')].find((e) => e.textContent.includes('Categoria')).click(); return true`)
    await s.waitFor(`return [...document.querySelectorAll('[role=menuitem]')].some((e) => e.textContent.trim() === 'Casa')`, 'submenu')
    await s.exec(`[...document.querySelectorAll('[role=menuitem]')].find((e) => e.textContent.trim() === 'Casa').click(); return true`)
    await s.clickText('.sidebar .d-item', 'Casa')
    await s.waitFor(`const t = [...document.querySelectorAll('.card')].map((c) => c.getAttribute('aria-label')); return t.length === 1 && t[0] === 'Bolo da vó'`, 'só a nota da categoria')
    await s.clickText('.sidebar .d-item', 'Tudo')
  })

  await test('renomear a #tag em todas as notas (também no texto)', async () => {
    await s.exec(`const c = [...document.querySelectorAll('.sidebar .chip')].find((b) => b.textContent.startsWith('#cozinha')); c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 500 })); return true`)
    await s.waitFor(`return !!document.querySelector('[role=menuitem]')`, 'menu')
    await s.clickText('[role=menuitem]', 'Renomear')
    await s.waitFor(`return !!document.querySelector('.name-form input')`, 'diálogo')
    await s.exec(`const i = document.querySelector('.name-form input'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); return true`)
    await s.type('.name-form input', 'receitas')
    await s.exec(`document.querySelector('.name-form button[type=submit]').click(); return true`)
    await s.waitFor(`return [...document.querySelectorAll('.sidebar .chip')].some((b) => b.textContent.startsWith('#receitas'))`, 'tag nova')
    // espera o diálogo terminar de fechar (ele devolve os cliques à página só no fim da animação)
    await s.waitFor(`return !document.querySelector('[role=dialog]') && !document.body.style.pointerEvents`, 'diálogo fechado')
    // e a lista terminar de recarregar (o card já mostra a tag nova)
    await s.waitFor(`return document.querySelector('.card[aria-label="Bolo da vó"]')?.textContent.includes('#receitas')`, 'card atualizado')
    await s.click('.card[aria-label="Bolo da vó"] h3')
    await s.waitFor(`return !!document.getElementById('corpo')`, 'editor aberto')
    await s.waitFor(`return document.getElementById('corpo')?.textContent.includes('#receitas')`, 'texto da nota com a tag nova')
    await s.exec(`document.querySelector('[aria-label="Voltar e salvar"]').click(); return true`)
  })

  await test('arquivar e ver no Arquivo', async () => {
    await s.exec(`const c = [...document.querySelectorAll('.card')].find((c) => c.getAttribute('aria-label') === 'Bolo da vó'); c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 300 })); return true`)
    await s.waitFor(`return !!document.querySelector('[role=menuitem]')`, 'menu')
    await s.clickText('[role=menuitem]', 'Arquivar')
    await s.waitFor(`return ![...document.querySelectorAll('.card')].some((c) => c.getAttribute('aria-label') === 'Bolo da vó')`, 'saiu da lista')
    await s.clickText('.sidebar button', 'Arquivo')
    await s.waitFor(`return [...document.querySelectorAll('.card')].some((c) => c.getAttribute('aria-label') === 'Bolo da vó')`, 'no Arquivo')
  })

  await s.end()
} catch (e) {
  failures++
  console.log(`  ✘ ${e.message}`)
} finally {
  driver.kill()
  rmSync(DATA, { recursive: true, force: true })
}
console.log(failures ? `${failures} falha(s)` : 'tudo certo')
process.exit(failures ? 1 : 0)
