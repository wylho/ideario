import { expect, test, type Page } from '@playwright/test'

// Cada teste abre o app do zero; o mock recomeça com os dados de exemplo.
test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.card').first()).toBeVisible()
})

const cards = (page: Page) => page.locator('.card')
const newNote = async (page: Page) => {
  await page.getByLabel('Nova nota').click()
  await expect(page.locator('#corpo')).toBeFocused()
}
const back = (page: Page) => page.getByLabel('Voltar e salvar').click()
const tab = (page: Page, label: string) => page.locator('.tabbar button', { hasText: label }).click()
const drawerItem = async (page: Page, name: string) => {
  await page.getByLabel('Abrir menu').click()
  await page.locator('.drawer').getByRole('button', { name, exact: true }).click()
}

test('nota nova abre com o cursor no corpo e, vazia, não é criada', async ({ page }) => {
  const before = await cards(page).count()
  await page.getByLabel('Nova nota').click()
  await expect(page.locator('#corpo')).toBeFocused()
  await back(page)
  await expect(cards(page)).toHaveCount(before)
})

test('criar nota com #tag e checklist; o card mostra a projeção', async ({ page }) => {
  await newNote(page)
  await page.keyboard.type('Comprar tinta acrílica para o #ateliê ')
  await page.locator('#titulo').fill('Lista do ateliê')
  await page.locator('#corpo').click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.getByLabel('Checklist').click()
  await page.keyboard.type('pincel chato')
  await page.keyboard.press('Enter')
  await page.keyboard.type('tela 30x40')
  await page.locator('#corpo li[data-checked] input').first().click()
  await back(page)

  const card = cards(page).filter({ hasText: 'Lista do ateliê' })
  await expect(card).toHaveCount(1)
  await expect(card.locator('.excerpt')).toContainText('Comprar tinta')
  await expect(card.locator('.mini-check li')).toHaveCount(2)
  await expect(card.locator('.mini-check li.done')).toHaveText('pincel chato')
  await expect(card.locator('.pill.tag')).toHaveText('#ateliê')
})

test('salvamento contínuo grava sem fechar o editor', async ({ page }) => {
  await newNote(page)
  await page.keyboard.type('Rascunho salvo sozinho')
  await expect(cards(page).filter({ hasText: 'Rascunho salvo sozinho' })).toHaveCount(1)
})

test('busca ignora acentos e exige todos os termos', async ({ page }) => {
  await page.locator('#busca').fill('horarios estacionamento')
  await expect(cards(page)).toHaveCount(1)
  await page.locator('#busca').fill('gestao')
  await expect(page.locator('.empty h3')).toHaveText('Nada encontrado')
  await page.locator('#busca').fill('referencia')
  await expect(cards(page)).toHaveCount(3)
})

test('filtro por tag e por categoria; o "+" herda o filtro', async ({ page }) => {
  await cards(page).filter({ hasText: 'Embalagem' }).locator('.pill.tag', { hasText: '#embalagem' }).click()
  await expect(page.locator('.scope-pill')).toContainText('#embalagem')
  await expect(page.locator('#busca')).toHaveAttribute('placeholder', 'Buscar notas em #embalagem')
  await page.getByLabel('Nova nota').click()
  await expect(page.locator('.ed-tags .pill.tag')).toHaveText('#embalagem')
  await back(page)
  await page.getByLabel('Remover filtro').click()

  await drawerItem(page, 'Hospital 1')
  await expect(cards(page)).toHaveCount(1)
  await newNote(page)
  await expect(page.locator('#categoria')).toContainText('Hospital')
  await page.keyboard.type('Levar documentos')
  await back(page)
  await expect(cards(page)).toHaveCount(2)
})

test('fixar, cor, arquivar, lixeira e restaurar', async ({ page }) => {
  const note = () => cards(page).filter({ hasText: 'Horários e estacionamento' })
  await note().click()
  await page.getByLabel('Fixar').click()
  await page.getByLabel('Cor da nota').click()
  await page.getByLabel('Lilás').click()
  await page.keyboard.press('Escape')
  await back(page)
  await expect(page.locator('.masonry').first().locator('.card h3')).toContainText(['Horários e estacionamento'])
  await expect(note()).toHaveClass(/c-lilac/)

  await note().click()
  await page.getByLabel('Mais opções').click()
  await page.getByRole('menuitem', { name: 'Arquivar' }).click()
  await expect(page.locator('.toast')).toHaveText('Nota arquivada')
  await expect(note()).toHaveCount(0)
  await drawerItem(page, 'Arquivo')
  await expect(note()).toHaveCount(1)

  await note().click()
  await page.getByLabel('Mais opções').click()
  await page.getByRole('menuitem', { name: 'Mover para a lixeira' }).click()
  await drawerItem(page, 'Lixeira')
  await expect(page.locator('.banner')).toContainText('30 dias')
  await expect(page.getByLabel('Nova nota')).toHaveCount(0)
  await note().click()
  await page.getByLabel('Mais opções').click()
  await page.getByRole('menuitem', { name: 'Restaurar' }).click()
  await expect(note()).toHaveCount(0)
})

test('lembretes: grupos, concluir pela lista e ponto de atrasados', async ({ page }) => {
  await expect(page.locator('.tabbar .badge')).toHaveCount(1)
  await tab(page, 'Lembretes')
  await expect(page.locator('.section-label')).toHaveText([/Atrasados/, /Hoje/, /Amanhã/, /Próximos/])
  await page.locator('.r-item', { hasText: 'Comprar pilha' }).getByLabel('Concluir lembrete').click()
  await expect(page.locator('.toast')).toHaveText('Lembrete concluído')
  await expect(page.locator('.r-item', { hasText: 'Comprar pilha' })).toHaveCount(0)
  await expect(page.locator('.tabbar .badge')).toHaveCount(0)
  const doneToggle = page.getByRole('button', { name: /Concluídos/ })
  await expect(doneToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(doneToggle).toContainText('1')
  await doneToggle.click()
  await expect(page.locator('.r-item.done', { hasText: 'Comprar pilha' })).toHaveCount(1)
  await page.locator('.r-item.done', { hasText: 'Comprar pilha' }).getByLabel('Reabrir lembrete').click()
  await expect(page.locator('.section-label', { hasText: 'Atrasados' })).toHaveCount(1)
})

test('lembrete definido no editor aparece na aba', async ({ page }) => {
  await cards(page).filter({ hasText: 'Referências tipográficas' }).click()
  await page.getByLabel('Lembrete', { exact: true }).click()
  await page.locator('.quick button', { hasText: 'Amanhã de manhã' }).click()
  await expect(page.locator('.ed-meta .pill')).toContainText('Amanhã, 09:00')
  await back(page)
  await tab(page, 'Lembretes')
  await expect(page.locator('.r-group', { hasText: 'Amanhã' }).locator('.r-title')).toContainText(['Referências tipográficas'])
})

test('arquivos: tipos, ordenação, grade e nota de origem', async ({ page }) => {
  await tab(page, 'Arquivos')
  await expect(page.locator('.stats b').first()).toHaveText('14')
  await page.locator('.seg-item', { hasText: 'PDFs' }).click()
  await expect(page.locator('.f-row')).toHaveCount(2)
  await page.locator('.seg-item', { hasText: 'Tudo' }).click()
  await page.locator('#ordenar').click()
  await page.getByRole('option', { name: 'Tamanho' }).click()
  await expect(page.locator('.f-row .f-name').first()).toHaveText('Manual de marca Linvo v3.pdf')
  await page.getByLabel('Grade').click()
  await page.locator('.f-tile', { hasText: 'Aula 07' }).click()
  await expect(page.locator('#titulo')).toHaveValue('Valuation: fluxo de caixa descontado')
})

test('moodboard: filtro por tom e visualizador', async ({ page }) => {
  await tab(page, 'Moodboard')
  await expect(page.locator('.mood-tile')).toHaveCount(8)
  await page.locator('.tone', { hasText: 'Verdes' }).click()
  await expect(page.locator('.mood-tile')).toHaveCount(1)
  await page.locator('.mood-tile').click()
  await expect(page.locator('.lb-pal code')).toHaveCount(5)
  await expect(page.locator('.lb-opt')).toContainText('−92%')
  await page.getByRole('button', { name: 'Abrir nota' }).click()
  await expect(page.locator('#titulo')).toHaveValue('Paleta outono')
})

test('atalhos: Ctrl+F busca, Ctrl+N nota nova, Esc fecha', async ({ page }) => {
  await page.keyboard.press('Control+f')
  await expect(page.locator('#busca')).toBeFocused()
  await page.keyboard.press('Control+n')
  await expect(page.locator('.ed-saved')).toHaveText('Nova nota')
  await page.keyboard.press('Escape')
  await expect(page.locator('.editor')).toHaveCount(0)
})

test('sem erros no console ao navegar pelas abas', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  for (const t of ['Lembretes', 'Arquivos', 'Moodboard', 'Notas']) await tab(page, t)
  await page.getByLabel('Sincronização').click()
  await expect(page.locator('.sheet-title')).toHaveText('Configurações')
  expect(errors).toEqual([])
})

test.describe('responsivo', () => {
  const cols = (page: Page) => page.locator('.masonry').last().locator('.m-col')

  test('celular: gaveta, abas embaixo e 2 colunas', async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 820 })
    await expect(page.locator('.tabbar')).toBeVisible()
    await expect(page.locator('.sidebar')).toHaveCount(0)
    await expect(cols(page)).toHaveCount(2)
  })

  test('janela média: abas embaixo e mais colunas', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 })
    await expect(page.locator('.tabbar')).toBeVisible()
    await expect(cols(page)).toHaveCount(3)
  })

  test('desktop: barra lateral fixa, sem abas, editor e configurações centrais', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await expect(page.locator('.sidebar')).toBeVisible()
    await expect(page.locator('.tabbar')).toHaveCount(0)
    await expect(page.getByLabel('Abrir menu')).toHaveCount(0)
    await expect(cols(page)).toHaveCount(4)

    await page.locator('.sidebar').getByRole('button', { name: 'Hospital 1' }).click()
    await expect(cards(page)).toHaveCount(1)

    await cards(page).first().click()
    const box = (await page.locator('.editor').boundingBox())!
    expect(box.width).toBeLessThanOrEqual(720)
    expect(Math.abs(box.x + box.width / 2 - 640)).toBeLessThan(2)
    await back(page)

    await page.getByLabel('Sincronização').click()
    const sheet = (await page.locator('.sheet').boundingBox())!
    expect(sheet.y).toBeGreaterThan(0)
    expect(sheet.y + sheet.height).toBeLessThan(800)
  })

  test('redimensionar para desktop fecha a gaveta e mostra a barra lateral', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 820 })
    await page.getByLabel('Abrir menu').click()
    await expect(page.locator('.drawer')).toBeVisible()
    await page.setViewportSize({ width: 1200, height: 820 })
    await expect(page.locator('.drawer')).toHaveCount(0)
    await expect(page.locator('.sidebar')).toBeVisible()
  })
})

test('tema: escolher claro ou escuro nas configurações e manter ao recarregar', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.getByLabel('Sincronização').click()
  await page.getByRole('radio', { name: 'Escuro' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(bg).toBe('rgb(16, 21, 19)')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByLabel('Sincronização').click()
  await page.getByRole('radio', { name: 'Sistema' }).click()
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/)
})
