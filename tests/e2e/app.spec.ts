import { expect, test, type Page } from '@playwright/test'

// Cada teste abre o app do zero; o mock recomeça com os dados de exemplo.
// O relógio fica fixo às 10h de hoje (horário de Brasília): os lembretes de exemplo ("hoje às 15h", "hoje às 19h30")
// são sempre futuros, não importa a hora em que os testes rodam. Os timers seguem normais.
test.beforeEach(async ({ page }) => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
  await page.clock.setFixedTime(new Date(`${today}T10:00:00-03:00`))
  await page.goto('/')
  await expect(page.locator('.card').first()).toBeVisible()
})

const cards = (page: Page) => page.locator('.card')
/** Nota nova pelo "+": abre o leque e escolhe Nota. */
const plusNote = async (page: Page) => {
  await page.getByRole('button', { name: 'Criar' }).click()
  await page.getByRole('menuitem', { name: 'Nota' }).click()
}
const newNote = async (page: Page) => {
  await plusNote(page)
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
  await plusNote(page)
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
  await plusNote(page)
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
  await page.locator('.editor').getByLabel('Fixar').click()
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
  await expect(page.getByRole('button', { name: 'Criar' })).toHaveCount(0)
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

test('lembrete que se repete: escolher no editor, ver o ícone e não ter "Concluir"', async ({ page }) => {
  await cards(page).filter({ hasText: 'Referências tipográficas' }).click()
  await page.getByLabel('Lembrete', { exact: true }).click()
  await page.locator('.quick button', { hasText: 'Amanhã de manhã' }).click()
  // abre a pílula e escolhe a repetição
  await page.getByLabel(/^Alterar lembrete/).click()
  await page.locator('#lembrete-repetir').click()
  await page.getByRole('option', { name: 'Toda semana' }).click()
  await expect(page.locator('#lembrete-repetir')).toContainText('Toda semana')
  await expect(page.locator('.pop-actions').getByRole('button', { name: 'Concluir' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.locator('.ed-meta .pill [aria-label="se repete"]')).toBeVisible()
  await back(page)
  await expect(cards(page).filter({ hasText: 'Referências tipográficas' }).locator('[aria-label="se repete"]')).toBeVisible()
  await tab(page, 'Lembretes')
  await expect(page.locator('.r-item', { hasText: 'Referências tipográficas' }).locator('[aria-label="se repete"]')).toBeVisible()
  // reabre: continua semanal; tirar o lembrete tira a repetição
  await page.locator('.r-item', { hasText: 'Referências tipográficas' }).locator('.r-main').click()
  await page.getByLabel(/^Alterar lembrete/).click()
  await expect(page.locator('#lembrete-repetir')).toContainText('Toda semana')
  await page.locator('.pop-actions').getByRole('button', { name: 'Remover' }).click()
  await page.getByLabel('Lembrete', { exact: true }).click()
  await page.locator('.quick button', { hasText: 'Amanhã de manhã' }).click()
  await page.getByLabel(/^Alterar lembrete/).click()
  await expect(page.locator('#lembrete-repetir')).toContainText('Não repetir')
})

test('arquivos: tipos, ordenação, grade e nota de origem', async ({ page }) => {
  await tab(page, 'Arquivos')
  await expect(page.locator('.stats b').first()).toHaveText('26')
  // tipo, ordem e grade ficam no menu dinâmico do topo
  await page.getByRole('button', { name: /^Tipo de arquivo/ }).click()
  await page.getByRole('menuitemradio', { name: 'PDFs' }).click()
  await expect(page.locator('.f-row')).toHaveCount(5)
  await page.getByRole('button', { name: 'Tipo de arquivo: PDFs' }).click()
  await page.getByRole('menuitemradio', { name: 'Todos os tipos' }).click()
  await expect(page.locator('.f-row')).toHaveCount(26)
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
  await expect(page.locator('.mood-tile')).toHaveCount(15)
  await page.getByRole('button', { name: /^Tom das imagens/ }).click()
  await page.getByRole('menuitemradio', { name: 'Verdes' }).click()
  await expect(page.locator('.mood-tile')).toHaveCount(3)
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
  const cols = (page: Page) => page.locator('.masonry').last()

  test('celular: gaveta, abas embaixo e 2 colunas', async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 820 })
    await expect(page.locator('.tabbar')).toBeVisible()
    await expect(page.locator('.sidebar')).toHaveCount(0)
    await expect(cols(page)).toHaveAttribute('data-cols', '2')
  })

  test('janela média: abas embaixo e mais colunas', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 })
    await expect(page.locator('.tabbar')).toBeVisible()
    await expect(cols(page)).toHaveAttribute('data-cols', '3')
  })

  test('desktop: barra lateral fixa, sem abas, editor e configurações centrais', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await expect(page.locator('.sidebar')).toBeVisible()
    await expect(page.locator('.tabbar')).toHaveCount(0)
    await expect(page.getByLabel('Abrir menu')).toHaveCount(0)
    await expect(cols(page)).toHaveAttribute('data-cols', '4')

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
  // A grade refaz as colunas depois de mudar o tamanho da janela; mede quando o card já está no lugar.
  await expect.poll(async () => (await longo.locator('.preview').boundingBox())?.height ?? Infinity).toBeLessThanOrEqual(300)
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

test('Google Drive nas configurações: conta, sair, cancelar e entrar de novo', async ({ page }) => {
  await openSettings(page)
  const card = page.locator('.sync-card')
  await expect(card).toContainText('voce@gmail.com')
  await expect(card).toContainText('Sincronizado há 2 min')
  await page.getByRole('button', { name: 'Sair', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Sair' }).click()
  await expect(card).toContainText('Só neste aparelho')
  // começou o login e desistiu
  await page.getByRole('button', { name: 'Entrar com Google' }).click()
  await expect(card).toContainText('Continue no navegador')
  await card.getByRole('button', { name: 'Cancelar' }).click()
  await expect(card.getByRole('button', { name: 'Entrar com Google' })).toBeVisible()
  // login até o fim
  await page.getByRole('button', { name: 'Entrar com Google' }).click()
  await expect(card).toContainText('voce@gmail.com')
  await expect(page.locator('.toast')).toContainText('Conectado ao Google Drive')
})

test('redimensionar a janela só move os cards: nenhum é recriado nem fica por cima de outro', async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 900 })
  await page.evaluate(() => {
    const w = window as unknown as { __recriados: number }
    w.__recriados = 0
    new MutationObserver((m) => {
      for (const x of m) for (const n of x.addedNodes) if (n instanceof Element && n.querySelector('.card')) w.__recriados++
    }).observe(document.body, { childList: true, subtree: true })
  })
  for (let w = 1300; w >= 700; w -= 40) await page.setViewportSize({ width: w, height: 900 })
  for (let w = 700; w <= 1100; w += 40) await page.setViewportSize({ width: w, height: 900 })
  expect(await page.evaluate(() => (window as unknown as { __recriados: number }).__recriados)).toBe(0)
  await expect
    .poll(() =>
      page.evaluate(() => {
        const r = [...document.querySelectorAll('.masonry [data-key]')].map((e) => e.getBoundingClientRect())
        let n = 0
        for (let i = 0; i < r.length; i++)
          for (let j = i + 1; j < r.length; j++) if (r[i].left < r[j].right - 1 && r[j].left < r[i].right - 1 && r[i].top < r[j].bottom - 1 && r[j].top < r[i].bottom - 1) n++
        return n
      }),
    )
    .toBe(0)
})

test('segurar o card arrastado quase parado não fica trocando a ordem (sem tremer)', async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 2400 })
  const section = page.locator('.drag-section').last()
  const order = () => section.locator('[data-key]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.key).join())
  const a = (await section.locator('.card').nth(0).boundingBox())!
  let changes = 0
  for (const target of [2, 4, 6, 8]) {
    const t = (await section.locator('.card').nth(target).boundingBox())!
    await page.mouse.move(a.x + 60, a.y + 40)
    await page.mouse.down()
    await page.mouse.move(a.x + 80, a.y + 60, { steps: 4 })
    await page.mouse.move(t.x + t.width / 2, t.y + t.height * 0.45, { steps: 12 })
    await page.waitForTimeout(300)
    let prev = await order()
    for (let i = 0; i < 30; i++) {
      await page.mouse.move(t.x + t.width / 2 + (i % 2 ? 4 : -4), t.y + t.height * 0.45 + ((i % 5) - 2) * 2)
      await page.waitForTimeout(20)
      const o = await order()
      if (o !== prev) changes++
      prev = o
    }
    await page.keyboard.press('Escape')
    await page.mouse.up()
  }
  expect(changes).toBe(0)
})

test.describe('ordenar e arrastar', () => {
  const titles = (page: Page, section = 1) =>
    page.locator('.drag-section').nth(section).locator('.card').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
  async function dragCard(page: Page, from: string, to: string, where: 'before' | 'after' = 'before') {
    const a = (await cards(page).filter({ hasText: from }).boundingBox())!
    const b = (await cards(page).filter({ hasText: to }).boundingBox())!
    // pega pelo meio (os cantos têm o check e o alfinete)
    await page.mouse.move(a.x + 60, a.y + a.height / 2)
    await page.mouse.down()
    await page.mouse.move(a.x + 70, a.y + a.height / 2 + 10, { steps: 3 })
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
  await expect(page.locator('.f-row')).toHaveCount(26)
  // "Outros documentos" junta Word, planilhas e o resto
  await page.locator('.filter-group').getByRole('button', { name: 'Outros documentos' }).click()
  await expect(page.locator('.f-row .f-name')).toContainText(['Pauta 1:1 outubro.docx'])
  await expect(page.locator('.f-row', { hasText: '.xlsx' })).not.toHaveCount(0)
  await page.locator('.filter-group').getByRole('button', { name: 'Vídeo' }).click()
  await expect(page.locator('.f-row')).toHaveCount(1)
  await page.locator('.filter-group').getByRole('button', { name: 'Vídeo' }).click()
  await page.locator('.view-switch').getByRole('button', { name: /Moodboard/ }).click()
  await page.getByRole('button', { name: 'Verdes' }).click()
  await expect(page.locator('.mood-tile')).toHaveCount(3)
})

test('arquivos em grade: toda miniatura é quadrada, foto ou não', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.locator('.view-switch').getByRole('button', { name: /Arquivos/ }).click()
  await page.getByRole('button', { name: 'Ver em grade' }).click()
  const sizes = await page.locator('.f-tile img, .f-tile .f-ico').evaluateAll((els) =>
    els.map((e) => { const r = e.getBoundingClientRect(); return [r.width, r.height] }))
  expect(sizes.length).toBe(26)
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

test('Fase 2 (Y.Doc): negrito e checklist persistem ao reabrir; a prévia do card acompanha', async ({ page }) => {
  await newNote(page)
  await page.locator('#titulo').fill('Compras do mês')
  await page.locator('#corpo').click()
  await page.keyboard.press('Control+b')
  await page.keyboard.type('urgente')
  await page.keyboard.press('Control+b')
  await page.keyboard.type(' hoje')
  await back(page)
  const card = cards(page).filter({ hasText: 'Compras do mês' })
  await expect(card).toContainText('urgente hoje')
  await card.click()
  await expect(page.locator('#corpo strong')).toHaveText('urgente')
  // checklist pelo atalho "[ ] " e marcado no editor; o card mostra o estado
  // só teclado (um clique deixa o editor ajustando a seleção por alguns ms): Enter no título leva ao texto
  await page.locator('#titulo').press('Enter')
  await expect(page.locator('#corpo')).toBeFocused() // o foco chega no quadro seguinte
  await page.keyboard.press('Control+End')
  // o navegador move o cursor e o editor lê no evento selectionchange seguinte: deixa ele passar
  await page.evaluate(() => new Promise((r) => setTimeout(() => requestAnimationFrame(r))))
  await page.keyboard.press('Enter')
  await page.keyboard.type('[ ] leite')
  await page.getByRole('checkbox', { name: 'Marcar “leite”' }).click()
  await back(page)
  await expect(card.locator('.pv-task.done')).toContainText('leite')
  await card.click()
  await expect(page.locator('#corpo ul[data-type="taskList"] > li').first()).toHaveAttribute('data-checked', 'true')
  await expect(page.locator('#corpo strong')).toHaveText('urgente')
})

test('bloco de código: único lugar com fonte mono; aparece no card', async ({ page }) => {
  await newNote(page)
  await page.getByRole('button', { name: 'Inserir' }).click()
  await page.getByRole('menuitem', { name: 'Bloco de código' }).click()
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

test.describe('mídia no editor', () => {
  const openNote = async (page: Page, title: string) => {
    await page.locator('.card', { hasText: title }).first().click()
    await expect(page.locator('#titulo')).toHaveValue(title)
  }
  // PNG 4×2 (proporção 2:1), para importar como foto
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAEklEQVR4nGM4URHwHxkzoAsAAFo1FHl3zjQAAAAAAElFTkSuQmCC', 'base64')

  test('fotos lado a lado: aparecem no editor e na capa do card', async ({ page }) => {
    await expect(page.locator('.card', { hasText: 'Paleta outono' }).locator('.card-media.row img')).toHaveCount(2)
    await openNote(page, 'Paleta outono')
    await expect(page.locator('#corpo .img-row img')).toHaveCount(2)
  })

  test('arrastar uma foto para a borda de outra põe as duas na mesma linha', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await newNote(page)
    // uma de cada vez: entram como fotos soltas, uma embaixo da outra
    const photo = page.locator('.editor input[type=file][accept="image/*"]')
    await photo.setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: png })
    await photo.setInputFiles({ name: 'b.png', mimeType: 'image/png', buffer: png })
    const imgs = page.locator('#corpo > img')
    await expect(imgs).toHaveCount(2)
    const a = (await imgs.first().boundingBox())!
    const b = (await imgs.nth(1).boundingBox())!
    // arrasta a de baixo até a borda direita da de cima
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width / 2 + 8, b.y + b.height / 2 - 8)
    await page.mouse.move(a.x + a.width - 12, a.y + a.height / 2, { steps: 8 })
    await expect(imgs.first()).toHaveAttribute('data-drop', 'right')
    await page.mouse.up()
    await expect(page.locator('#corpo .img-row img')).toHaveCount(2)
    // botões da foto selecionada: tirar da linha desfaz
    await page.getByRole('button', { name: 'Tirar da linha' }).click()
    await expect(page.locator('#corpo .img-row')).toHaveCount(0)
    await expect(imgs).toHaveCount(2)
    // e pôr ao lado da de cima junta de novo, sem arrastar (toque e teclado)
    await page.getByRole('button', { name: 'Pôr ao lado da foto de cima' }).click()
    await expect(page.locator('#corpo .img-row img')).toHaveCount(2)
  })

  test('importar várias fotos de uma vez: entram lado a lado; outros arquivos viram cartão', async ({ page }) => {
    await newNote(page)
    await page.locator('.editor input[type=file][accept="image/*"]').setInputFiles([
      { name: 'a.png', mimeType: 'image/png', buffer: png },
      { name: 'b.png', mimeType: 'image/png', buffer: png },
    ])
    await expect(page.locator('#corpo .img-row img')).toHaveCount(2)
    await page.locator('.editor input[type=file]:not([accept])').setInputFiles({ name: 'contrato.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') })
    await expect(page.locator('#corpo .nf-card')).toContainText('contrato.pdf')
    await back(page)
    await expect(page.locator('.card .pv-file', { hasText: 'contrato.pdf' })).toHaveCount(1)
    await tab(page, 'Arquivos')
    await expect(page.locator('.f-row', { hasText: 'contrato.pdf' })).toHaveCount(1)
  })

  // Arquivo arrastado do computador: um DataTransfer com Files, como o sistema entrega.
  const dropFiles = async (page: Page, selector: string, files: { name: string; type: string; text: string }[]) => {
    const dt = await page.evaluateHandle((files) => {
      const dt = new DataTransfer()
      for (const f of files) dt.items.add(new File([f.text], f.name, { type: f.type }))
      return dt
    }, files)
    await page.dispatchEvent(selector, 'dragover', { dataTransfer: dt })
    await page.dispatchEvent(selector, 'drop', { dataTransfer: dt })
  }

  test('arrastar arquivos sem nota aberta cria uma nota nova com eles (zip incluído)', async ({ page }) => {
    await dropFiles(page, '.content', [
      { name: 'contrato.pdf', type: 'application/pdf', text: '%PDF-1.4' },
      { name: 'takeout.zip', type: 'application/zip', text: 'PK' },
    ])
    await expect(page.locator('#corpo .nf-card')).toHaveCount(2)
    await expect(page.locator('#corpo')).toContainText('takeout.zip')
    await back(page)
    await expect(page.locator('.card .pv-file', { hasText: 'contrato.pdf' })).toHaveCount(1)
  })

  test('nota que é só um anexo vira miniatura quadrada no card', async ({ page }) => {
    await dropFiles(page, '.content', [{ name: 'Aula de inglês 03.m4a', type: 'audio/mp4', text: 'x' }])
    await expect(page.locator('#corpo .nf-card')).toHaveCount(1)
    await back(page)
    const card = cards(page).filter({ hasText: 'Aula de inglês 03.m4a' })
    await expect(card.locator('.card-file.t-audio')).toBeVisible()
    const box = (await card.locator('.card-file').boundingBox())!
    expect(Math.abs(box.width - box.height)).toBeLessThan(2)
    // ocupa a largura toda do card (sem vão do lado)
    expect(Math.abs(box.width - (await card.boundingBox())!.width)).toBeLessThanOrEqual(2) // só a borda
    await expect(card.locator('.pill', { hasText: '1' })).toHaveCount(0)
  })

  test('arrastar arquivo com a nota aberta anexa nela (fora do texto vai para o fim)', async ({ page }) => {
    await newNote(page)
    await page.keyboard.type('Primeira linha')
    await dropFiles(page, '.editor input[placeholder="Título"]', [{ name: 'planilha.csv', type: 'text/csv', text: 'a,b' }])
    await expect(page.locator('#corpo .nf-card')).toContainText('planilha.csv')
    await expect(page.locator('#corpo > *').first()).toHaveText('Primeira linha')
  })

  test('áudio no meio da nota toca no player', async ({ page }) => {
    await expect(page.locator('.card', { hasText: 'Shadowing' }).locator('.pv-file')).toContainText('Shadowing ep. 42.mp3')
    await openNote(page, 'Shadowing: episódio 42')
    const play = page.getByRole('button', { name: /^Tocar Shadowing/ })
    await play.click()
    await expect(page.getByRole('button', { name: /^Pausar Shadowing/ })).toBeVisible()
  })
})

test.describe('gravador de voz', () => {
  test.use({ permissions: ['microphone'] })

  test('gravar dentro da nota vira um áudio com player', async ({ page }) => {
    await newNote(page)
    await page.getByRole('button', { name: 'Inserir' }).click()
    await page.getByRole('menuitem', { name: 'Gravar áudio' }).click()
    await expect(page.locator('.rec-time')).toContainText('Gravando')
    await page.waitForTimeout(1200)
    await page.getByRole('button', { name: 'Parar' }).click()
    await expect(page.locator('#corpo .nf-card .player')).toHaveCount(1)
    await expect(page.locator('#corpo .nf-card')).toContainText('Gravação')
  })

  test('fechar a nota no meio da gravação guarda o áudio e desliga o microfone', async ({ page }) => {
    // conta as faixas de microfone abertas pelo app
    await page.evaluate(() => {
      const w = window as unknown as { __tracks: MediaStreamTrack[] }
      w.__tracks = []
      const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      navigator.mediaDevices.getUserMedia = async (c) => {
        const s = await orig(c)
        w.__tracks.push(...s.getTracks())
        return s
      }
    })
    await newNote(page)
    await page.keyboard.type('Reunião gravada')
    await page.getByRole('button', { name: 'Inserir' }).click()
    await page.getByRole('menuitem', { name: 'Gravar áudio' }).click()
    await expect(page.locator('.rec-time')).toContainText('Gravando')
    await page.waitForTimeout(1000)
    await back(page)
    await expect(page.locator('.editor')).toHaveCount(0)
    const card = cards(page).filter({ hasText: 'Reunião gravada' })
    await expect(card).toContainText('Gravação')
    // nenhuma faixa de microfone continua viva
    const tracks = await page.evaluate(() => (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks.map((t) => t.readyState))
    expect(tracks.length).toBeGreaterThan(0)
    expect(tracks.every((t) => t === 'ended')).toBe(true)
  })
})

test('a mesma #tag duas vezes no texto não quebra o editor e aparece uma vez', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await newNote(page)
  await page.keyboard.type('#ideia primeiro, depois #Ideia de novo e #ideia')
  await expect(page.locator('.ed-tags .pill.tag', { hasText: /^#ideia$/ })).toHaveCount(1)
  await page.keyboard.type(' mais texto')
  await expect(page.locator('#corpo')).toContainText('mais texto')
  expect(errors).toEqual([])
})

test('excluir para sempre pelo clique direito pede confirmação', async ({ page }) => {
  const note = () => cards(page).filter({ hasText: 'Horários e estacionamento' })
  await note().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Mover para a lixeira' }).click()
  await drawerItem(page, 'Lixeira')
  await note().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Excluir para sempre' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('Excluir para sempre?')
  await dialog.getByRole('button', { name: 'Cancelar' }).click()
  await expect(note()).toHaveCount(1)
  await note().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Excluir para sempre' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Excluir' }).click()
  await expect(note()).toHaveCount(0)
})

test('remover o lembrete pelo menu do card também tira a repetição', async ({ page }) => {
  const note = () => cards(page).filter({ hasText: 'Referências tipográficas' })
  await note().click()
  await page.getByLabel('Lembrete', { exact: true }).click()
  await page.locator('.quick button', { hasText: 'Amanhã de manhã' }).click()
  await page.getByLabel(/^Alterar lembrete/).click()
  await page.locator('#lembrete-repetir').click()
  await page.getByRole('option', { name: 'Toda semana' }).click()
  await page.keyboard.press('Escape')
  await back(page)
  await expect(note().locator('[aria-label="se repete"]')).toBeVisible()
  // tira pelo menu do card e marca outro: o novo não se repete
  await note().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Lembrete', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Remover lembrete' }).click()
  await note().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Lembrar', exact: true }).click()
  await page.getByRole('menuitem', { name: /^Amanhã de manhã/ }).click()
  await expect(note().locator('.pill', { hasText: /Amanhã/ })).toBeVisible()
  await expect(note().locator('[aria-label="se repete"]')).toHaveCount(0)
})

test('"+" em leque: atalhos que já abrem a nota fazendo a coisa', async ({ page }) => {
  await page.getByRole('button', { name: 'Criar' }).click()
  const items = page.getByRole('menuitem')
  await expect(items).toHaveText(['Nota', 'Gravar áudio', 'Foto', 'Câmera', 'Anexo'])
  await page.keyboard.press('Escape')
  await expect(items).toHaveCount(0)
  // Foto: escolhe o arquivo e a nota nova já abre com ela
  await page.getByRole('button', { name: 'Criar' }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', { name: 'Foto' }).click()
  await (await chooser).setFiles({
    name: 'p.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAEklEQVR4nGM4URHwHxkzoAsAAFo1FHl3zjQAAAAAAElFTkSuQmCC', 'base64'),
  })
  await expect(page.locator('#corpo img')).toHaveCount(1)
  await back(page)
  // Gravar áudio: abre gravando
  await page.getByRole('button', { name: 'Criar' }).click()
  await page.getByRole('menuitem', { name: 'Gravar áudio' }).click()
  await expect(page.locator('.rec-time')).toContainText('Gravando')
})

test('arquivos: áudio abre no visualizador com player', async ({ page }) => {
  await tab(page, 'Arquivos')
  await page.locator('.f-row', { hasText: 'Aula de conversação' }).click()
  await page.getByRole('button', { name: /^Tocar Aula de conversação/ }).click()
  await expect(page.getByRole('button', { name: /^Pausar Aula de conversação/ })).toBeVisible()
})

test.describe('seleção múltipla', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.getByRole('button', { name: 'Ver em lista' }).click()
  })
  const outras = (page: Page) => page.locator('.drag-section').last().locator('.card')

  test('check no hover, Shift seleciona o intervalo; arquivar em lote com Desfazer', async ({ page }) => {
    const list = outras(page)
    const first = list.nth(0)
    await first.hover()
    await expect(first.locator('.card-check')).toBeVisible()
    await first.locator('.card-check').click()
    await expect(page.locator('.sel-count')).toHaveText('1 selecionada')
    await list.nth(3).locator('.card-check').click({ modifiers: ['Shift'] })
    await expect(page.locator('.sel-count')).toHaveText('4 selecionadas')
    const titles = await list.locator('h3').evaluateAll((els) => els.slice(0, 4).map((e) => e.textContent))
    await page.getByRole('button', { name: 'Arquivar', exact: true }).click()
    await expect(page.locator('.toast span')).toHaveText('4 notas arquivadas')
    await expect(page.locator('.sel-count')).toHaveCount(0)
    for (const t of titles) await expect(page.locator('.card h3', { hasText: t! })).toHaveCount(0)
    await page.locator('.toast').getByRole('button', { name: 'Desfazer' }).click()
    for (const t of titles) await expect(page.locator('.card h3', { hasText: t! }).first()).toBeVisible()
  })

  test('Ctrl+clique seleciona; com seleção ativa o clique marca em vez de abrir; Esc limpa', async ({ page }) => {
    const list = outras(page)
    await list.nth(0).click({ modifiers: ['Control'] })
    await list.nth(2).click()
    await expect(page.locator('.sel-count')).toHaveText('2 selecionadas')
    await expect(page.locator('.editor')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.locator('.sel-count')).toHaveCount(0)
    await page.keyboard.press('Control+a')
    await expect(page.locator('.sel-count')).toHaveText(`${await page.locator('.card').count()} selecionadas`)
  })

  test('retângulo com o mouse a partir do espaço vazio marca as notas que toca', async ({ page }) => {
    // as fixadas ficam no topo: as três cabem na tela
    const list = page.locator('.drag-section').first().locator('.card')
    const a = (await list.nth(0).boundingBox())!
    const c = (await list.nth(2).boundingBox())!
    // começa na margem à esquerda dos cards (espaço vazio) e desce até o terceiro
    await page.mouse.move(a.x - 12, a.y + 4)
    await page.mouse.down()
    await page.mouse.move(a.x + 40, c.y + 10, { steps: 6 })
    await expect(page.locator('.marquee')).toBeVisible()
    await page.mouse.up()
    await expect(page.locator('.marquee')).toHaveCount(0)
    await expect(page.locator('.sel-count')).toHaveText('3 selecionadas')
    await expect(page.locator('.editor')).toHaveCount(0)
  })

  test('a seleção continua depois de uma ação, para aplicar outra', async ({ page }) => {
    const list = outras(page)
    await list.nth(0).click({ modifiers: ['Control'] })
    await list.nth(1).click({ modifiers: ['Control'] })
    await page.getByRole('button', { name: 'Cor', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Lilás' }).click()
    await expect(page.locator('.sel-count')).toHaveText('2 selecionadas')
    await page.getByRole('button', { name: 'Fixar', exact: true }).click()
    await expect(page.locator('.sel-count')).toHaveText('2 selecionadas')
    await expect(page.locator('.card.selected.c-lilac')).toHaveCount(2)
    // um clique no vazio encerra
    const box = (await page.locator('.content').boundingBox())!
    await page.mouse.click(box.x + 6, box.y + box.height - 20)
    await expect(page.locator('.sel-count')).toHaveCount(0)
  })

  test('fixar pelo alfinete do hover', async ({ page }) => {
    const card = outras(page).first()
    const title = await card.locator('h3').textContent()
    await card.hover()
    await card.getByRole('button', { name: 'Fixar' }).click()
    await expect(page.locator('.drag-section').first().locator('.card h3', { hasText: title! })).toHaveCount(1)
  })
})

test('celular: "Selecionar" no menu de contexto inicia a seleção', async ({ page }) => {
  await page.locator('.card').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Selecionar' }).click()
  await expect(page.locator('.sel-count')).toHaveText('1 selecionada')
  await page.locator('.card').nth(1).click()
  await expect(page.locator('.sel-count')).toHaveText('2 selecionadas')
  await page.getByRole('button', { name: 'Limpar seleção' }).click()
  await expect(page.locator('.sel-count')).toHaveCount(0)
})

test.describe('blocos no editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.locator('.card', { hasText: 'Viagem para Paraty' }).first().click()
    await expect(page.locator('#titulo')).toHaveValue('Viagem para Paraty')
  })
  const items = (page: Page) => page.locator('#corpo ul[data-type="taskList"] > li')

  test('alça do item reordena o checklist (como no Keep)', async ({ page }) => {
    await items(page).nth(2).hover()
    const h = (await page.locator('.item-handle').boundingBox())!
    const t = (await items(page).nth(0).boundingBox())!
    await page.mouse.move(h.x + 8, h.y + 10)
    await page.mouse.down()
    await page.mouse.move(h.x + 20, h.y, { steps: 3 })
    await page.mouse.move(t.x + 60, t.y + 3, { steps: 8 })
    await page.mouse.up()
    await expect(items(page).first()).toContainText('Repelente')
  })

  test('menu do bloco: checklist marca todos; mover o bloco para cima', async ({ page }) => {
    await items(page).nth(1).hover()
    await page.locator('.blk-handle').click()
    await page.getByRole('menuitem', { name: 'Marcar todos', exact: true }).click()
    await expect(page.locator('#corpo ul[data-type="taskList"] > li[data-checked="false"]')).toHaveCount(0)
    await items(page).nth(1).hover()
    await page.locator('.blk-handle').click()
    await page.getByRole('menuitem', { name: 'Mover para cima' }).click()
    await expect(page.locator('#corpo > *').first()).toHaveAttribute('data-type', 'taskList')
  })

  test('arrastar um bloco pela alça', async ({ page }) => {
    const file = page.locator('#corpo .note-file')
    await file.hover()
    const h = (await page.locator('.blk-handle').boundingBox())!
    const top = (await page.locator('#corpo .img-row').boundingBox())!
    await page.mouse.move(h.x + 8, h.y + 10)
    await page.mouse.down()
    await page.mouse.move(h.x + 20, h.y, { steps: 3 })
    await page.mouse.move(top.x + 200, top.y + 4, { steps: 10 })
    await page.mouse.up()
    await expect(page.locator('#corpo > *').first()).toHaveClass(/note-file/)
  })

  test('PDF: clique direito abre o menu; abrir mostra o visualizador sem fechar a nota', async ({ page }) => {
    await page.locator('#corpo .note-file').click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: 'Baixar' })).toBeVisible()
    await page.getByRole('menuitem', { name: 'Abrir' }).click()
    await expect(page.locator('.lightbox')).toContainText('Roteiro Paraty.pdf')
    await expect(page.locator('.lightbox').getByRole('button', { name: 'Abrir nota' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.locator('.lightbox')).toHaveCount(0)
    await expect(page.locator('#titulo')).toHaveValue('Viagem para Paraty')
  })

  test('copiar um bloco e colar em outra nota leva as fotos junto', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.locator('#corpo .img-row img').first().click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: 'Ver', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    // espera o menu do clique direito sumir (ele também tem "Copiar")
    await expect(page.getByRole('menuitem', { name: 'Ver', exact: true })).toHaveCount(0)
    await page.locator('#corpo .img-row').hover()
    await page.locator('.blk-handle').click()
    await page.getByRole('menuitem', { name: 'Copiar', exact: true }).click()
    await back(page)
    await newNote(page)
    await page.keyboard.press('Control+v')
    await expect(page.locator('#corpo .img-row img')).toHaveCount(3)
    await back(page)
    await expect(page.locator('.card').filter({ has: page.locator('.card-media.row') })).not.toHaveCount(0)
  })
})

test('configurações: continuar aberto ao fechar a janela, com o nome do lugar de cada sistema', async ({ page }) => {
  await openSettings(page)
  const sw = page.locator('#segundo-plano')
  await expect(sw).toHaveAttribute('aria-checked', 'false')
  await sw.click()
  await expect(sw).toHaveAttribute('aria-checked', 'true')
  await page.reload()
  await openSettings(page)
  await expect(page.locator('#segundo-plano')).toHaveAttribute('aria-checked', 'true')
  // o texto acompanha o sistema imitado na prévia
  await page.getByRole('radio', { name: /^Sistema/ }).click()
  await page.locator('#sistema').click()
  await page.getByRole('option', { name: 'macOS' }).click()
  await expect(page.locator('.set-row', { has: page.locator('#segundo-plano') })).toContainText('barra de menus')
})

test('texto da interface não se seleciona; no editor, sim', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const selected = () => page.evaluate(() => window.getSelection()?.toString() ?? '')
  await page.locator('.brand').dblclick()
  await page.locator('.card h3').first().click({ clickCount: 3, modifiers: ['Shift'] }).catch(() => {})
  await page.keyboard.press('Escape')
  await page.locator('.section-label').first().dblclick()
  expect(await selected()).toBe('')
  await newNote(page)
  await page.keyboard.type('palavra')
  await page.locator('#corpo p').dblclick({ position: { x: 12, y: 8 } })
  expect(await selected()).toBe('palavra')
})

test.describe('categorias e tags', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
  })
  const side = (page: Page) => page.locator('.sidebar')

  test('criar categoria na hora: pelo seletor do editor e pelo clique direito no card', async ({ page }) => {
    await newNote(page)
    await page.keyboard.type('Ingressos do show')
    await page.locator('#categoria').click()
    await page.getByRole('option', { name: 'Nova categoria' }).click()
    await page.getByLabel('Nome', { exact: true }).fill('Lazer')
    await page.locator('.name-form').getByRole('button', { name: 'Criar', exact: true }).click()
    await expect(page.locator('#categoria')).toContainText('Lazer')
    // o editor continua aberto e o texto, no lugar
    await expect(page.locator('#corpo')).toContainText('Ingressos do show')
    await back(page)
    await expect(cards(page).filter({ hasText: 'Ingressos do show' })).toContainText('Lazer')

    await cards(page).filter({ hasText: 'Ingressos do show' }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Categoria' }).hover()
    await page.getByRole('menuitem', { name: 'Nova categoria…' }).click()
    await page.getByLabel('Nome', { exact: true }).fill('Shows')
    await page.locator('.name-form').getByRole('button', { name: 'Criar', exact: true }).click()
    await expect(page.locator('.toast span')).toHaveText('Movida para Shows')
    await expect(cards(page).filter({ hasText: 'Ingressos do show' })).toContainText('Shows')
    await expect(side(page).locator('.d-item', { hasText: 'Shows' })).toBeVisible()
  })

  test('criar, renomear, mudar a cor e apagar categoria (com Desfazer)', async ({ page }) => {
    await side(page).getByRole('button', { name: 'Nova categoria' }).click()
    await page.getByLabel('Nome', { exact: true }).fill('Viagens')
    await page.getByRole('dialog').getByRole('button', { name: 'Criar', exact: true }).click()
    const item = side(page).locator('.d-item', { hasText: 'Viagens' })
    await expect(item).toBeVisible()
    // nova categoria já vem filtrada
    await expect(page.locator('.filter-title')).toContainText('Viagens')
    await item.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Renomear…' }).click()
    await page.getByLabel('Nome', { exact: true }).fill('Férias')
    await page.getByRole('button', { name: 'Salvar' }).click()
    await expect(side(page).locator('.d-item', { hasText: 'Férias' })).toBeVisible()
    await side(page).locator('.d-item', { hasText: 'Férias' }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Cor' }).hover()
    await page.getByRole('menuitem', { name: 'Rosa' }).click()
    await expect(side(page).locator('.d-item', { hasText: 'Férias' }).locator('.dot')).toHaveCSS('background-color', 'rgb(194, 85, 122)')
    // apagar uma categoria com notas: as notas ficam, sem categoria; Desfazer devolve
    await side(page).getByRole('button', { name: 'Tudo', exact: true }).click()
    const linvo = side(page).locator('.d-item', { hasText: 'Linvo' })
    await linvo.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Apagar categoria' }).click()
    await expect(linvo).toHaveCount(0)
    await expect(page.locator('.card', { hasText: 'Ideias de campanha Q4' })).toHaveCount(1)
    await page.locator('.toast').getByRole('button', { name: 'Desfazer' }).click()
    await expect(side(page).locator('.d-item', { hasText: 'Linvo' }).locator('.count')).toHaveText('4')
  })

  test('renomear e tirar uma tag em todas as notas', async ({ page }) => {
    const chip = (t: string) => side(page).locator('.chip', { hasText: new RegExp(`^#${t}\\d`) })
    await chip('compras').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Renomear…' }).click()
    await page.getByLabel('Novo nome', { exact: true }).fill('Mercado')
    await page.getByRole('button', { name: 'Renomear', exact: true }).click()
    await expect(chip('mercado')).toBeVisible()
    await expect(chip('compras')).toHaveCount(0)
    await chip('mercado').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Tirar de todas as notas' }).click()
    await page.getByRole('button', { name: 'Tirar', exact: true }).click()
    await expect(chip('mercado')).toHaveCount(0)
  })
})
