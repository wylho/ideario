// Testes no app nativo de verdade (Linux: WebKitGTK), dirigido por WebDriver via tauri-driver.
// Confere o critério da Fase 1: criar, editar, filtrar e buscar notas reais; reabrir o app mostra tudo.
//   npx tauri build --debug --no-bundle && xvfb-run -a node tests/native/run.mjs
// Precisa de: WebKitWebDriver (pacote webkit2gtk-driver) e tauri-driver (cargo install tauri-driver).
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import zlib from 'node:zlib'

const APP = resolve(process.env.IDEARIO_APP ?? 'src-tauri/target/debug/ideario')
const DATA = mkdtempSync(join(tmpdir(), 'ideario-native-'))
const IDENTIFIER = 'app.ideario.desktop'
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
  /** Script assíncrono: o último argumento é a função que devolve o resultado. */
  execAsync(script, ...args) {
    return wd('POST', this.p('/execute/async'), { script, args })
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

// Zip sem compressão (o bastante para um Takeout de teste).
function storedZip(files) {
  const crc = (b) => {
    let c = ~0
    for (const x of b) {
      c ^= x
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
    }
    return ~c >>> 0
  }
  const parts = []
  const central = []
  let offset = 0
  for (const [name, data] of Object.entries(files)) {
    const n = Buffer.from(name, 'utf8')
    const d = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8')
    const h = Buffer.alloc(30)
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x800, 6); h.writeUInt16LE(0, 8)
    h.writeUInt32LE(crc(d), 14); h.writeUInt32LE(d.length, 18); h.writeUInt32LE(d.length, 22); h.writeUInt16LE(n.length, 26)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8)
    c.writeUInt32LE(crc(d), 16); c.writeUInt32LE(d.length, 20); c.writeUInt32LE(d.length, 24); c.writeUInt16LE(n.length, 28)
    c.writeUInt32LE(offset, 42)
    parts.push(h, n, d)
    central.push(c, n)
    offset += 30 + n.length + d.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, cd, end])
}

// PDF mínimo de verdade (uma página A4 com um título), para o pdf.js desenhar.
function tinyPdf(title) {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  const stream = `BT /F1 36 Tf 60 740 Td (${title}) Tj ET 0 0 1 rg 60 600 475 80 re f`
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  let out = '%PDF-1.4\n'
  const offsets = []
  objs.forEach((o, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

// PNG grande com ruído (não comprime a nada), azulado: vira WebP bem menor.
function noisyPng(w, h) {
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
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr.set([8, 2, 0, 0, 0], 8)
  const raw = Buffer.alloc((w * 3 + 1) * h)
  let seed = 1
  for (let y = 0; y < h; y++) {
    const o = y * (w * 3 + 1)
    for (let x = 0; x < w; x++) {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0 // imul: a multiplicação comum perde os bits baixos
      const n = seed >>> 26 // 6 bits de ruído: como o grão de uma foto
      raw[o + 1 + x * 3] = 20 + n
      raw[o + 2 + x * 3] = 70 + n
      raw[o + 3 + x * 3] = 180 + n
    }
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

/** O Claude de mentira: roda `ideario --mcp` (outro processo, mesmo banco) e conversa por JSON-RPC em linhas. */
function mcpClient() {
  const proc = spawn(APP, ['--mcp'], { env: { ...process.env, XDG_DATA_HOME: DATA, XDG_CONFIG_HOME: DATA }, stdio: ['pipe', 'pipe', 'inherit'] })
  const waiting = new Map()
  let buf = ''
  proc.stdout.on('data', (d) => {
    buf += d
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i))
      buf = buf.slice(i + 1)
      waiting.get(msg.id)?.(msg)
    }
  })
  let next = 1
  const send = (method, params) =>
    new Promise((resolve, reject) => {
      const id = next++
      const t = setTimeout(() => reject(new Error(`MCP sem resposta: ${method}`)), 10000)
      waiting.set(id, (m) => (clearTimeout(t), resolve(m)))
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  return {
    init: () => send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'teste', version: '1' } }),
    async tool(name, args) {
      const r = await send('tools/call', { name, arguments: args })
      const text = r.result.content.map((c) => c.text ?? '').join('\n')
      if (r.result.isError) throw new Error(`${name}: ${text}`)
      return text
    },
    close: () => proc.stdin.end(),
  }
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

  await test('Ctrl+A numa nota que é só checklist: a WebKit mostra tudo selecionado; apagar limpa', async () => {
    await s.exec(`document.querySelector('[aria-label="Criar"]').click(); return true`)
    await s.waitFor(`return !!document.querySelector('[role=menuitem]')`, 'leque')
    await s.clickText('[role=menuitem]', 'Nota')
    await s.waitFor(`return document.activeElement?.id === 'corpo'`, 'editor')
    await s.exec(`document.querySelector('[aria-label="Checklist"]').click(); return true`)
    await s.keys('Arroz\uE007\uE004Integral\uE007\uE007Café') // Enter no subitem vazio volta um nível
    await s.waitFor(`return document.querySelectorAll('#corpo ul[data-type="taskList"] ul[data-type="taskList"] li').length === 1`, 'subitem')
    await wd('POST', s.p('/actions'), { actions: [{ type: 'key', id: 'k', actions: [{ type: 'keyDown', value: '' }, { type: 'keyDown', value: 'a' }, { type: 'keyUp', value: 'a' }, { type: 'keyUp', value: '' }] }] })
    await sleep(200)
    const shown = await s.exec(`return getSelection().toString()`)
    if (!['Arroz', 'Integral', 'Café'].every((t) => shown.includes(t))) throw new Error(`selecionado: ${JSON.stringify(shown)}`)
    await s.keys('\uE003') // Backspace
    await s.waitFor(`return !document.querySelector('#corpo li')`, 'nota vazia depois de apagar')
    await s.exec(`document.querySelector('[aria-label="Voltar e salvar"]').click(); return true`)
  })

  await test('Fase 3: foto grande entra reduzida em WebP, com miniatura, paleta e tom', async () => {
    const file = join(DATA, 'praia.png')
    writeFileSync(file, noisyPng(2600, 1700))
    const a = await s.execAsync(`window.__TAURI_INTERNALS__.invoke('import_path', { path: arguments[0] }).then(arguments[1], (e) => arguments[1]({ error: String(e) }))`, file)
    if (a.error) throw new Error(a.error)
    if (a.mime !== 'image/webp' || a.width !== 2048 || !a.origBytes || a.bytes >= a.origBytes) throw new Error(JSON.stringify({ ...a, palette: undefined }))
    if (a.palette?.length !== 5 || !a.tone) throw new Error(`paleta ${a.palette} tom ${a.tone}`)
    const w = await s.execAsync(`const i = new Image(); i.onload = () => arguments[1](i.naturalWidth); i.onerror = () => arguments[1](0); i.src = window.__TAURI_INTERNALS__.convertFileSrc(arguments[0], 'att') + '?thumb'`, a.hash)
    if (w !== 400) throw new Error(`miniatura com ${w} px`)
  })

  await test('Fase 3: PDF arrastado ganha prévia da primeira página no card', async () => {
    const file = join(DATA, 'Contrato.pdf')
    writeFileSync(file, tinyPdf('Contrato de aluguel'))
    await s.exec(`window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event: 'tauri://drag-drop', payload: { paths: [arguments[0]], position: { x: 400, y: 400 } } }); return true`, file)
    await s.waitFor(`return document.querySelector('#corpo .nf-card')?.textContent.includes('Contrato.pdf')`, 'PDF na nota nova')
    await sleep(700)
    await s.exec(`document.querySelector('[aria-label="Voltar e salvar"]').click(); return true`)
    const size = await s.waitFor(
      `const i = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes('Contrato.pdf'))?.querySelector('.file-preview'); return i && i.complete && i.naturalWidth > 0 && [i.naturalWidth, i.naturalHeight]`,
      'prévia do PDF no card',
      20000,
    ).catch(async (e) => {
      const dbg = await s.execAsync(`const done = arguments[0]; window.__TAURI_INTERNALS__.invoke('pending_previews').then((p) => done(JSON.stringify(p)), (e) => done('erro ' + e))`)
      throw new Error(e.message + ' | pendentes: ' + dbg)
    })
    // página A4 em pé: mais alta que larga
    if (!(size[1] > size[0])) throw new Error(`prévia ${size}`)
    if (process.env.IDEARIO_SHOT) writeFileSync(process.env.IDEARIO_SHOT, Buffer.from(await wd('GET', s.p('/screenshot')), 'base64'))
  })

  await test('ler o PDF no app (pdf.js): a página aparece desenhada, também na WebKitGTK', async () => {
    await s.exec(`document.querySelector('.view-switch button[title="Arquivos"]').click(); return true`)
    await s.waitFor(`return [...document.querySelectorAll('.f-row, .f-tile')].some((r) => r.textContent.includes('Contrato.pdf'))`, 'PDF em Arquivos')
    await s.exec(`[...document.querySelectorAll('.f-row, .f-tile')].find((r) => r.textContent.includes('Contrato.pdf')).click(); return true`)
    // a primeira página é desenhada num canvas com texto (pixels escuros sobre o branco)
    const ink = await s.waitFor(
      `const c = document.querySelector('.lightbox .pdf-page canvas'); if (!c || !c.width) return false;
       const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let dark = 0;
       for (let i = 0; i < d.length; i += 16) if (d[i] < 128) dark++; return dark > 20 && dark`,
      'página do PDF desenhada',
      15000,
    )
    if (!(ink > 20)) throw new Error(`página vazia: ${ink}`)
    if (process.env.IDEARIO_SHOT) writeFileSync(process.env.IDEARIO_SHOT, Buffer.from(await wd('GET', s.p('/screenshot')), 'base64'))
    await s.exec(`document.querySelector('.lightbox [aria-label="Fechar"]').click(); return true`)
    await s.exec(`document.querySelector('.view-switch button[title="Notas"]').click(); return true`)
    await s.waitFor(`return document.querySelectorAll('.card').length > 0`, 'de volta às notas')
  })

  await test('Importar do Keep: soltar o Takeout pergunta, importa e mostra o resumo', async () => {
    const note = (o) => JSON.stringify({ isPinned: false, isArchived: false, isTrashed: false, color: 'DEFAULT', createdTimestampUsec: 1700000000000000, userEditedTimestampUsec: 1700000000000000, ...o })
    const file = join(DATA, 'takeout-keep.zip')
    writeFileSync(file, storedZip({
      'Takeout/Keep/Lista.json': note({ title: 'Lista do Keep', color: 'GREEN', labels: [{ name: 'Hospital' }], listContent: [{ text: 'Exame', textHtml: '', isChecked: true }, { text: 'Receita', textHtml: '', isChecked: false }] }),
      'Takeout/Keep/Texto.json': note({ title: 'Texto do Keep', isArchived: true, textContentHtml: '<p dir="ltr"><span style="font-weight:700">Importante</span><span style="font-weight:400"> e o resto</span></p>', attachments: [{ filePath: 'apagada.jpg', mimetype: 'image/jpeg' }] }),
      '__MACOSX/Takeout/Keep/._Lista.json': 'lixo',
    }))
    await s.exec(`window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event: 'tauri://drag-drop', payload: { paths: [arguments[0]], position: { x: 400, y: 400 } } }); return true`, file)
    await s.waitFor(`return [...document.querySelectorAll('[role=dialog], [role=alertdialog]')].some((d) => d.textContent.includes('Importar do Google Keep?') && d.textContent.includes('2 notas'))`, 'pergunta')
    await s.clickText('[role=alertdialog] button, [role=dialog] button', 'Importar')
    const summary = await s.waitFor(`const d = [...document.querySelectorAll('[role=dialog]')].find((d) => d.textContent.includes('Importação do Keep concluída')); return d && d.textContent`, 'resumo', 15000)
    for (const t of ['2 notas importadas', '1 arquivada', 'Categorias novas: Hospital', '1 anexo não estava']) if (!summary.includes(t)) throw new Error(`resumo: ${summary}`)
    await s.clickText('[role=dialog] button', 'OK')
    await s.waitFor(`const c = [...document.querySelectorAll('.card')].find((c) => c.getAttribute('aria-label') === 'Lista do Keep'); return c && c.querySelector('.pv-task.done') && c.textContent.includes('Hospital')`, 'card importado com checklist e categoria')
  })

  await test('Fase 5: sem a chave do Google, o sync fica de fora e diz o porquê', async () => {
    const st = await s.execAsync(`window.__TAURI_INTERNALS__.invoke('sync_status').then((v) => arguments[0](v), (e) => arguments[0]('erro ' + e))`)
    if (typeof st !== 'object' || st.configured !== false || st.connected !== false || !(st.pending > 0)) throw new Error(JSON.stringify(st))
    const err = await s.execAsync(`window.__TAURI_INTERNALS__.invoke('sync_sign_in').then(() => arguments[0]('entrou?'), (e) => arguments[0](String(e)))`)
    if (!err.includes('não está configurado')) throw new Error(err)
    await s.exec(`[...document.querySelectorAll('.sidebar button')].find((b) => b.textContent.includes('Configurações'))?.click(); return true`)
    await s.waitFor(`return document.querySelector('.sync-card')?.textContent.includes('não tem a sincronização')`, 'aviso nas Configurações')
    await s.exec(`document.querySelector('.sheet [aria-label="Fechar"]').click(); return true`)
  })

  await test('Fase 4: lembrete vence e avisa sozinho (atrasado também); Adiar reagenda', async () => {
    const note = (id, title, at) => ({ id, title, body: { type: 'doc', content: [{ type: 'paragraph' }] }, categoryId: null, color: 'none', pinned: false, archived: false, trashedAt: null, reminderAt: at, reminderDone: false, reminderRepeat: null, tags: [] })
    const now = Date.now()
    await s.execAsync(`Promise.all([
      window.__TAURI_INTERNALS__.invoke('save_note', { input: arguments[0] }),
      window.__TAURI_INTERNALS__.invoke('save_note', { input: arguments[1] }),
    ]).then(() => arguments[2](true), (e) => arguments[2]('erro ' + e))`, note('01990000-0000-7000-8000-000000000001', 'Tomar o remédio', now + 3000), note('01990000-0000-7000-8000-000000000002', 'Ligar para a clínica', now - 3 * 3600_000))
    // o agendador confere a cada 10 s: os dois aparecem, o de 3 h atrás marcado como atrasado
    const shown = await s.waitFor(`const a = [...document.querySelectorAll('.alert')].map((e) => e.textContent); return a.length >= 2 && a.join(' | ')`, 'avisos na janela', 25000)
    if (!shown.includes('Tomar o remédio') || !/Ligar para a clínica.*Atrasado/.test(shown)) throw new Error(shown)
    await s.exec(`[...document.querySelectorAll('.alert')].find((e) => e.textContent.includes('Tomar o remédio')).querySelector('[aria-label="Adiar 10 minutos"]').click(); return true`)
    await s.waitFor(`return ![...document.querySelectorAll('.alert')].some((e) => e.textContent.includes('Tomar o remédio'))`, 'aviso sai depois de adiar')
    const later = await s.execAsync(`window.__TAURI_INTERNALS__.invoke('get_note', { id: arguments[0] }).then((n) => arguments[1](n.reminderAt))`, '01990000-0000-7000-8000-000000000001')
    if (!(later > Date.now() + 9 * 60_000)) throw new Error(`reagendado para ${new Date(later)}`)
    await s.exec(`document.querySelectorAll('.alert [aria-label="Fechar aviso"]').forEach((b) => b.click()); return true`)
  })

  await test('MCP: o Claude (outro processo) cria a nota, ela aparece na hora; marca um item com a nota aberta', async () => {
    const mcp = mcpClient()
    try {
      await mcp.init()
      const created = await mcp.tool('create_note', { title: 'Do Claude', content: 'Para hoje:\n\n- [ ] Pão\n- [ ] Leite' })
      const id = created.match(/^id: (.+)$/m)[1]
      await s.waitFor(`return [...document.querySelectorAll('.card')].some((c) => c.getAttribute('aria-label') === 'Do Claude')`, 'card criado pelo MCP', 5000)
      await s.clickText('.card', 'Do Claude')
      await s.waitFor(`return document.querySelectorAll('#corpo li[data-checked]').length === 2`, 'checklist no editor')
      // com a nota aberta: o MCP marca o Pão e acrescenta uma linha; o editor mostra sem fechar
      await mcp.tool('set_checklist_items', { id, items: [{ text: 'pao', checked: true }] })
      await mcp.tool('append_to_note', { id, content: 'comprar na volta' })
      await s.waitFor(`const li = [...document.querySelectorAll('#corpo li')].find((l) => l.textContent.includes('Pão')); return li?.dataset.checked === 'true' && document.querySelector('#corpo').textContent.includes('comprar na volta')`, 'mudança do MCP no editor aberto', 5000)
      // e o que se digita no app chega ao MCP
      await s.exec(`const p = [...document.querySelectorAll('#corpo p')].find((x) => x.textContent.includes('Para hoje')); const r = document.createRange(); r.selectNodeContents(p); r.collapse(false); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); return true`)
      await s.keys(' cedo')
      await sleep(900)
      await s.exec(`document.querySelector('[aria-label="Voltar e salvar"]').click(); return true`)
      await sleep(300)
      const note = await mcp.tool('get_note', { id })
      if (!note.includes('Para hoje: cedo') || !note.includes('- [x] Pão') || !note.includes('comprar na volta')) throw new Error(note)
      // mandar para a Lixeira tira o card da tela
      await mcp.tool('move_note', { id, to: 'trash' })
      await s.waitFor(`return ![...document.querySelectorAll('.card')].some((c) => c.getAttribute('aria-label') === 'Do Claude')`, 'card sai da tela', 5000)
    } finally {
      mcp.close()
    }
  })

  await test('backup local: grava o .ideario, restaurar traz de volta o que foi apagado; o automático grava na pasta', async () => {
    const call = (cmd, args) => s.execAsync(`window.__TAURI_INTERNALS__.invoke(arguments[0], arguments[1]).then((v) => arguments[2](v), (e) => arguments[2]('erro ' + e))`, cmd, args)
    const file = join(DATA, 'bk', 'teste.ideario')
    const r = await call('backup_export', { path: file })
    if (typeof r !== 'object' || !(r.notes > 3) || !existsSync(file)) throw new Error(JSON.stringify(r))
    // apaga uma nota de vez e restaura
    const victim = (await call('list_notes', { filter: { categoryId: null, tags: [] }, box: 'active', query: 'bolo', sort: 'updated' }))[0].id
    await call('delete_note', { id: victim })
    const m = await call('backup_inspect', { path: file })
    if (m.notes !== r.notes) throw new Error(JSON.stringify(m))
    const rr = await call('backup_restore', { path: file })
    if (rr.newNotes !== 1) throw new Error(JSON.stringify(rr))
    await s.waitFor(`return [...document.querySelectorAll('.card')].some((c) => c.getAttribute('aria-label') === 'Bolo da vó')`, 'nota de volta na tela')
    // automático: ligado com a pasta, o primeiro sai na hora
    const auto = join(DATA, 'auto')
    const st = await call('backup_set_auto', { enabled: true, dir: auto })
    if (!st.auto || st.dir !== auto) throw new Error(JSON.stringify(st))
    const end = Date.now() + 10000
    while (Date.now() < end && !(existsSync(auto) && readdirSync(auto).some((f) => f.endsWith('.ideario')))) await sleep(200)
    if (!readdirSync(auto).some((f) => /^Ideario backup \d{4}-\d{2}-\d{2}\.ideario$/.test(f))) throw new Error(readdirSync(auto).join(', '))
    // e as Configurações mostram
    await s.exec(`[...document.querySelectorAll('.sidebar button')].find((b) => b.textContent.includes('Configurações'))?.click(); return true`)
    await s.waitFor(`return document.querySelector('#backup-auto')?.getAttribute('data-state') === 'checked'`, 'backup automático ligado nas Configurações')
    await s.exec(`document.querySelector('.sheet [aria-label="Fechar"]').click(); return true`)
    await call('backup_set_auto', { enabled: false, dir: null })
  })

  await test('tema escuro: a janela (barra de título e fundo) acompanha e fica guardado para a próxima abertura', async () => {
    await s.exec(`[...document.querySelectorAll('.sidebar button')].find((b) => b.textContent.includes('Configurações'))?.click(); return true`)
    await s.waitFor(`return !!document.querySelector('.seg-item[data-value="dark"], [data-value="dark"]')`, 'opção Escuro')
    await s.exec(`document.querySelector('[data-value="dark"]').click(); return true`)
    await s.waitFor(`return document.documentElement.getAttribute('data-theme') === 'dark'`, 'tema escuro aplicado')
    const theme = await s.execAsync(`window.__TAURI_INTERNALS__.invoke('plugin:window|theme', { label: 'main' }).then(arguments[0], (e) => arguments[0]('erro ' + e))`)
    if (theme !== 'dark') throw new Error(`janela: ${theme}`)
    await sleep(300)
    const db = new DatabaseSync(join(DATA, IDENTIFIER, 'ideario.db'), { readOnly: true })
    const saved = Object.fromEntries(db.prepare("SELECT key, value FROM sync_state WHERE key IN ('window_theme', 'window_bg')").all().map((r) => [r.key, r.value]))
    db.close()
    if (saved.window_theme !== 'dark' || !/^#[0-9a-f]{6}$/i.test(saved.window_bg ?? '')) throw new Error(JSON.stringify(saved))
    await s.exec(`document.querySelector('.sheet [aria-label="Fechar"]').click(); return true`)
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
    // a janela já nasceu escura (o tema escolhido antes de fechar)
    const theme = await s.execAsync(`window.__TAURI_INTERNALS__.invoke('plugin:window|theme', { label: 'main' }).then(arguments[0], (e) => arguments[0]('erro ' + e))`)
    if (theme !== 'dark') throw new Error(`janela nasceu ${theme}`)
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

  await test('Fase 4: com a janela fechada (segundo plano), o lembrete ainda vence e avisa', async () => {
    const id = '01990000-0000-7000-8000-000000000003'
    await s.execAsync(`window.__TAURI_INTERNALS__.invoke('set_background', { enabled: true }).then(() => arguments[0](true), (e) => arguments[0]('erro ' + e))`)
    await s.execAsync(`window.__TAURI_INTERNALS__.invoke('save_note', { input: { id: arguments[0], title: 'Reunião às 15h', body: { type: 'doc', content: [{ type: 'paragraph' }] }, categoryId: null, color: 'none', pinned: false, archived: false, trashedAt: null, reminderAt: Date.now() + 4000, reminderDone: false, reminderRepeat: null, tags: [] } }).then(() => arguments[1](true))`, id)
    // fecha a janela como no X (pedido de fechar): com o segundo plano ligado, o app continua e a janela só some
    await s.execAsync(`window.__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' }).then(() => arguments[0](true), (e) => arguments[0]('erro ' + e))`)
    await sleep(800)
    const visible = await s.execAsync(`window.__TAURI_INTERNALS__.invoke('plugin:window|is_visible', { label: 'main' }).then(arguments[0], (e) => arguments[0]('erro ' + e))`)
    if (visible !== false) throw new Error(`a janela devia ter sumido: ${visible}`)
    await sleep(16000)
    const db = new DatabaseSync(join(DATA, IDENTIFIER, 'ideario.db'), { readOnly: true })
    const row = db.prepare('SELECT reminder_at, notified_at FROM notes WHERE id = ?').get(id)
    db.close()
    if (!row || row.notified_at !== row.reminder_at) throw new Error(`não avisou com a janela fechada: ${JSON.stringify(row)}`)
  })

  await s.end().catch(() => {})
} catch (e) {
  failures++
  console.log(`  ✘ ${e.message}`)
} finally {
  driver.kill()
  rmSync(DATA, { recursive: true, force: true })
}
console.log(failures ? `${failures} falha(s)` : 'tudo certo')
process.exit(failures ? 1 : 0)
