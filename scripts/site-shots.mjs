// Prints do app para o site, tirados da prévia no navegador com os dados de exemplo do mock (inventados: o
// repositório é público). Em inglês em site/img (a página principal) e em português em site/img/pt.
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
    await shot(browser, 'nota', desk, openCard('Viagem para Paraty'))
    await shot(browser, 'documento', desk, async (p) => {
      await openCard('Ideias de campanha Q4')(p)
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
