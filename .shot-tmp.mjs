import { spawn } from 'node:child_process'
import { chromium } from 'playwright'
const PORT = 4182, S = process.argv[2]
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://localhost:${PORT}`)).ok) break } catch {} await sleep(100) }
const b = await chromium.launch()
const shots = [
  ['cal', 1440, 900, 'Calendário', false], ['kan', 1440, 900, 'Kanban', false], ['cal-dark', 1440, 900, 'Calendário', true],
  ['cal-m', 390, 844, 'Calendário', false], ['kan-m', 390, 844, 'Kanban', false], ['cal-1100', 1100, 800, 'Calendário', false], ['rem', 1440, 900, 'Lembretes', false],
]
for (const [name, w, h, view, dark] of shots) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', colorScheme: dark ? 'dark' : 'light' })
  const p = await ctx.newPage()
  p.on('pageerror', (e) => console.log('ERR', e.message))
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
  await p.clock.setFixedTime(new Date(`${today}T10:00:00-03:00`))
  await p.goto(`http://localhost:${PORT}/`)
  await p.locator('.card').first().waitFor()
  if (w >= 960) await p.locator('.view-switch .lens', { hasText: view }).or(p.locator(`.view-switch .lens[title="${view}"]`)).first().click()
  else await p.locator('.tabbar button', { hasText: view }).click()
  await sleep(700)
  await p.screenshot({ path: `${S}/real-${name}.png` })
  await ctx.close()
}
await b.close(); server.kill()
