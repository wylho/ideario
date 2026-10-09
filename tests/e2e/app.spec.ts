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
/** Configurações: pela barra lateral no desktop, pela gaveta no celular. */
const openSettings = async (page: Page) => {
  if (await page.locator('.sidebar').isVisible()) await page.locator('.sidebar').getByRole('button', { name: 'Configurações' }).click()
  else {
    await page.getByLabel('Abrir menu').click()
    await page.locator('.drawer').getByRole('button', { name: 'Configurações' }).click()
  }
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
  // Prévia na ordem do documento: o parágrafo, depois as duas tarefas.
  await expect(card.locator('.preview > p')).toHaveText([/Comprar tinta/, 'pincel chato', 'tela 30x40'])
  await expect(card.locator('.pv-task.done')).toHaveText('pincel chato')
  await expect(card.locator('.preview .hashtag')).toHaveText('#ateliê')
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
  await cards(page).filter({ hasText: 'direção visual' }).locator('.pill.tag', { hasText: '#embalagem' }).click()
  await expect(page.locator('.filter-row .chip.on', { hasText: '#embalagem' })).toHaveCount(1)
  await expect(page.locator('#busca')).toHaveAttribute('placeholder', 'Buscar notas em #embalagem')
  await page.getByLabel('Nova nota').click()
  await expect(page.locator('.ed-tags .pill.tag')).toHaveText('#embalagem')
  await back(page)
  await page.locator('.filter-row').getByRole('button', { name: 'Limpar' }).click()

  await drawerItem(page, 'Hospital 2')
  await expect(cards(page)).toHaveCount(2)
  await newNote(page)
  await expect(page.locator('#categoria')).toContainText('Hospital')
  await page.keyboard.type('Levar documentos')
  await back(page)
  await expect(cards(page)).toHaveCount(3)
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
  await expect(page.locator('.toast span')).toHaveText('Nota arquivada')
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
  await expect(page.locator('.tabbar .tab-n.late')).toHaveCount(1)
  await tab(page, 'Lembretes')
  await expect(page.locator('.section-label')).toHaveText([/Atrasados/, /Hoje/, /Amanhã/, /Próximos/])
  await page.locator('.r-item', { hasText: 'Comprar pilha' }).getByLabel('Concluir lembrete').click()
  await expect(page.locator('.toast span')).toHaveText('Lembrete concluído')
  // concluiu sem querer: o aviso desfaz
  await page.locator('.toast').getByRole('button', { name: 'Desfazer' }).click()
  await expect(page.locator('.r-item:not(.done)', { hasText: 'Comprar pilha' })).toHaveCount(1)
  await page.locator('.r-item', { hasText: 'Comprar pilha' }).getByLabel('Concluir lembrete').click()
  await page.locator('.r-item', { hasText: 'Rótulos' }).getByLabel('Concluir lembrete').click()
  await expect(page.locator('.r-item', { hasText: 'Comprar pilha' })).toHaveCount(0)
  await expect(page.locator('.tabbar .tab-n.late')).toHaveCount(0)
  // concluídos: botão no menu dinâmico da visão
  const doneToggle = page.getByRole('button', { name: 'Mostrar concluídos' })
  await expect(doneToggle).toHaveAttribute('aria-pressed', 'false')
  await doneToggle.click()
  await expect(page.locator('.section-label', { hasText: 'Concluídos' })).toContainText('4')
  await expect(page.locator('.r-item.done', { hasText: 'Comprar pilha' })).toHaveCount(1)
  await page.locator('.r-item.done', { hasText: 'Comprar pilha' }).getByLabel('Reabrir lembrete').click()
  await expect(page.locator('.section-label', { hasText: 'Atrasados' })).toHaveCount(1)
})

test('editor: desfazer e refazer o texto; arquivar pelo editor pode ser desfeito', async ({ page }) => {
  await newNote(page)
  const undo = page.locator('.ed-tools').getByRole('button', { name: 'Desfazer' })
  const redo = page.locator('.ed-tools').getByRole('button', { name: 'Refazer' })
  await expect(undo).toBeDisabled()
  await page.keyboard.type('Rascunho que some')
  await expect(undo).toBeEnabled()
  await undo.click()
  await expect(page.locator('#corpo')).not.toContainText('Rascunho')
  await expect(redo).toBeEnabled()
  await redo.click()
  await expect(page.locator('#corpo')).toContainText('Rascunho que some')
  await page.getByLabel('Mais opções').click()
  await page.getByRole('menuitem', { name: 'Arquivar' }).click()
  await expect(page.locator('.toast span')).toHaveText('Nota arquivada')
  await expect(cards(page).filter({ hasText: 'Rascunho que some' })).toHaveCount(0)
  await page.locator('.toast').getByRole('button', { name: 'Desfazer' }).click()
  await expect(cards(page).filter({ hasText: 'Rascunho que some' })).toHaveCount(1)
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
  await expect(page.locator('.stats b').first()).toHaveText('25')
  // tipo, ordem e grade ficam no menu dinâmico do topo
  await page.getByRole('button', { name: /^Tipo de arquivo/ }).click()
  await page.getByRole('menuitemradio', { name: 'PDFs' }).click()
  await expect(page.locator('.f-row')).toHaveCount(5)
  await page.getByRole('button', { name: 'Tipo de arquivo: PDFs' }).click()
  await page.getByRole('menuitemradio', { name: 'Todos os tipos' }).click()
  await expect(page.locator('.f-row')).toHaveCount(25)
  await page.getByRole('button', { name: /^Ordenar/ }).click()
  await page.getByRole('menuitemradio', { name: 'Tamanho' }).click()
  await expect(page.locator('.f-row .f-name').first()).toHaveText('Manual de marca Linvo v3.pdf')
  await page.getByRole('button', { name: /^Ordenar/ }).click()
  await page.getByRole('menuitemradio', { name: 'Tipo' }).click()
  // por tipo: PDFs primeiro (por nome), vídeo por último
  await expect(page.locator('.f-row .f-name').first()).toHaveText('Aula 07 - Fluxo de caixa descontado.pdf')
  await expect(page.locator('.f-row .f-name').last()).toHaveText('Gravação da reunião de pauta.mp4')
  await page.getByRole('button', { name: 'Ver em grade' }).click()
  await page.locator('.f-tile', { hasText: 'Aula 07' }).click()
  await expect(page.locator('#titulo')).toHaveValue('Valuation: fluxo de caixa descontado')
})

test('moodboard: filtro por tom e visualizador', async ({ page }) => {
  await tab(page, 'Moodboard')
  await expect(page.locator('.mood-tile')).toHaveCount(14)
  await page.getByRole('button', { name: /^Tom das imagens/ }).click()
  await page.getByRole('menuitemradio', { name: 'Verdes' }).click()
  await expect(page.locator('.mood-tile')).toHaveCount(2)
  await page.locator('.mood-tile', { hasText: 'Paleta outono' }).click()
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
  await openSettings(page)
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

    await page.locator('.sidebar').getByRole('button', { name: 'Hospital 2' }).click()
    await expect(cards(page)).toHaveCount(2)

    await cards(page).first().click()
    const box = (await page.locator('.editor').boundingBox())!
    expect(box.width).toBeLessThanOrEqual(720)
    expect(Math.abs(box.x + box.width / 2 - 640)).toBeLessThan(2)
    await back(page)

    await openSettings(page)
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

test('tema e aparência: escolher nas configurações e manter ao recarregar', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  await openSettings(page)
  // padrão: Sistema (na prévia do navegador, imita o GNOME no Linux)
  await expect(page.getByRole('radio', { name: /^Sistema/ })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('radio', { name: /^Ideario/ }).click()
  await page.getByRole('radio', { name: 'Escuro' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect(await bg()).toBe('rgb(16, 21, 19)')
  await page.getByRole('radio', { name: /^Papel/ }).click()
  expect(await bg()).toBe('rgb(27, 23, 20)')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect(await bg()).toBe('rgb(27, 23, 20)')
  await openSettings(page)
  await page.getByRole('radio', { name: 'Automático' }).click()
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/)
  expect(await bg()).toBe('rgb(244, 239, 230)')
  // tema Sistema: a prévia troca a área de trabalho imitada
  await page.getByRole('radio', { name: /^Sistema/ }).click()
  await page.locator('#sistema').click()
  await page.getByRole('option', { name: 'Windows' }).click()
  expect(await bg()).toBe('rgb(243, 243, 243)')
})

test.describe('visão × filtro', () => {
  const chip = (page: Page, name: string) => page.locator('.filter-row .chip', { hasText: name })
  const tabN = (page: Page, label: string) => page.locator('.tabbar button', { hasText: label }).locator('.tab-n')

  test('o filtro continua ao trocar de visão', async ({ page }) => {
    await chip(page, 'Linvo').click()
    await expect(cards(page)).toHaveCount(4)
    await tab(page, 'Lembretes')
    await expect(page.locator('.r-title')).toHaveText(['Post de lançamento do app', 'Ideias de campanha Q4'])
    await tab(page, 'Arquivos')
    await expect(page.locator('.stats b').first()).toHaveText('5')
    await tab(page, 'Moodboard')
    await expect(page.locator('.mood-tile')).toHaveCount(4)
    await expect(chip(page, 'Linvo')).toHaveClass(/on/)
    await expect(page.locator('#busca')).toHaveAttribute('placeholder', 'Buscar imagens em Linvo')
  })

  test('a visão continua ao trocar de categoria', async ({ page }) => {
    await tab(page, 'Lembretes')
    await chip(page, 'Fluency').click()
    await expect(page.locator('.r-title')).toHaveText(['Phrasal verbs pra revisar'])
    await chip(page, 'Gestão de Pessoas').click()
    await expect(page.locator('.r-title')).toHaveText(['1:1 com o time — pauta', 'Feedbacks do trimestre'])
    await expect(page.locator('.tabbar button.on')).toContainText('Lembretes')
  })

  test('visão vazia no filtro mostra aviso e mantém o filtro', async ({ page }) => {
    await chip(page, 'Hospital').click()
    await expect(tabN(page, 'Lembretes')).toHaveCount(0)
    await tab(page, 'Lembretes')
    await expect(page.locator('.empty h3')).toHaveText('Nenhum lembrete em Hospital')
    await expect(chip(page, 'Hospital')).toHaveClass(/on/)
    await page.getByRole('button', { name: 'Ver lembretes de tudo' }).click()
    await expect(chip(page, 'Tudo')).toHaveClass(/on/)
    await expect(page.locator('.r-item')).toHaveCount(11)
  })

  test('categoria e tags se combinam e as contagens acompanham', async ({ page }) => {
    await expect(tabN(page, 'Notas')).toHaveCount(0)
    await expect(tabN(page, 'Lembretes')).toHaveText('11')
    await chip(page, 'Linvo').click()
    await expect(tabN(page, 'Lembretes')).toHaveText('2')
    await chip(page, 'Tags').click()
    await page.locator('.sheet .chip', { hasText: '#campanha' }).click()
    await page.getByRole('button', { name: 'Pronto' }).click()
    await expect(cards(page)).toHaveCount(2)
    await expect(tabN(page, 'Lembretes')).toHaveText('2')
    await expect(page.locator('#busca')).toHaveAttribute('placeholder', 'Buscar notas em Linvo · #campanha')
  })

  test('Arquivo e Lixeira ficam na visão Notas; trocar de visão volta às notas ativas', async ({ page }) => {
    await drawerItem(page, 'Arquivo')
    await expect(cards(page)).toHaveCount(2)
    await tab(page, 'Moodboard')
    await expect(page.locator('.scope-pill')).toHaveCount(0)
    await tab(page, 'Notas')
    await expect(cards(page)).toHaveCount(21)
  })

  test('desktop: barra de visões com contagens e título da categoria', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.locator('.sidebar').getByRole('button', { name: 'Linvo 4' }).click()
    await expect(page.locator('.filter-title')).toContainText('Linvo')
    await expect(page.locator('.view-switch .lens', { hasText: 'Lembretes' }).locator('.n')).toHaveText('2')
    await page.locator('.view-switch .lens', { hasText: 'Arquivos' }).click()
    await expect(page.locator('.filter-title')).toContainText('Linvo')
    await page.getByRole('button', { name: 'Limpar filtro' }).click()
    await expect(page.locator('.filter-title')).toHaveCount(0)
  })
})

test('desktop: barra superior fixa; lateral recolhe para trilho de ícones e lembra a escolha', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const menu = await page.getByLabel('Recolher barra lateral').boundingBox()
  const visoes = await page.locator('.view-switch').boundingBox()
  await page.getByLabel('Recolher barra lateral').click()
  await expect.poll(async () => (await page.locator('.sidebar').boundingBox())!.width).toBe(72)
  // O topo não se move.
  expect(await page.getByLabel('Expandir barra lateral').boundingBox()).toEqual(menu)
  expect(await page.locator('.view-switch').boundingBox()).toEqual(visoes)
  // No trilho, as categorias continuam clicáveis (bolinhas com dica).
  await page.locator('.sidebar').getByRole('button', { name: 'Hospital 2' }).click()
  await expect(cards(page)).toHaveCount(2)
  await page.reload()
  await expect(page.getByLabel('Expandir barra lateral')).toBeVisible()
  await page.keyboard.press('Control+\\')
  await expect(page.getByLabel('Recolher barra lateral')).toBeVisible()
  await expect(page.locator('.sidebar .d-item.rail-only')).toBeHidden()
})

test('prévia do card mantém títulos, tópicos e a ordem do documento', async ({ page }) => {
  const card = cards(page).filter({ hasText: 'Pão de fermentação natural' })
  await expect(card.locator('.pv-h')).toHaveText('Ingredientes')
  await expect(card.locator('.pv-li')).toHaveText(['500 g de farinha', '350 ml de água', '100 g de levain', '10 g de sal'])
  await expect(card.locator('.preview > p').last()).toContainText('Dobras a cada 30 min')
  const mercado = cards(page).filter({ hasText: 'Mercado da semana' })
  await expect(mercado.locator('.preview > p').first()).toHaveText('O que está faltando:')
  await expect(mercado.locator('.pv-task')).toHaveCount(7)
  await expect(mercado.locator('.pv-more')).toHaveCount(0)
})

test('nota sem título aparece pela primeira linha em Lembretes e Arquivos', async ({ page }) => {
  await tab(page, 'Lembretes')
  await expect(page.locator('.r-title', { hasText: 'Comprar pilha AA' })).toHaveCount(1)
  await expect(page.locator('.r-title', { hasText: 'Sem título' })).toHaveCount(0)
})

test('pílula de categoria no card filtra pela categoria', async ({ page }) => {
  await cards(page).filter({ hasText: 'Horários e estacionamento' }).locator('.pill.cat').click()
  await expect(page.locator('.filter-row .chip.on', { hasText: 'Hospital' })).toHaveCount(1)
  await expect(cards(page)).toHaveCount(2)
})

test('clicar na pílula do lembrete abre o menu do lembrete; o X remove', async ({ page }) => {
  await cards(page).filter({ hasText: 'Comprar pilha' }).click()
  await page.getByRole('button', { name: /Alterar lembrete/ }).click()
  await expect(page.locator('.pop-title')).toHaveText('Lembrar de mim')
  await page.getByRole('button', { name: 'Concluir' }).click()
  await expect(page.locator('.rem-pill.done')).toHaveCount(1)
  await page.getByLabel('Remover lembrete').click()
  await expect(page.locator('.rem-pill')).toHaveCount(0)
})

test.describe('menus de contexto', () => {
  const menu = (page: Page) => page.locator('.menu.ctx').first()
  const item = (page: Page, name: string | RegExp) => page.getByRole('menuitem', { name })

  test('card: fixar e mudar a cor pelo clique direito', async ({ page }) => {
    const card = () => cards(page).filter({ hasText: 'Horários e estacionamento' })
    await card().click({ button: 'right' })
    await expect(menu(page)).toBeVisible()
    await item(page, 'Fixar').click()
    await expect(page.locator('.masonry').first().locator('.card h3')).toContainText(['Horários e estacionamento'])
    await card().click({ button: 'right' })
    await item(page, 'Cor').click()
    await item(page, 'Lilás').click()
    await expect(card()).toHaveClass(/c-lilac/)
  })

  test('card: arquivar com desfazer', async ({ page }) => {
    await cards(page).filter({ hasText: 'Horários e estacionamento' }).click({ button: 'right' })
    await item(page, 'Arquivar').click()
    await expect(cards(page).filter({ hasText: 'Horários e estacionamento' })).toHaveCount(0)
    await page.locator('.toast').getByRole('button', { name: 'Desfazer' }).click()
    await expect(cards(page).filter({ hasText: 'Horários e estacionamento' })).toHaveCount(1)
  })

  test('card: categoria e cópia', async ({ page }) => {
    await cards(page).filter({ hasText: 'Horários e estacionamento' }).click({ button: 'right' })
    await item(page, 'Categoria').click()
    await item(page, 'Linvo').click()
    await expect(page.locator('.toast')).toContainText('Movida para Linvo')
    await cards(page).filter({ hasText: 'Horários e estacionamento' }).first().click({ button: 'right' })
    await item(page, 'Fazer uma cópia').click()
    await expect(cards(page).filter({ hasText: 'Horários e estacionamento' })).toHaveCount(2)
  })

  test('lembrete: adiar pelo menu', async ({ page }) => {
    await tab(page, 'Lembretes')
    await page.locator('.r-item', { hasText: 'Comprar pilha' }).click({ button: 'right' })
    await item(page, 'Adiar').click()
    await item(page, /Amanhã de manhã/).click()
    await expect(page.locator('.r-group', { hasText: 'Amanhã' }).locator('.r-title')).toContainText(['Comprar pilha AA e lâmpada da varanda'])
  })

  test('categoria na lateral: nova nota já na categoria', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.locator('.sidebar').getByRole('button', { name: 'Fluency 2' }).click({ button: 'right' })
    await item(page, 'Nova nota em Fluency').click()
    await expect(page.locator('#categoria')).toContainText('Fluency')
  })

  test('teclado: Shift+F10 abre o menu do card focado; Esc fecha sem abrir a nota', async ({ page }) => {
    const card = cards(page).filter({ hasText: 'Horários e estacionamento' })
    await card.focus()
    await page.keyboard.press('Shift+F10')
    await expect(menu(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu(page)).toHaveCount(0)
    await expect(page.locator('.editor')).toHaveCount(0)
  })

  test('sem menu do navegador fora dos campos de texto', async ({ page }) => {
    const blocked = await page.evaluate(() => {
      const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 })
      document.querySelector('.section-label')!.dispatchEvent(ev)
      const inField = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
      document.getElementById('busca')!.dispatchEvent(inField)
      return [ev.defaultPrevented, inField.defaultPrevented]
    })
    expect(blocked).toEqual([true, false])
  })
})

test('card grande para na altura máxima e esmaece o fim; os metadados continuam visíveis', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const longo = cards(page).filter({ hasText: 'Feedbacks do trimestre' })
  await expect(longo.locator('.preview')).toHaveAttribute('data-clipped', '')
  const pv = (await longo.locator('.preview').boundingBox())!
  expect(pv.height).toBeLessThanOrEqual(300)
  await expect(longo.locator('.card-meta')).toBeVisible()
  const curto = cards(page).filter({ hasText: 'Horários e estacionamento' })
  await expect(curto.locator('.preview')).not.toHaveAttribute('data-clipped', '')
})

test('nuvem do sync só aparece quando há algo a dizer', async ({ page }) => {
  await expect(page.locator('.sync-ind')).toHaveCount(0)
  await expect(page.getByText('Sincronizado · Drive')).toHaveCount(0)
  await newNote(page)
  await page.keyboard.type('Algo para sincronizar')
  await back(page)
  await expect(page.locator('.sync-ind.syncing')).toBeVisible({ timeout: 4000 })
  await expect(page.locator('.sync-ind')).toHaveCount(0, { timeout: 4000 })
  await page.context().setOffline(true)
  await expect(page.locator('.sync-ind.offline')).toBeVisible()
  await page.locator('.sync-ind').click()
  await expect(page.locator('.sheet-title')).toHaveText('Configurações')
  await page.context().setOffline(false)
})

test.describe('ordenar e arrastar', () => {
  const titles = (page: Page, section = 1) =>
    page.locator('.drag-section').nth(section).locator('.card').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
  async function dragCard(page: Page, from: string, to: string, where: 'before' | 'after' = 'before') {
    const a = (await cards(page).filter({ hasText: from }).boundingBox())!
    const b = (await cards(page).filter({ hasText: to }).boundingBox())!
    await page.mouse.move(a.x + 30, a.y + 20)
    await page.mouse.down()
    await page.mouse.move(a.x + 40, a.y + 30, { steps: 3 })
    const y = where === 'before' ? b.y + 10 : b.y + b.height - 10
    await page.mouse.move(b.x + 30, y, { steps: 12 })
    await page.waitForTimeout(150)
    await page.mouse.move(b.x + 32, y + 1, { steps: 2 })
    await page.mouse.up()
  }

  test('menu de ordem: categoria agrupa por categoria', async ({ page }) => {
    await page.getByRole('button', { name: /^Ordenar/ }).click()
    await page.getByRole('menuitemradio', { name: 'Categoria' }).click()
    await expect(page.locator('.section-label')).toContainText(['Fixadas', 'Arómate', 'Fluency', 'Gestão de Pessoas', 'Hospital', 'Linvo', 'MBA', 'Sem categoria'])
    await page.reload()
    await expect(page.locator('.section-label', { hasText: 'Arómate' })).toHaveCount(1)
  })

  test('título A–Z', async ({ page }) => {
    await page.getByLabel('Ver em lista').click()
    await page.getByRole('button', { name: /^Ordenar/ }).click()
    await page.getByRole('menuitemradio', { name: 'Título (A–Z)' }).click()
    const t = await titles(page)
    expect(t).toEqual([...t].sort((x, y) => x!.localeCompare(y!, 'pt-BR', { sensitivity: 'base' })))
  })

  test('arrastar muda a ordem, passa para Personalizada e não abre a nota', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1400 })
    await page.getByLabel('Ver em lista').click()
    const before = await titles(page, 0)
    const last = before[before.length - 1]!
    await dragCard(page, last, before[0]!, 'before')
    await expect(page.locator('.editor')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Ordenar: Personalizada' })).toBeVisible()
    await expect.poll(async () => (await titles(page, 0))[0]).toBe(last)
    // A ordem fica: trocar de visão e voltar mantém.
    await page.locator('.view-switch .lens', { hasText: 'Lembretes' }).click()
    await page.locator('.view-switch .lens', { hasText: 'Notas' }).click()
    expect((await titles(page, 0))[0]).toBe(last)
  })

  test('Esc cancela o arraste', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1400 })
    await page.getByLabel('Ver em lista').click()
    const before = await titles(page, 0)
    const a = (await cards(page).filter({ hasText: before[2]! }).boundingBox())!
    const b = (await cards(page).filter({ hasText: before[0]! }).boundingBox())!
    await page.mouse.move(a.x + 30, a.y + 20)
    await page.mouse.down()
    await page.mouse.move(b.x + 30, b.y + 10, { steps: 12 })
    await page.keyboard.press('Escape')
    await page.mouse.up()
    expect(await titles(page, 0)).toEqual(before)
    await expect(page.locator('.drag-ghost')).toHaveCount(0)
  })

  test('na ordem por categoria, arrastar oferece trocar para a ordem livre', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.getByRole('button', { name: /^Ordenar/ }).click()
    await page.getByRole('menuitemradio', { name: 'Categoria' }).click()
    await dragCard(page, 'Paleta outono', 'Embalagem: direção visual')
    await expect(page.locator('.toast')).toContainText('agrupados')
    await page.locator('.toast').getByRole('button', { name: 'Usar ordem livre' }).click()
    await expect(page.getByRole('button', { name: 'Ordenar: Personalizada' })).toBeVisible()
  })
})

test('lateral: chevron mostra e oculta as tags e lembra a escolha', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const toggle = page.locator('.sidebar').getByRole('button', { name: 'Tags', exact: true })
  await expect(page.locator('.sidebar .tag-cloud')).toBeVisible()
  await toggle.click()
  await expect(page.locator('.sidebar .tag-cloud')).toHaveCount(0)
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await page.reload()
  await expect(page.locator('.sidebar .tag-cloud')).toHaveCount(0)
})

test('desktop: visões no canto direito e ações ao lado, paradas; busca e nuvem só ocupam a folga', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!
  const same = (a: { x: number; width: number }, b: { x: number; width: number }) => {
    expect(a.x).toBeCloseTo(b.x, 0)
    expect(a.x + a.width).toBeCloseTo(b.x + b.width, 0)
  }
  // mede depois que as contagens chegaram (o número de Lembretes muda a largura das visões)
  await expect(page.locator('.view-switch .n')).toHaveText(/\d/)
  // mede depois que as contagens chegaram (o número de Lembretes muda a largura das visões)
  await expect(page.locator('.view-switch .n')).toHaveText(/\d/)
  const views = await box('.view-switch')
  expect(views.x + views.width).toBeCloseTo(1280 - 14, 0)
  const sort = await box('.top-actions [aria-label^="Ordenar"]')
  const lupa = await box('.top-actions [aria-label="Buscar"]')
  const still = async () => {
    same(await box('.view-switch'), views)
    same(await box('.top-actions [aria-label^="Ordenar"]'), sort)
  }

  await expect(page.locator('#busca')).toHaveCount(0)
  await page.getByRole('button', { name: 'Buscar', exact: true }).click()
  await expect(page.locator('#busca')).toBeFocused()
  await page.keyboard.type('paraty')
  await expect(cards(page)).toHaveCount(1)
  await still()
  // o campo cresce para a esquerda, a partir de onde estava a lupa
  await page.locator('.search.inline').evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
  const field = await box('.search.inline')
  expect(field.x + field.width).toBeCloseTo(lupa.x + lupa.width, 0)
  await page.locator('.card').first().focus()
  await expect(page.locator('#busca')).toHaveValue('paraty')
  await page.locator('#busca').fill('')
  await page.locator('#busca').press('Escape')
  await expect(page.locator('#busca')).toHaveCount(0)
  await page.keyboard.press('Control+f')
  await expect(page.locator('#busca')).toBeFocused()
  await page.locator('#busca').press('Escape')

  // trocar de visão não mexe nas visões
  await page.locator('.view-switch').getByRole('button', { name: /Arquivos/ }).click()
  same(await box('.view-switch'), views)
  await page.locator('.view-switch').getByRole('button', { name: /Notas/ }).click()

  // a nuvem aparece à esquerda de tudo: nada se move
  await newNote(page)
  await page.keyboard.type('Sincroniza')
  await back(page)
  await expect(page.locator('.sync-ind')).toBeVisible({ timeout: 5000 })
  await still()
  same(await box('.top-actions [aria-label="Buscar"]'), lupa)
})

test('lixeira: esvaziar pelo menu dinâmico, com confirmação', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.locator('.card').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Mover para a lixeira' }).click()
  await page.locator('.sidebar').getByRole('button', { name: 'Lixeira' }).click()
  await expect(cards(page)).not.toHaveCount(0)
  await page.getByRole('button', { name: 'Esvaziar lixeira' }).click()
  await expect(page.getByRole('alertdialog')).toContainText('excluída')
  await page.getByRole('button', { name: 'Cancelar' }).click()
  await expect(cards(page)).not.toHaveCount(0)
  await page.getByRole('button', { name: 'Esvaziar lixeira' }).click()
  await page.getByRole('button', { name: 'Esvaziar', exact: true }).click()
  await expect(cards(page)).toHaveCount(0)
  await expect(page.locator('.empty')).toContainText('Lixeira vazia')
  // sem nada para esvaziar, o botão some
  await expect(page.getByRole('button', { name: 'Esvaziar lixeira' })).toHaveCount(0)
})

test('desktop: filtro de tipo como ícones no topo; tocar de novo tira o filtro', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.locator('.view-switch').getByRole('button', { name: /Arquivos/ }).click()
  const pdf = page.locator('.filter-group').getByRole('button', { name: 'PDFs' })
  await pdf.click()
  await expect(pdf).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.f-row')).toHaveCount(5)
  await pdf.click()
  await expect(page.locator('.f-row')).toHaveCount(25)
  // "Outros documentos" junta Word, planilhas e o resto
  await page.locator('.filter-group').getByRole('button', { name: 'Outros documentos' }).click()
  await expect(page.locator('.f-row .f-name')).toContainText(['Pauta 1:1 outubro.docx'])
  await expect(page.locator('.f-row', { hasText: '.xlsx' })).not.toHaveCount(0)
  await page.locator('.filter-group').getByRole('button', { name: 'Vídeo' }).click()
  await expect(page.locator('.f-row')).toHaveCount(1)
  await page.locator('.filter-group').getByRole('button', { name: 'Vídeo' }).click()
  await page.locator('.view-switch').getByRole('button', { name: /Moodboard/ }).click()
  await page.locator('.filter-group').getByRole('button', { name: 'Verdes' }).click()
  await expect(page.locator('.mood-tile')).toHaveCount(2)
})

test('arquivos em grade: toda miniatura é quadrada, foto ou não', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.locator('.view-switch').getByRole('button', { name: /Arquivos/ }).click()
  await page.getByRole('button', { name: 'Ver em grade' }).click()
  const sizes = await page.locator('.f-tile img, .f-tile .f-ico').evaluateAll((els) =>
    els.map((e) => { const r = e.getBoundingClientRect(); return [r.width, r.height] }))
  expect(sizes.length).toBe(25)
  for (const [w, h] of sizes) expect(Math.abs(w - h)).toBeLessThan(1)
})

test('configurações: qualidade Original; aviso de que só fotos são comprimidas', async ({ page }) => {
  await openSettings(page)
  await expect(page.locator('.set-row', { hasText: 'Qualidade' })).toContainText('Só fotos são comprimidas')
  await page.locator('#qualidade').click()
  await page.getByRole('option', { name: 'Original · sem compressão' }).click()
  await expect(page.locator('.set-row', { hasText: 'Qualidade' })).toContainText('sem redimensionar nem comprimir')
})

test('arquivos: baixar pelo menu de contexto e pelo visualizador', async ({ page }) => {
  await tab(page, 'Arquivos')
  await page.locator('.f-row', { hasText: 'Manual de marca' }).click({ button: 'right' })
  const pdf = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: 'Baixar' }).click()
  expect((await pdf).suggestedFilename()).toBe('Manual de marca Linvo v3.pdf')
  await tab(page, 'Moodboard')
  await page.locator('.mood-tile').first().click()
  const img = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Baixar' }).click()
  await img
})

test('bloco de código: único lugar com fonte mono; aparece no card', async ({ page }) => {
  await newNote(page)
  await page.getByRole('button', { name: 'Bloco de código' }).click()
  await page.keyboard.type('const x = 1')
  await expect(page.locator('#corpo pre')).toHaveText('const x = 1')
  await back(page)
  const pre = page.locator('.card .pv-code')
  await expect(pre).toHaveText('const x = 1')
  const fonts = await page.evaluate(() => [
    getComputedStyle(document.querySelector('.pv-code')!).fontFamily,
    getComputedStyle(document.querySelector('.count, .tab-n')!).fontFamily,
  ])
  expect(fonts[0]).toMatch(/mono/i)
  expect(fonts[1]).not.toMatch(/mono/i)
})
