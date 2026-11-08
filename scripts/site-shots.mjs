// Prints do app para o site, tirados da prévia no navegador com os dados de exemplo do mock (inventados: o
// repositório é público; em inglês o mock troca para os exemplos em inglês). Em inglês em site/img (a página principal) e em português em site/img/pt.
// Regra do usuário: a tela cheia de cards, nunca um app vazio; no recorte de celular, zoom nos cards.
//   npm run build && node scripts/site-shots.mjs
// Chromium: o do Playwright, ou CHROMIUM=/caminho/do/chrome.
// Relógio fixo às 10h (como nos testes e2e), para os lembretes de exemplo ficarem no futuro.
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { chromium } from 'playwright'

const PORT = 4179
const IMG = 'site/img'
let OUT = IMG
let LOCALE = 'en'
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitServer() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}`)).ok) return
    } catch {}
    await sleep(100)
  }
  throw new Error('prévia não subiu')
}

/** Salva em WebP (bem menor que PNG para o site). */
function webp(png, name) {
  execFileSync('convert', [png, '-quality', '86', '-define', 'webp:method=6', `${OUT}/${name}.webp`])
  rmSync(png)
}

async function shot(browser, name, { width, height, scale = 2, dark = false }, act) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    locale: LOCALE,
    timezoneId: 'America/Sao_Paulo',
    colorScheme: dark ? 'dark' : 'light',
  })
  await ctx.addInitScript((loc) => localStorage.setItem('atrio.locale', loc), LOCALE)
  const page = await ctx.newPage()
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
  await page.clock.setFixedTime(new Date(`${today}T10:00:00-03:00`))
  await page.goto(`http://localhost:${PORT}/`)
  await page.locator('.card').first().waitFor()
  await act?.(page)
  await sleep(700) // animações
  const png = `${OUT}/${name}.png`
  await page.screenshot({ path: png })
  webp(png, name)
  await ctx.close()
  console.log('  ✓', name)
}

const openCard = (title) => async (page) => {
  await page.locator('.card', { hasText: title }).first().click()
  await page.locator('#titulo').waitFor()
}

try {
  await waitServer()
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
  const desk = { width: 1440, height: 900 }
  for (const [locale, dir] of [['en', IMG], ['pt-BR', `${IMG}/pt`]]) {
    LOCALE = locale
    OUT = dir
    mkdirSync(OUT, { recursive: true })
    const L = (p, e) => (locale === 'pt-BR' ? p : e)
    await shot(browser, 'notas', desk)
    await shot(browser, 'notas-escuro', { ...desk, dark: true })
    await shot(browser, 'nota', desk, openCard(L('Viagem para Paraty', 'Trip to Harbor Bay')))
    // Prompt (instrução para a IA, em laranja) e link na palavra, com a lista de links no fim do card. O texto entra
    // pelo próprio editor (TipTap) numa nota nova: digitado tecla a tecla, o salvamento da nota nova embaralhava.
    await shot(browser, 'prompt', desk, async (p) => {
      await p.keyboard.press('Control+n')
      await p.locator('#corpo').waitFor()
      await p.locator('#titulo').fill(L('Apresentação do trimestre', 'Quarterly presentation'))
      await p.locator('#corpo').click()
      await sleep(1500) // a nota nova nasce no primeiro salvamento
      const text = (t, marks) => (marks ? { type: 'text', text: t, marks } : { type: 'text', text: t })
      const prompt = [{ type: 'prompt' }]
      const link = (href) => [{ type: 'link', attrs: { href } }]
      const task = (...content) => ({ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content }] })
      const doc = [
        {
          type: 'paragraph',
          content: [
            text(L('Revisar os números de vendas ', 'Go over the sales numbers ')),
            text(L('resuma em três tópicos e destaque o que passou da meta', 'sum them up in three bullet points and flag anything above target'), prompt),
            text(L(' antes de montar os ', ' before putting together the ')),
            text('slides', link(L('https://exemplo.com/slides-q3', 'https://example.com/q3-slides'))),
            text(L('. A ', '. The ')),
            text(L('planilha', 'spreadsheet'), link(L('https://exemplo.com/vendas', 'https://example.com/sales'))),
            text(L(' tem os números de julho a setembro.', ' has the numbers from July to September.')),
          ],
        },
        {
          type: 'taskList',
          content: [
            task(text(L('Ensaiar a fala ', 'Rehearse the talk ')), text(L('cronometre e sugira cortes se passar de 10 minutos', 'time it and suggest cuts if it runs over 10 minutes'), prompt)),
            task(text(L('Mandar a pauta para o time', 'Send the agenda to the team'))),
          ],
        },
      ]
      await p.locator('#corpo .ProseMirror, #corpo.ProseMirror').first().evaluate((el, doc) => {
        const ed = el.editor
        ed.chain().selectAll().insertContent(doc).run()
      }, doc)
      await sleep(800)
      await p.locator('#corpo').evaluate((el) => (el.querySelector('.ProseMirror') ?? el).blur())
    })
    // Visão Links: os links das notas em cards (o jeito de ver ao abrir).
    await shot(browser, 'links', desk, (p) => p.locator('.view-switch .lens', { hasText: 'Links' }).click())
    await shot(browser, 'links-escuro', { ...desk, dark: true }, async (p) => {
      await p.locator('.view-switch .lens', { hasText: 'Links' }).click()
      await p.getByRole('button', { name: new RegExp('^' + L('Ver como', 'View as')) }).click()
      await p.getByRole('menuitemradio', { name: L('Lista', 'List') }).click()
    })
    await shot(browser, 'documento', desk, async (p) => {
      await openCard(L('Ideias de campanha Q4', 'Q4 campaign ideas'))(p)
      await p.getByRole('button', { name: L('Abrir como documento', 'Open as document') }).click()
    })
    await shot(browser, 'claude', desk, async (p) => {
      await p.locator('.sidebar').getByRole('button', { name: L('Configurações', 'Settings') }).click()
      await p.locator('h3', { hasText: 'Claude' }).scrollIntoViewIfNeeded()
      await p.locator('h3', { hasText: 'Google Drive' }).evaluate((el) => el.scrollIntoView({ block: 'start' }))
    })
    await shot(browser, 'lembretes', desk, (p) => p.getByRole('button', { name: new RegExp(L('Lembretes', 'Reminders')) }).first().click())
    await shot(browser, 'calendario', desk, (p) => p.locator('.view-switch .lens', { hasText: L('Calendário', 'Calendar') }).click())
    await shot(browser, 'kanban', desk, (p) => p.locator('.view-switch .lens', { hasText: 'Kanban' }).click())
    await shot(browser, 'moodboard', desk, (p) => p.getByRole('button', { name: /Moodboard/ }).first().click())
    await shot(browser, 'janela-estreita', { width: 390, height: 844, scale: 3 })
  }
  await browser.close()
} finally {
  server.kill()
}
