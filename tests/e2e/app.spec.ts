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
  await page.locator('#busca').fill('trabalho')
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

  await drawerItem(page, 'Bem-estar 2')
  await expect(cards(page)).toHaveCount(2)
  await newNote(page)
  await expect(page.locator('#categoria')).toContainText('Bem-estar')
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

test('status no card da lista: muda sem abrir a nota; nota sem status não mostra o seletor', async ({ page }) => {
  const card = cards(page).filter({ hasText: 'Mercado da semana' })
  await card.getByRole('radio', { name: 'Em andamento' }).click()
  await expect(page.locator('.editor')).toHaveCount(0)
  await expect(card.getByRole('radio', { name: 'Em andamento' })).toHaveAttribute('aria-checked', 'true')
  await expect(cards(page).filter({ has: page.getByRole('heading', { name: 'Embalagem: direção visual' }) }).locator('.status-toggle')).toHaveCount(0)
})

test('lembretes: grupos, concluir pela lista e ponto de atrasados', async ({ page }) => {
  await expect(page.locator('.tabbar .tab-n.late')).toHaveCount(1)
  await tab(page, 'Lembretes')
  await expect(page.locator('.section-label')).toHaveText([/Atrasados/, /Hoje/, /Amanhã/, /Próximos/])
  await page.locator('.r-item', { hasText: 'Comprar pilha' }).getByRole('radio', { name: 'Concluído' }).click()
  await expect(page.locator('.toast span')).toHaveText('Lembrete concluído')
  // concluiu sem querer: o aviso desfaz
  await page.locator('.toast').getByRole('button', { name: 'Desfazer' }).click()
  await expect(page.locator('.r-item:not(.done)', { hasText: 'Comprar pilha' })).toHaveCount(1)
  await page.locator('.r-item', { hasText: 'Comprar pilha' }).getByRole('radio', { name: 'Concluído' }).click()
  await page.locator('.r-item', { hasText: 'Rótulos' }).getByRole('radio', { name: 'Concluído' }).click()
  await expect(page.locator('.r-item', { hasText: 'Comprar pilha' })).toHaveCount(0)
  await expect(page.locator('.tabbar .tab-n.late')).toHaveCount(0)
  // concluídos: botão no menu dinâmico da visão
  const doneToggle = page.getByRole('button', { name: 'Mostrar concluídos' })
  await expect(doneToggle).toHaveAttribute('aria-pressed', 'false')
  await doneToggle.click()
  await expect(page.locator('.section-label', { hasText: 'Concluídos' })).toContainText('4')
  await expect(page.locator('.r-item.done', { hasText: 'Comprar pilha' })).toHaveCount(1)
  await page.locator('.r-item.done', { hasText: 'Comprar pilha' }).getByRole('radio', { name: 'A fazer' }).click()
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
  await expect(page.locator('.f-row .f-name').first()).toHaveText('Manual de marca Lumen v3.pdf')
  await page.getByRole('button', { name: /^Ordenar/ }).click()
  await page.getByRole('menuitemradio', { name: 'Tipo' }).click()
  // por tipo: PDFs primeiro (por nome), vídeo por último
  await expect(page.locator('.f-row .f-name').first()).toHaveText('Aula 07 - Luz natural.pdf')
  await expect(page.locator('.f-row .f-name').last()).toHaveText('Gravação da reunião de pauta.mp4')
  await page.getByRole('button', { name: 'Ver em grade' }).click()
  // PDF abre no leitor; dali, a nota de origem
  await page.locator('.f-tile', { hasText: 'Aula 07' }).click()
  await expect(page.locator('.lightbox .lb-title')).toHaveText(/Aula 07/)
  await page.locator('.lightbox').getByRole('button', { name: 'Abrir nota' }).click()
  await expect(page.locator('#titulo')).toHaveValue('Fotometria: modo manual')
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

test('moodboard: o menu dinâmico mostra também as fotos das notas arquivadas', async ({ page }) => {
  await tab(page, 'Moodboard')
  const tiles = page.locator('.mood-tile')
  await expect(tiles).toHaveCount(15)
  const all = await tiles.count()
  // arquiva a nota da paleta
  await tab(page, 'Notas')
  await cards(page).filter({ hasText: 'Paleta outono' }).first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Arquivar' }).click()
  await tab(page, 'Moodboard')
  await expect(tiles).not.toHaveCount(all)
  await expect(page.locator('.mood-tile', { hasText: 'Paleta outono' })).toHaveCount(0)
  const toggle = page.getByRole('button', { name: 'Mostrar arquivados' })
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  // as da paleta voltam, e as de outra nota que já estava arquivada também aparecem
  await expect(page.locator('.mood-tile', { hasText: 'Paleta outono' }).first()).toBeVisible()
  expect(await tiles.count()).toBeGreaterThan(all)
  await toggle.click()
  await expect(page.locator('.mood-tile', { hasText: 'Paleta outono' })).toHaveCount(0)
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

    await page.locator('.sidebar').getByRole('button', { name: 'Bem-estar 2' }).click()
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
  await page.getByRole('radio', { name: /^Atrio/ }).click()
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

test('quem tinha escolhido a paleta Ideario continua nela, que agora se chama Atrio', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('ideario.palette', 'ideario'))
  await page.reload()
  await openSettings(page)
  await expect(page.getByRole('radio', { name: /^Atrio/ })).toHaveAttribute('aria-checked', 'true')
})

test.describe('visão × filtro', () => {
  const chip = (page: Page, name: string) => page.locator('.filter-row .chip', { hasText: name })
  const tabN = (page: Page, label: string) => page.locator('.tabbar button', { hasText: label }).locator('.tab-n')

  test('o filtro continua ao trocar de visão', async ({ page }) => {
    await chip(page, 'Lumen').click()
    await expect(cards(page)).toHaveCount(4)
    await tab(page, 'Lembretes')
    await expect(page.locator('.r-title')).toHaveText(['Post de lançamento do app', 'Ideias de campanha Q4'])
    await tab(page, 'Arquivos')
    await expect(page.locator('.stats b').first()).toHaveText('5')
    await tab(page, 'Moodboard')
    await expect(page.locator('.mood-tile')).toHaveCount(4)
    await expect(chip(page, 'Lumen')).toHaveClass(/on/)
    await expect(page.locator('#busca')).toHaveAttribute('placeholder', 'Buscar imagens em Lumen')
  })

  test('a visão continua ao trocar de categoria', async ({ page }) => {
    await tab(page, 'Lembretes')
    await chip(page, 'Inglês').click()
    await expect(page.locator('.r-title')).toHaveText(['Phrasal verbs pra revisar'])
    await chip(page, 'Trabalho').click()
    await expect(page.locator('.r-title')).toHaveText(['1:1 com o time — pauta', 'Feedbacks do trimestre'])
    await expect(page.locator('.tabbar button.on')).toContainText('Lembretes')
  })

  test('visão vazia no filtro mostra aviso e mantém o filtro', async ({ page }) => {
    await chip(page, 'Bem-estar').click()
    await expect(tabN(page, 'Lembretes')).toHaveCount(0)
    await tab(page, 'Lembretes')
    await expect(page.locator('.empty h3')).toHaveText('Nenhum lembrete em Bem-estar')
    await expect(chip(page, 'Bem-estar')).toHaveClass(/on/)
    await page.getByRole('button', { name: 'Ver lembretes de tudo' }).click()
    await expect(chip(page, 'Tudo')).toHaveClass(/on/)
    await expect(page.locator('.r-item')).toHaveCount(11)
  })

  test('categoria e tags se combinam e as contagens acompanham', async ({ page }) => {
    await expect(tabN(page, 'Notas')).toHaveCount(0)
    await expect(tabN(page, 'Lembretes')).toHaveText('11')
    await chip(page, 'Lumen').click()
    await expect(tabN(page, 'Lembretes')).toHaveText('2')
    await chip(page, 'Tags').click()
    await page.locator('.sheet .chip', { hasText: '#campanha' }).click()
    await page.getByRole('button', { name: 'Pronto' }).click()
    await expect(cards(page)).toHaveCount(2)
    await expect(tabN(page, 'Lembretes')).toHaveText('2')
    await expect(page.locator('#busca')).toHaveAttribute('placeholder', 'Buscar notas em Lumen · #campanha')
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
    await page.locator('.sidebar').getByRole('button', { name: 'Lumen 4' }).click()
    await expect(page.locator('.filter-title')).toContainText('Lumen')
    await expect(page.locator('.view-switch .lens', { hasText: 'Lembretes' }).locator('.n')).toHaveText('2')
    await page.locator('.view-switch .lens', { hasText: 'Arquivos' }).click()
    await expect(page.locator('.filter-title')).toContainText('Lumen')
    await page.getByRole('button', { name: 'Limpar filtro' }).click()
    await expect(page.locator('.filter-title')).toHaveCount(0)
  })
})

test('desktop: barra superior fixa; lateral fechada vira pílulas de categoria e lembra a escolha', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const menu = await page.getByLabel('Recolher barra lateral').boundingBox()
  const visoes = await page.locator('.view-switch').boundingBox()
  // Aberta, as categorias ficam na lateral (sem pílulas acima das notas).
  await expect(page.locator('.filter-row')).toHaveCount(0)
  await page.getByLabel('Recolher barra lateral').click()
  await expect.poll(async () => (await page.locator('.sidebar').boundingBox())?.width ?? 0).toBe(0)
  // O topo não se move.
  expect(await page.getByLabel('Expandir barra lateral').boundingBox()).toEqual(menu)
  expect(await page.locator('.view-switch').boundingBox()).toEqual(visoes)
  // Fechada, as categorias aparecem em pílulas acima das notas (como na janela média).
  await expect(page.locator('.sidebar').getByRole('button', { name: 'Bem-estar 2' })).toBeHidden()
  await page.locator('.filter-row .chip', { hasText: 'Bem-estar' }).click()
  await expect(cards(page)).toHaveCount(2)
  await page.reload()
  await expect(page.getByLabel('Expandir barra lateral')).toBeVisible()
  await expect(page.locator('.filter-row')).toBeVisible()
  await page.keyboard.press('Control+\\')
  await expect(page.getByLabel('Recolher barra lateral')).toBeVisible()
  await expect(page.locator('.filter-row')).toHaveCount(0)
})

test('ordem das categorias: nome, mais notas ou manual (arrastar e menu); as pílulas seguem a mesma ordem', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const side = () => page.locator('.sidebar [data-cat-row] .grow').allInnerTexts()
  const pills = () => page.locator('.filter-row .chip:has(.dot):not(:has(.dot.none))').allInnerTexts()
  const sorted = [...(await side())].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  expect(await side()).toEqual(sorted)
  const pick = async (label: string) => {
    await page.getByRole('button', { name: /^Ordem das categorias/ }).click()
    await page.getByRole('menuitemradio', { name: label }).click()
  }
  await pick('Mais notas primeiro')
  const counts = (await page.locator('.sidebar [data-cat-row] .count').allInnerTexts()).map(Number)
  expect(counts).toEqual([...counts].sort((a, b) => b - a))
  await pick('Manual (arrastar)')
  const start = await side()
  // Arrastar a última para o topo.
  const rows = page.locator('.sidebar [data-cat-row]')
  const last = (await rows.last().boundingBox())!
  const first = (await rows.first().boundingBox())!
  await page.mouse.move(last.x + 40, last.y + last.height / 2)
  await page.mouse.down()
  await page.mouse.move(last.x + 40, last.y - 10, { steps: 3 })
  await page.mouse.move(first.x + 40, first.y + 4, { steps: 8 })
  await page.mouse.up()
  const dragged = [start.at(-1)!, ...start.slice(0, -1)]
  await expect.poll(side).toEqual(dragged)
  // Mover para baixo pelo menu.
  await rows.first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Mover para baixo' }).click()
  const moved = [dragged[1], dragged[0], ...dragged.slice(2)]
  await expect.poll(side).toEqual(moved)
  // Lateral fechada: as pílulas seguem a mesma ordem; e a escolha fica depois de recarregar.
  await page.getByLabel('Recolher barra lateral').click()
  await expect.poll(pills).toEqual(moved)
  // A escolha da ordem fica no aparelho (o mock recomeça os dados ao recarregar; no app a ordem fica no banco).
  await page.reload()
  await page.getByLabel('Expandir barra lateral').click()
  await expect(page.getByRole('button', { name: 'Ordem das categorias: Manual (arrastar)' })).toBeVisible()
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
  await expect(page.locator('.filter-row .chip.on', { hasText: 'Bem-estar' })).toHaveCount(1)
  await expect(cards(page)).toHaveCount(2)
})

test('clicar na pílula do lembrete abre o menu do lembrete; o X remove', async ({ page }) => {
  await cards(page).filter({ hasText: 'Comprar pilha' }).click()
  await page.getByRole('button', { name: /Alterar lembrete/ }).click()
  await expect(page.locator('.pop-title')).toHaveText('Lembrar de mim')
  await page.keyboard.press('Escape')
  // status pelo seletor de três cores ao lado da pílula
  await page.locator('.editor').getByRole('radio', { name: 'Em andamento' }).click()
  await expect(page.locator('.editor').getByRole('radio', { name: 'Em andamento' })).toHaveAttribute('aria-checked', 'true')
  await page.locator('.editor').getByRole('radio', { name: 'Concluído' }).click()
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
    await item(page, 'Lumen').click()
    await expect(page.locator('.toast')).toContainText('Movida para Lumen')
    await cards(page).filter({ hasText: 'Horários e estacionamento' }).first().click({ button: 'right' })
    await item(page, 'Fazer uma cópia').click()
    await expect(cards(page).filter({ hasText: 'Horários e estacionamento' })).toHaveCount(2)
  })

  test('card: tirar a categoria ("Sem categoria" ou clicar de novo na marcada); no editor também', async ({ page }) => {
    const card = () => cards(page).filter({ hasText: 'Horários e estacionamento' }).first()
    const pill = () => card().locator('.pill.cat')
    for (const how of ['Sem categoria', 'Lumen']) {
      await card().click({ button: 'right' })
      await item(page, 'Categoria').click()
      await item(page, 'Lumen').click()
      await expect(pill()).toContainText('Lumen')
      await card().click({ button: 'right' })
      await item(page, 'Categoria').click()
      await item(page, how).click()
      await expect(pill()).toHaveCount(0)
    }
    // editor: a marcada, clicada de novo, sai
    await card().click({ button: 'right' })
    await item(page, 'Categoria').click()
    await item(page, 'Lumen').click()
    await card().click()
    await page.locator('#categoria').click()
    await page.getByRole('option', { name: 'Lumen' }).click()
    await expect(page.locator('#categoria')).toContainText('Sem categoria')
    await page.keyboard.press('Escape')
    await expect(pill()).toHaveCount(0)
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
    await page.locator('.sidebar').getByRole('button', { name: 'Inglês 2' }).click({ button: 'right' })
    await item(page, 'Nova nota em Inglês').click()
    await expect(page.locator('#categoria')).toContainText('Inglês')
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

test('arrastar um card até uma categoria da lateral muda a categoria (com Desfazer)', async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 900 })
  const card = () => cards(page).filter({ hasText: 'Horários e estacionamento' })
  const target = page.locator('.sidebar [data-drop-category]', { hasText: 'Lumen' })
  // espera a grade assentar na largura nova (os cards deslizam até o lugar) e rola até o card
  await card().scrollIntoViewIfNeeded()
  let prev = ''
  await expect.poll(async () => {
    const b = JSON.stringify(await card().boundingBox())
    const same = b === prev
    prev = b
    return same
  }).toBe(true)
  const t = (await target.boundingBox())!
  // pega pelo título
  const h = (await card().locator('h3').boundingBox())!
  await page.mouse.move(h.x + 20, h.y + h.height / 2)
  await page.mouse.down()
  await page.mouse.move(h.x + 40, h.y + h.height / 2 + 10, { steps: 3 })
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 12 })
  await expect(target).toHaveClass(/drop-target/)
  await page.mouse.up()
  await expect(page.locator('.toast span')).toHaveText('Movida para Lumen')
  await expect(page.locator('.editor')).toHaveCount(0)
  await expect(card()).toContainText('Lumen')
  await page.locator('.toast').getByRole('button', { name: 'Desfazer' }).click()
  await expect(card()).not.toContainText('Lumen')
})

test('lateral: "Sem categoria" e "Sem tags" filtram; soltar um card em "Sem categoria" tira a categoria', async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 900 })
  const noCat = page.locator('.sidebar .d-item', { hasText: 'Sem categoria' })
  const noTags = page.locator('.sidebar .chip', { hasText: 'Sem tags' })
  // fica por último na lista de categorias, logo antes do separador
  await expect(page.locator('.sidebar .drawer-scroll > .d-item').filter({ hasNot: page.locator('svg') }).last()).toContainText('Sem categoria')
  const nCat = Number(await noCat.locator('.count').textContent())
  expect(nCat).toBeGreaterThan(0)
  await noCat.click()
  await expect(page.locator('.filter-title')).toContainText('Sem categoria')
  await expect(cards(page)).toHaveCount(nCat)
  await expect(cards(page).locator('.pill.cat')).toHaveCount(0)
  // sem tags: os cards não têm tag nenhuma
  const nTags = Number(await noTags.locator('.count').textContent())
  await page.locator('.filter-title').getByRole('button').click()
  await noTags.click()
  await expect(cards(page)).toHaveCount(nTags)
  await expect(cards(page).locator('.pill.tag')).toHaveCount(0)
  // escolher uma tag tira o "Sem tags" (não se combinam)
  await page.locator('.sidebar .chip', { hasText: '#estudo' }).click()
  await expect(noTags).not.toHaveClass(/\bon\b/)
  await expect(page.locator('.filter-bar')).toContainText('#estudo')
  await page.getByRole('button', { name: 'Limpar filtro' }).click()
  // soltar um card com categoria em "Sem categoria"
  const card = () => cards(page).filter({ hasText: 'Horários e estacionamento' })
  await card().scrollIntoViewIfNeeded()
  let prev = ''
  await expect.poll(async () => {
    const b = JSON.stringify(await card().boundingBox())
    const same = b === prev
    prev = b
    return same
  }).toBe(true)
  await expect(card().locator('.pill.cat')).toHaveCount(1)
  const t = (await noCat.boundingBox())!
  const h = (await card().locator('h3').boundingBox())!
  await page.mouse.move(h.x + 20, h.y + h.height / 2)
  await page.mouse.down()
  await page.mouse.move(h.x + 40, h.y + h.height / 2 + 10, { steps: 3 })
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 12 })
  await expect(noCat).toHaveClass(/drop-target/)
  await page.mouse.up()
  await expect(page.locator('.toast span')).toHaveText('Agora sem categoria')
  await expect(card().locator('.pill.cat')).toHaveCount(0)
  await expect(noCat.locator('.count')).toHaveText(String(nCat + 1))
})

test('tag na nota: sugere as que já existem (sem acento), cria nova e Esc só fecha a lista', async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 900 })
  await cards(page).filter({ hasText: 'Ideias de campanha' }).first().click()
  const field = page.getByRole('combobox', { name: 'Nova tag' })
  const list = page.getByRole('listbox', { name: 'Tags que já existem' })
  await field.click()
  // ao focar: as mais usadas, sem as que a nota já tem
  await expect(list).toContainText('Tags usadas')
  await expect(list.getByRole('option', { name: /^estudo/ })).toBeVisible()
  await expect(list.getByRole('option', { name: /^campanha/ })).toHaveCount(0)
  // digitando sem acento acha "referência"; Enter põe a primeira
  await field.fill('referencia')
  await expect(list.getByRole('option').first()).toHaveAttribute('aria-selected', 'true')
  await expect(list.getByRole('option').first()).toContainText('referência')
  await field.press('Enter')
  await expect(page.locator('.ed-tags .pill', { hasText: '#referência' })).toHaveCount(1)
  // pedaço do meio também; setas escolhem
  await field.fill('pron')
  await expect(list.getByRole('option')).toHaveCount(2)
  await field.press('ArrowDown')
  await expect(list.getByRole('option').nth(1)).toContainText('Criar #pron')
  await field.press('ArrowUp')
  await field.press('Tab')
  await expect(page.locator('.ed-tags .pill', { hasText: '#pronúncia' })).toHaveCount(1)
  // tag nova
  await field.fill('Lançamento 2027')
  await expect(list.getByRole('option')).toHaveText(['Criar #lançamento-2027'])
  await field.press('Enter')
  await expect(page.locator('.ed-tags .pill', { hasText: '#lançamento-2027' })).toHaveCount(1)
  // clique numa sugestão
  await field.fill('tipo')
  await list.getByRole('option', { name: /tipografia/ }).click()
  await expect(page.locator('.ed-tags .pill', { hasText: '#tipografia' })).toHaveCount(1)
  // Esc fecha a lista, o editor continua aberto
  await field.fill('x')
  await field.press('Escape')
  await expect(list).toHaveCount(0)
  await expect(page.locator('#corpo')).toBeVisible()
})

test('categoria oculta: some de Tudo e da busca, abre clicando nela; o olho cortado marca', async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 900 })
  const lumen = page.locator('.sidebar .d-item', { hasText: 'Lumen' })
  await expect(cards(page).filter({ hasText: 'Ideias de campanha Q4' })).toHaveCount(1)
  await lumen.click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Ocultar das listas/ }).click()
  await expect(page.locator('.toast span')).toContainText('Lumen oculta')
  await expect(cards(page).filter({ hasText: 'Ideias de campanha Q4' })).toHaveCount(0)
  await expect(lumen.locator('.cat-flag')).toHaveCount(1)
  // busca também não acha
  await page.getByRole('button', { name: 'Buscar' }).click()
  await page.locator('#busca').fill('campanha Q4')
  await expect(cards(page)).toHaveCount(0)
  await page.locator('#busca').fill('')
  // abrir a categoria mostra as notas dela
  await lumen.click()
  await expect(cards(page).filter({ hasText: 'Ideias de campanha Q4' })).toHaveCount(1)
  await lumen.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Mostrar nas listas' }).click()
  await page.locator('.sidebar .d-item', { hasText: 'Tudo' }).click()
  await expect(cards(page).filter({ hasText: 'Ideias de campanha Q4' })).toHaveCount(1)
  await expect(lumen.locator('.cat-flag')).toHaveCount(0)
})

test('categoria com PIN: some de Tudo, abre só com o PIN; bloquear, mudar e tirar o PIN', async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 900 })
  const bemEstar = page.locator('.sidebar .d-item', { hasText: 'Bem-estar' })
  const card = () => cards(page).filter({ hasText: 'Rotina de treino' })
  const pinDialog = page.getByRole('dialog')
  const fill = async (...pins: string[]) => {
    const inputs = pinDialog.locator('input.pin-input')
    for (const [i, p] of pins.entries()) await inputs.nth(i).fill(p)
  }
  await bemEstar.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Proteger com PIN…' }).click()
  await fill('1234', '4321')
  await pinDialog.getByRole('button', { name: 'Proteger' }).click()
  await expect(pinDialog).toContainText('não são iguais')
  await fill('1234', '1234')
  await pinDialog.getByRole('button', { name: 'Proteger' }).click()
  await expect(page.locator('.toast span')).toContainText('Bem-estar protegida com PIN')
  // some de Tudo, mas quem acabou de proteger ainda abre sem PIN
  await expect(card()).toHaveCount(0)
  await bemEstar.click()
  await expect(card()).toHaveCount(1)
  // bloquear: a contagem some, o menu só oferece abrir, e clicar pede o PIN
  await bemEstar.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Bloquear agora' }).click()
  await expect(card()).toHaveCount(0)
  await expect(bemEstar.locator('.count')).toHaveCount(0)
  await bemEstar.click({ button: 'right' })
  await expect(page.getByRole('menuitem')).toHaveText(['Abrir com o PIN…'])
  await page.keyboard.press('Escape')
  await bemEstar.click()
  await fill('0000')
  await pinDialog.getByRole('button', { name: 'Abrir' }).click()
  await expect(pinDialog).toContainText('PIN errado')
  await fill('1234')
  await pinDialog.getByRole('button', { name: 'Abrir' }).click()
  await expect(card()).toHaveCount(1)
  await expect(page.locator('.filter-title')).toContainText('Bem-estar')
  // mudar o PIN pede o atual
  await bemEstar.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Mudar o PIN…' }).click()
  await fill('9999', '5678', '5678')
  await pinDialog.getByRole('button', { name: 'Mudar' }).click()
  await expect(pinDialog).toContainText('não confere')
  await fill('1234', '5678', '5678')
  await pinDialog.getByRole('button', { name: 'Mudar' }).click()
  await expect(page.locator('.toast span')).toHaveText('PIN mudado')
  // tirar o PIN: volta para Tudo
  await bemEstar.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Tirar o PIN…' }).click()
  await fill('5678')
  await pinDialog.getByRole('button', { name: 'Tirar o PIN' }).click()
  await page.locator('.sidebar .d-item', { hasText: 'Tudo' }).click()
  await expect(card()).toHaveCount(1)
})

test('categoria da nota: em janela baixa a lista cabe na tela e rola até a última opção', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 520 })
  await cards(page).filter({ hasText: 'Mercado da semana' }).first().click()
  await page.locator('#categoria').click()
  const list = page.getByRole('listbox')
  await expect(list).toBeVisible()
  // depois da animação de abrir: inteira dentro da janela
  await expect.poll(async () => (await list.boundingBox())!.y).toBeGreaterThanOrEqual(0)
  const box = (await list.boundingBox())!
  expect(box.y + box.height).toBeLessThanOrEqual(520)
  // a última opção dá para alcançar rolando a lista
  const last = page.getByRole('option', { name: 'Nova categoria' })
  await last.scrollIntoViewIfNeeded()
  await expect(last).toBeInViewport()
  await last.click()
  await expect(page.getByLabel('Nome', { exact: true })).toBeVisible()
})

test('emoji de capa: escolher pela busca em português, aparece grande no card; mudar pelo menu e remover', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  // nota de exemplo que já tem emoji
  await expect(cards(page).filter({ hasText: 'Pão de fermentação natural' }).locator('.card-emoji')).toHaveText('🍞')
  await cards(page).filter({ hasText: 'Mercado da semana' }).first().click()
  // sem emoji, nada ocupa espaço acima do título; o seletor abre pelo menu ⋮
  const titleOffset = () =>
    page.locator('#titulo').evaluate((t) => {
      const sc = t.closest('.ed-scroll')!
      return t.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop
    })
  const titleTop = await titleOffset()
  expect(titleTop).toBeLessThan(16)
  await page.getByRole('button', { name: 'Mais opções' }).click()
  await page.getByRole('menuitem', { name: 'Emoji de capa' }).click()
  const search = page.getByLabel('Buscar emoji')
  await expect(search).toBeFocused()
  await search.fill('carrinho')
  await expect(page.getByRole('option', { name: /carrinho de compras/ })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Mudar o emoji de capa' })).toHaveText('🛒')
  await back(page)
  const card = cards(page).filter({ hasText: 'Mercado da semana' }).first()
  await expect(card.locator('.card-emoji')).toHaveText('🛒')
  // emoji colado direto na busca (ou pelo seletor do sistema); pelo menu ⋮
  await card.click()
  await page.getByRole('button', { name: 'Mais opções' }).click()
  await page.getByRole('menuitem', { name: 'Mudar emoji de capa' }).click()
  // o nome vem antes das palavras-chave: "foguete" é o 🚀, não o astronauta
  await search.fill('foguete')
  await expect(page.locator('.emoji-pop .emoji-cell').first()).toHaveText('🚀')
  await search.fill('🦊')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Mudar o emoji de capa' })).toHaveText('🦊')
  // recentes guardam os últimos
  await page.getByRole('button', { name: 'Mudar o emoji de capa' }).click()
  await expect(page.locator('.emoji-pop .emoji-group').first()).toHaveText('Recentes')
  await page.getByRole('button', { name: 'Remover emoji' }).click()
  await expect(page.getByRole('button', { name: 'Mudar o emoji de capa' })).toHaveCount(0)
  expect(Math.abs((await titleOffset()) - titleTop)).toBeLessThan(2)
  await back(page)
  await expect(card.locator('.card-emoji')).toHaveCount(0)
})

test('modo documento: a nota vira página inteira, e ela lembra; imprimir deixa só a nota no papel', async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 900 })
  await cards(page).filter({ hasText: 'Ideias de campanha Q4' }).first().click()
  const ed = page.locator('.editor')
  expect((await ed.boundingBox())!.width).toBeLessThan(800)
  await page.getByRole('button', { name: 'Abrir como documento' }).click()
  await expect(ed).toHaveAttribute('data-doc', '')
  expect((await ed.boundingBox())!.width).toBe(1300)
  // a coluna do texto fica no meio, com largura de leitura
  const body = (await page.locator('#corpo').boundingBox())!
  expect(body.width).toBeLessThanOrEqual(780)
  expect(Math.abs(body.x + body.width / 2 - 650)).toBeLessThan(40)
  // fechar e abrir de novo: continua documento
  await back(page)
  await cards(page).filter({ hasText: 'Ideias de campanha Q4' }).first().click()
  await expect(ed).toHaveAttribute('data-doc', '')
  // Exportar no menu (no navegador, só o PDF; Markdown e HTML são do app)
  await page.getByRole('button', { name: 'Mais opções' }).click()
  await page.getByRole('menuitem', { name: 'Exportar' }).click()
  await expect(page.getByRole('menuitem', { name: 'PDF (imprimir)' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(ed).toBeVisible()
  // impressão: só a nota, sem a barra, as ferramentas e o resto do app
  await page.evaluate(() => document.body.classList.add('print-note'))
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.shell')).toBeHidden()
  await expect(page.locator('.ed-top')).toBeHidden()
  await expect(page.locator('.ed-tools').first()).toBeHidden()
  // o topo do papel é o card da nota (Atrio 0.22.0): o título inteiro como texto, no lugar do campo (que cortava)
  await expect(page.locator('#titulo')).toBeHidden()
  await expect(page.locator('.ed-print-card .pc-title')).toHaveText('Ideias de campanha Q4')
  await expect(page.locator('.ed-print-card .pc-pills')).toContainText('#campanha')
  await expect(page.locator('.editor')).toHaveCSS('position', 'static')
  await page.emulateMedia({ media: 'screen' })
  await expect(page.locator('.ed-print-card')).toBeHidden()
  await page.evaluate(() => document.body.classList.remove('print-note'))
  await page.getByRole('button', { name: 'Voltar ao card' }).click()
  await expect(ed).not.toHaveAttribute('data-doc', '')
})

test('bloco de link: colar o endereço numa linha vazia vira cartão com prévia; também pelo "+"', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.evaluate(() => {
    ;(window as unknown as { opened: string[] }).opened = []
    window.open = ((u: string) => {
      ;(window as unknown as { opened: string[] }).opened.push(u)
      return null
    }) as typeof window.open
  })
  await newNote(page)
  await page.locator('#titulo').fill('Leituras')
  await page.locator('#corpo').click()
  // colar um endereço sozinho numa linha vazia
  await page.locator('#corpo').evaluate((el) => {
    const dt = new DataTransfer()
    dt.setData('text/plain', 'https://www.exemplo.com.br/artigo')
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  })
  const card = page.locator('#corpo .link-card')
  await expect(card).toHaveCount(1)
  await expect(card.locator('.lc-title')).toHaveText('Página de exemplo.com.br')
  await expect(card.locator('.lc-site')).toHaveText('exemplo.com.br')
  await expect(card.locator('.lc-desc')).toContainText('Prévia de exemplo')
  // o cursor fica na linha de baixo: digitar não apaga o cartão; colado no meio do texto, continua texto
  await page.keyboard.type('veja ')
  await page.locator('#corpo').evaluate((el) => {
    const dt = new DataTransfer()
    dt.setData('text/plain', 'https://outro.org/x')
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  })
  await expect(card).toHaveCount(1)
  await expect(page.locator('#corpo')).toContainText('veja https://outro.org/x')
  // pelo "+": Link…
  await page.getByRole('button', { name: 'Inserir' }).click()
  await page.getByRole('menuitem', { name: 'Link…' }).click()
  await page.getByLabel('Endereço (https://…)').fill('wikipedia.org')
  await page.keyboard.press('Enter')
  await expect(card).toHaveCount(2)
  await expect(card.nth(1).locator('.lc-title')).toHaveText('Página de wikipedia.org')
  // clicar abre no navegador; o menu do bloco tem as ações do link
  await card.first().click()
  expect(await page.evaluate(() => (window as unknown as { opened: string[] }).opened)).toEqual(['https://www.exemplo.com.br/artigo'])
  await card.first().click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Abrir link' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Copiar endereço' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Atualizar prévia' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menuitem', { name: 'Abrir link' })).toHaveCount(0)
  // no card da lista: o link aparece na prévia; a busca acha pelo título da página
  await back(page)
  const c = cards(page).filter({ hasText: 'Leituras' })
  await expect(c.locator('.pv-link').first()).toContainText('Página de exemplo.com.br')
  await page.getByRole('button', { name: 'Buscar' }).first().click()
  await page.keyboard.type('wikipedia')
  await expect(cards(page).filter({ hasText: 'Leituras' })).toHaveCount(1)
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
    await expect(page.locator('.section-label')).toContainText(['Fixadas', 'Aurora', 'Inglês', 'Trabalho', 'Bem-estar', 'Lumen', 'Curso', 'Sem categoria'])
    await page.reload()
    await expect(page.locator('.section-label', { hasText: 'Aurora' })).toHaveCount(1)
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

test('desktop: visões logo depois do ☰; busca fixa na ponta direita e as ações da visão à esquerda dela', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!
  const same = (a: { x: number; width: number }, b: { x: number; width: number }) => {
    expect(a.x).toBeCloseTo(b.x, 0)
    expect(a.x + a.width).toBeCloseTo(b.x + b.width, 0)
  }
  // mede depois que as contagens chegaram (o número de Lembretes muda a largura das visões)
  await expect(page.locator('.view-switch .n')).toHaveText(/\d/)
  const views = await box('.view-switch')
  const nav = await box('.nav-btn')
  expect(views.x).toBeCloseTo(nav.x + nav.width + 6, 0)
  const actions = await box('.top-actions')
  expect(actions.x + actions.width).toBeCloseTo(1280 - 14, 0)
  const sort = await box('.top-actions [aria-label^="Ordenar"]')
  const lupa = await box('.top-actions [aria-label="Buscar"]')
  // A busca é o item fixo da ponta direita; as ações da visão ficam à esquerda dela (o campo aberto as empurra).
  expect(lupa.x).toBeGreaterThan(sort.x)
  const still = async () => {
    same(await box('.view-switch'), views)
    expect((await box('.top-actions [aria-label^="Ordenar"]')).x).toBeLessThan(sort.x)
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
  same(await box('.view-switch'), views)
  same(await box('.top-actions [aria-label^="Ordenar"]'), sort)
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
  expect((await pdf).suggestedFilename()).toBe('Manual de marca Lumen v3.pdf')
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

  test('arrastar uma foto para entre dois parágrafos a leva para lá (linha mostra onde); clique só seleciona', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await newNote(page)
    await page.keyboard.type('Primeiro')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Segundo')
    const photo = page.locator('.editor input[type=file][accept="image/*"]')
    await photo.setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: png })
    const img = page.locator('#corpo > img')
    await expect(img).toHaveCount(1)
    const order = () => page.locator('#corpo > *').evaluateAll((els) => els.map((e) => (e.tagName === 'IMG' ? 'foto' : e.textContent)).filter(Boolean))
    await expect.poll(order).toEqual(['Primeiro', 'Segundo', 'foto'])
    // clique sem mover: seleciona a foto (aparecem os botões dela), nada sai do lugar
    await img.click()
    await expect(page.getByRole('button', { name: 'Remover foto' })).toBeVisible()
    await expect.poll(order).toEqual(['Primeiro', 'Segundo', 'foto'])
    // arrastar até a metade de cima do "Segundo"
    const b = (await img.boundingBox())!
    const second = (await page.locator('#corpo > p', { hasText: 'Segundo' }).boundingBox())!
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - 10)
    await page.mouse.move(second.x + 40, second.y + 3, { steps: 8 })
    await expect(page.locator('.photo-drop-line')).toBeVisible()
    await page.mouse.up()
    await expect(page.locator('.photo-drop-line')).toHaveCount(0)
    await expect.poll(order).toEqual(['Primeiro', 'foto', 'Segundo'])
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
    await dropFiles(page, '.editor textarea[placeholder="Título"]', [{ name: 'planilha.csv', type: 'text/csv', text: 'a,b' }])
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

test('lembrete que se repete: marcar como feito vale para esta vez e a série continua', async ({ page }) => {
  await cards(page).filter({ hasText: 'Referências tipográficas' }).click()
  await page.getByLabel('Lembrete', { exact: true }).click()
  await page.locator('.quick button', { hasText: 'Amanhã de manhã' }).click()
  await page.getByLabel(/^Alterar lembrete/).click()
  await page.locator('#lembrete-repetir').click()
  await page.getByRole('option', { name: 'Todo dia' }).click()
  await page.keyboard.press('Escape')
  await back(page)
  await tab(page, 'Lembretes')
  const item = page.locator('.r-item', { hasText: 'Referências tipográficas' })
  await expect(item.locator('.r-time')).toContainText('09:00')
  await item.getByRole('radio', { name: 'Concluído' }).click()
  await expect(page.locator('.toast span')).toHaveText('Feito por esta vez')
  // continua na lista, não concluído, no dia seguinte
  await expect(item).not.toHaveClass(/done/)
  await expect(item.locator('[aria-label="se repete"]')).toBeVisible()
})

test('lembrete de nota arquivada continua em Lembretes', async ({ page }) => {
  const note = () => cards(page).filter({ hasText: 'Referências tipográficas' })
  await note().click()
  await page.getByLabel('Lembrete', { exact: true }).click()
  await page.locator('.quick button', { hasText: 'Amanhã de manhã' }).click()
  await page.getByLabel('Mais opções').click()
  await page.getByRole('menuitem', { name: 'Arquivar' }).click()
  await expect(note()).toHaveCount(0)
  await tab(page, 'Lembretes')
  await expect(page.locator('.r-item', { hasText: 'Referências tipográficas' })).toHaveCount(1)
})

test('configurações só mostram o que funciona', async ({ page }) => {
  await openSettings(page)
  await expect(page.locator('.sheet-title')).toHaveText('Configurações')
  await expect(page.getByText('Trazer notas do Google Keep')).toHaveCount(0)
  await expect(page.getByRole('slider')).toHaveCount(0)
  await expect(page.locator('.footnote')).toHaveText('Prévia no navegador · dados de exemplo')
})

test('configurações: ligar o Ideario no Claude Desktop e o comando do Claude Code', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openSettings(page)
  const desktop = page.locator('.set-row', { hasText: 'Claude Desktop' })
  await expect(desktop).toContainText('Deixa o Claude ler, criar e organizar')
  await desktop.getByRole('button', { name: 'Ligar' }).click()
  await expect(page.locator('.toast')).toContainText('Ligado no Claude Desktop')
  await expect(desktop.getByRole('button', { name: 'Desligar' })).toBeVisible()
  await expect(desktop).toContainText('Ligado: no Claude')
  const code = page.locator('.mcp-code code')
  await expect(code).toHaveText(/^claude mcp add --scope user ideario -- ".+" --mcp$/)
  await page.getByRole('button', { name: 'Copiar comando' }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/^claude mcp add/)
  await desktop.getByRole('button', { name: 'Desligar' }).click()
  await expect(desktop.getByRole('button', { name: 'Ligar' })).toBeVisible()
})

test('câmera: "+" → Câmera abre a nota nova com a câmera ligada; tirar a foto põe na nota', async ({ page, context }) => {
  await context.grantPermissions(['camera'])
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.getByRole('button', { name: 'Criar' }).click()
  await page.getByRole('menuitem', { name: 'Câmera' }).click()
  const cam = page.locator('.camera')
  await expect(cam).toBeVisible()
  // o vídeo da câmera chega (dispositivo falso do navegador de teste)
  await expect.poll(() => cam.locator('video').evaluate((v: HTMLVideoElement) => v.videoWidth)).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Tirar foto' }).click()
  await expect(cam).toHaveCount(0)
  await expect(page.locator('#corpo img')).toHaveCount(1)
  // pelo "+" do editor também
  await page.getByRole('button', { name: 'Inserir' }).click()
  await page.getByRole('menuitem', { name: 'Câmera' }).click()
  await expect(cam).toBeVisible()
  await expect.poll(() => cam.locator('video').evaluate((v: HTMLVideoElement) => v.videoWidth)).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Tirar foto' }).click()
  await expect(page.locator('#corpo img')).toHaveCount(2)
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
    const h = (await page.locator('.blk-handle.item').boundingBox())!
    const t = (await items(page).nth(0).boundingBox())!
    await page.mouse.move(h.x + 8, h.y + 10)
    await page.mouse.down()
    await page.mouse.move(h.x + 20, h.y, { steps: 3 })
    await page.mouse.move(t.x + 60, t.y + 3, { steps: 8 })
    // a linha mostra onde vai cair: em cima do primeiro item
    const line = (await page.locator('.blk-drop').boundingBox())!
    expect(Math.abs(line.y - t.y)).toBeLessThan(6)
    await page.mouse.up()
    await expect(page.locator('.blk-drop')).toHaveCount(0)
    await expect(items(page).first()).toContainText('Repelente')
    // soltar e clicar sem mover continua abrindo o menu (não vira arraste)
    await items(page).nth(1).hover()
    await page.locator('.blk-handle.item').click()
    await expect(page.getByRole('menuitem', { name: 'Diminuir recuo' })).toBeVisible()
    await page.keyboard.press('Escape')
  })

  test('arrastar pela alça leva o subitem para outro nível e para o fim da lista', async ({ page }) => {
    await back(page)
    await newNote(page)
    await page.getByRole('button', { name: 'Checklist' }).click()
    for (const [t, tab] of [['Viagem', false], ['Passaporte', true], ['Casa', false]] as const) {
      if (tab) await page.keyboard.press('Tab')
      await page.keyboard.type(t)
      await page.keyboard.press('Enter')
      if (tab) await page.keyboard.press('Shift+Tab')
    }
    await page.keyboard.press('Backspace')
    const top = page.locator('#corpo > ul[data-type="taskList"] > li')
    await expect(top).toHaveCount(2)
    // o subitem "Passaporte" vai para depois de "Casa", no primeiro nível
    const src = (await page.locator('#corpo').getByText('Passaporte', { exact: true }).boundingBox())!
    await page.mouse.move(src.x + 10, src.y + src.height / 2)
    const h = (await page.locator('.blk-handle.item').boundingBox())!
    const dst = (await page.locator('#corpo').getByText('Casa', { exact: true }).boundingBox())!
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2)
    await page.mouse.down()
    await page.mouse.move(h.x + 10, dst.y + dst.height - 2, { steps: 10 })
    await page.mouse.up()
    await expect(top).toHaveCount(3)
    await expect(top.nth(2)).toContainText('Passaporte')
    await expect(page.locator('#corpo ul[data-type="taskList"] ul')).toHaveCount(0)
  })

  test('uma alça só: no checklist ela é do item; a checklist inteira fica no menu dele', async ({ page }) => {
    await items(page).nth(1).hover()
    await expect(page.locator('.blk-handle')).toHaveCount(1)
    await expect(page.locator('.blk-handle')).toHaveClass(/item/)
    // a alça fica logo à esquerda da caixinha do item, na altura dele
    const h = (await page.locator('.blk-handle').boundingBox())!
    const box = (await items(page).nth(1).locator('input[type="checkbox"]').boundingBox())!
    expect(h.x + h.width).toBeLessThanOrEqual(box.x + 1)
    expect(Math.abs(h.y + h.height / 2 - (box.y + box.height / 2))).toBeLessThan(6)
    await page.locator('.blk-handle').click()
    await page.getByRole('menuitem', { name: 'Checklist inteira' }).click()
    await page.getByRole('menuitem', { name: 'Marcar todos', exact: true }).click()
    await expect(page.locator('#corpo ul[data-type="taskList"] > li[data-checked="false"]')).toHaveCount(0)
    await items(page).nth(1).hover()
    await page.locator('.blk-handle').click()
    await page.getByRole('menuitem', { name: 'Checklist inteira' }).click()
    // o "Mover para cima" do submenu (a checklist), não o do item
    await page.getByRole('menuitem', { name: 'Mover para cima' }).last().click()
    await expect(page.locator('#corpo > *').first()).toHaveAttribute('data-type', 'taskList')
  })

  test('subitens no checklist: Tab recua, Shift+Tab volta; marcar o item marca os subitens', async ({ page }) => {
    await back(page)
    await newNote(page)
    await page.getByRole('button', { name: 'Checklist' }).click()
    await page.keyboard.type('Viagem')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Tab')
    await page.keyboard.type('Passaporte')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Tab')
    await page.keyboard.type('Renovar')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.type('Casa')
    const nested = page.locator('#corpo ul[data-type="taskList"] ul[data-type="taskList"]')
    await expect(nested.first()).toContainText('Passaporte')
    await expect(nested.locator('ul[data-type="taskList"]')).toContainText('Renovar')
    await expect(page.locator('#corpo > ul[data-type="taskList"] > li')).toHaveCount(2)
    // marcar "Viagem" marca os dois níveis de baixo; "Casa" fica
    await page.locator('#corpo > ul[data-type="taskList"] > li').first().locator('> label input').check()
    await expect(page.locator('#corpo li[data-checked="true"]')).toHaveCount(3)
    await expect(page.locator('#corpo > ul[data-type="taskList"] > li').nth(1)).toHaveAttribute('data-checked', 'false')
    // o card mostra os níveis recuados
    await back(page)
    const card = cards(page).filter({ hasText: 'Passaporte' })
    await expect(card.locator('.pv-task', { hasText: 'Renovar' })).toHaveAttribute('style', /--depth: 2/)
  })

  test('a alça do subitem fica no subitem quando o mouse vai até ela (não pula para o item de cima)', async ({ page }) => {
    await back(page)
    await newNote(page)
    await page.getByRole('button', { name: 'Checklist' }).click()
    await page.keyboard.type('Viagem')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Tab')
    await page.keyboard.type('Passaporte')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Tab')
    await page.keyboard.type('Renovar')
    const handle = page.locator('.blk-handle.item')
    for (const name of ['Passaporte', 'Renovar']) {
      const row = (await page.locator('#corpo').getByText(name, { exact: true }).boundingBox())!
      const y = row.y + row.height / 2
      // em cima do texto: a alça aparece na linha do subitem
      await page.mouse.move(row.x + 20, y)
      await expect(handle).toBeVisible()
      const h = (await handle.boundingBox())!
      expect(Math.abs(h.y + h.height / 2 - y)).toBeLessThan(14)
      // indo para a esquerda, na mesma linha, até a alça (passando pela coluna do item de cima): ela não sai do lugar
      for (const x of [row.x - 10, row.x - 40, h.x + h.width / 2]) {
        await page.mouse.move(x, y, { steps: 3 })
        const now = (await handle.boundingBox())!
        expect(Math.abs(now.y - h.y), `x=${x}`).toBeLessThan(2)
        expect(Math.abs(now.x - h.x), `x=${x}`).toBeLessThan(2)
      }
    }
    // o menu da alça é o do subitem: "Diminuir recuo" sobe o Renovar para o nível do Passaporte
    await handle.click()
    await page.getByRole('menuitem', { name: 'Diminuir recuo' }).click()
    const nested = page.locator('#corpo ul[data-type="taskList"] ul[data-type="taskList"]')
    await expect(nested).toHaveCount(1)
    await expect(nested.locator('> li')).toHaveCount(2)
    await expect(nested.locator('> li').nth(1)).toContainText('Renovar')
  })

  test('Ctrl+A numa nota que é só checklist seleciona tudo, à vista; apagar limpa a nota', async ({ page }) => {
    await back(page)
    await newNote(page)
    await page.getByRole('button', { name: 'Checklist' }).click()
    await page.keyboard.type('Arroz')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Tab')
    await page.keyboard.type('Integral')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.type('Café')
    await page.locator('#corpo li p', { hasText: 'Integral' }).click()
    await page.keyboard.press('ControlOrMeta+a')
    // a seleção do navegador (o que aparece destacado) cobre todos os itens e continua lá depois de soltar a tecla
    await page.waitForTimeout(100)
    const shown = await page.evaluate(() => getSelection()?.toString() ?? '')
    for (const t of ['Arroz', 'Integral', 'Café']) expect(shown).toContain(t)
    await page.keyboard.press('Backspace')
    await expect(page.locator('#corpo li')).toHaveCount(0)
    await expect(page.locator('#corpo')).toHaveText('')
  })

  test('menu do item: aumentar e diminuir o recuo', async ({ page }) => {
    await items(page).nth(1).hover()
    await page.locator('.blk-handle').click()
    await expect(page.getByRole('menuitem', { name: 'Diminuir recuo' })).toBeDisabled()
    await page.getByRole('menuitem', { name: 'Aumentar recuo' }).click()
    await expect(page.locator('#corpo ul[data-type="taskList"] ul[data-type="taskList"] > li')).toHaveCount(1)
    await page.locator('#corpo ul[data-type="taskList"] ul[data-type="taskList"] > li').hover()
    await page.locator('.blk-handle').click()
    await page.getByRole('menuitem', { name: 'Diminuir recuo' }).click()
    await expect(page.locator('#corpo ul[data-type="taskList"] ul[data-type="taskList"]')).toHaveCount(0)
  })

  test('transformar em: todas as formas funcionam, sem perder texto nem os níveis', async ({ page }) => {
    await back(page)
    await newNote(page)
    await page.getByRole('button', { name: 'Lista', exact: true }).click()
    await page.keyboard.type('um')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Tab')
    await page.keyboard.type('dois')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.type('três')
    const first = page.locator('#corpo > *').first()
    const shape = () => first.evaluate((e) => e.getAttribute('data-type') ?? e.tagName.toLowerCase())
    /** Abre "Transformar em" do bloco (numa lista, pelo submenu da lista inteira) e escolhe `to`. */
    const to = async (label: string) => {
      const item = first.locator('li').first()
      if (await item.count()) {
        await item.locator('p').first().hover()
        await page.locator('.blk-handle').click()
        await page.getByRole('menuitem', { name: /^(Lista|Checklist) inteira$/ }).click()
      } else {
        await first.hover()
        await page.locator('.blk-handle').click()
      }
      await page.getByRole('menuitem', { name: 'Transformar em' }).last().click()
      await page.getByRole('menuitemcheckbox', { name: label, exact: true }).or(page.getByRole('menuitem', { name: label, exact: true })).last().click()
    }
    const text = () => page.locator('#corpo').innerText()
    // marcadores → checklist: mantém o subitem
    await to('Checklist')
    expect(await shape()).toBe('taskList')
    await expect(page.locator('#corpo ul[data-type="taskList"] ul[data-type="taskList"]')).toContainText('dois')
    // checklist → marcadores, de volta
    await to('Lista')
    expect(await shape()).toBe('ul')
    await expect(page.locator('#corpo > ul > li li')).toContainText('dois')
    // lista → texto: uma linha por item
    await to('Texto')
    expect(await shape()).toBe('p')
    await expect(page.locator('#corpo > p')).toHaveCount(3)
    // texto → título, título → código, código → checklist
    await to('Título')
    expect(await shape()).toBe('h3')
    await to('Código')
    expect(await shape()).toBe('pre')
    await expect(page.locator('#corpo pre')).toContainText('um')
    await to('Checklist')
    expect(await shape()).toBe('taskList')
    for (const w of ['um', 'dois', 'três']) expect(await text()).toContain(w)
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

test('versão nova do app: aviso no canto, atualizar mostra o progresso; "Depois" esconde', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ideario.mock.update', '0.9.0'))
  await page.reload()
  const notice = page.locator('.update-alerts')
  await expect(notice).toContainText('Ideario 0.9.0 disponível', { timeout: 8000 })
  await notice.getByRole('button', { name: 'Depois' }).click()
  await expect(notice).toHaveCount(0)
  await page.reload()
  await expect(notice).toBeVisible({ timeout: 8000 })
  await notice.getByRole('button', { name: 'Atualizar' }).click()
  await expect(notice).toContainText('Baixando… 100%')
  await expect(notice.getByRole('button')).toHaveCount(0)
})

test.describe('Android: compartilhar com o Ideario', () => {
  const share = (page: Page, shared: object) =>
    page.addInitScript((v) => {
      if (sessionStorage.getItem('shared-once')) return
      sessionStorage.setItem('shared-once', '1')
      localStorage.setItem('ideario.mock.shared', JSON.stringify(v))
      document.addEventListener('readystatechange', () => (document.documentElement.dataset.platform = 'android'))
    }, shared)

  test('um link vira nota com o cartão do link e o assunto no título', async ({ page }) => {
    await share(page, { subject: 'Receita de pão', text: 'https://exemplo.com/pao', files: [] })
    await page.reload()
    await expect(page.locator('#titulo')).toHaveValue('Receita de pão')
    await expect(page.locator('#corpo .link-card')).toHaveCount(1)
    await expect(page.locator('#corpo .link-card')).toContainText('exemplo.com')
  })

  test('texto vira parágrafos de uma nota nova (uma vez só)', async ({ page }) => {
    await share(page, { text: 'Comprar café\nLigar para a oficina', files: [] })
    await page.reload()
    await expect(page.locator('#corpo p')).toHaveText(['Comprar café', 'Ligar para a oficina'])
    await page.keyboard.press('Escape')
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await expect(page.locator('#titulo')).toHaveCount(0)
  })
})

test('Android: o Voltar fecha a nota aberta, e fechar pela tela não deixa entrada sobrando', async ({ page }) => {
  await page.addInitScript(() =>
    document.addEventListener('readystatechange', () => (document.documentElement.dataset.platform = 'android')),
  )
  await page.reload()
  await cards(page).filter({ hasText: 'Mercado da semana' }).click()
  await expect(page.locator('#titulo')).toHaveValue('Mercado da semana')
  await page.goBack()
  await expect(page.locator('#titulo')).toHaveCount(0)
  await expect(cards(page).first()).toBeVisible()
  // fechar pela tela também tira a entrada extra: o Voltar seguinte não fica "preso"
  await cards(page).filter({ hasText: 'Mercado da semana' }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('#titulo')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => history.state?.ideario ?? null)).toBeNull()
})

test('sem versão nova, nenhum aviso de atualização', async ({ page }) => {
  await page.waitForTimeout(5500)
  await expect(page.locator('.update-alerts')).toHaveCount(0)
})

test('texto da interface não se seleciona; no editor, sim', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const selected = () => page.evaluate(() => window.getSelection()?.toString() ?? '')
  await page.locator('.lens').first().dblclick()
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
    const lumen = side(page).locator('.d-item', { hasText: 'Lumen' })
    await lumen.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Apagar categoria' }).click()
    await expect(lumen).toHaveCount(0)
    await expect(page.locator('.card', { hasText: 'Ideias de campanha Q4' })).toHaveCount(1)
    await page.locator('.toast').getByRole('button', { name: 'Desfazer' }).click()
    await expect(side(page).locator('.d-item', { hasText: 'Lumen' }).locator('.count')).toHaveText('4')
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

test.describe('celular (toque)', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 800 } })

  // Puxar a lista com o dedo: eventos de toque de verdade (touchstart/move/end) no topo da área que rola.
  async function pullDown(page: Page, distance: number) {
    await page.evaluate(async (distance) => {
      const el = document.querySelector('main.content') as HTMLElement
      const r = el.getBoundingClientRect()
      const x = r.left + r.width / 2
      const y0 = r.top + 40
      const touch = (y: number) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y })
      const fire = (type: string, y: number) =>
        el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [touch(y)], changedTouches: [touch(y)] }))
      fire('touchstart', y0)
      for (let i = 1; i <= 10; i++) {
        fire('touchmove', y0 + (distance * i) / 10)
        await new Promise((r) => setTimeout(r, 16))
      }
      fire('touchend', y0 + distance)
    }, distance)
  }

  test('puxar a lista para baixo sincroniza; um puxão curto não', async ({ page }) => {
    await expect(cards(page).first()).toBeVisible()
    // Curto (menos que o limite): o círculo some sem girar.
    await pullDown(page, 60)
    await expect(page.locator('.pull-icon.spin')).toHaveCount(0)
    await expect(page.locator('.pull')).toHaveCount(0)
    // Comprido: gira enquanto sincroniza e some quando termina.
    await pullDown(page, 220)
    await expect(page.locator('.pull-icon.spin')).toBeVisible()
    await expect(page.locator('.pull')).toHaveCount(0, { timeout: 8000 })
  })

  test('a alça do bloco fica onde está o cursor: tocar abre o menu, arrastar reordena', async ({ page }) => {
    await cards(page).filter({ hasText: 'Viagem para Paraty' }).first().tap()
    const items = page.locator('#corpo ul[data-type="taskList"] > li')
    await expect(items.first()).toBeVisible()
    // Sem mouse não há "passar por cima": a alça só aparece com o cursor no texto, ao lado do item dele.
    await expect(page.locator('.blk-handle')).toHaveCount(0)
    await items.nth(2).locator('p').tap()
    const h = page.locator('.blk-handle.item')
    await expect(h).toBeVisible()
    const [hb, ib] = [(await h.boundingBox())!, (await items.nth(2).boundingBox())!]
    expect(hb.x + hb.width).toBeLessThanOrEqual(ib.x + 2)
    expect(Math.abs(hb.y - ib.y)).toBeLessThan(12)
    // Tocar na alça abre o menu do item, sem tirar o cursor do texto.
    await h.tap()
    await expect(page.getByRole('menuitem', { name: 'Diminuir recuo' })).toBeVisible()
    await page.keyboard.press('Escape')
    const third = await items.nth(2).locator('p').innerText()
    // Arrastar com o dedo (eventos de ponteiro do tipo toque) leva o item para o topo.
    await items.nth(2).locator('p').tap()
    const box = (await h.boundingBox())!
    const top = (await items.first().boundingBox())!
    await page.evaluate(
      ({ x, y, ty }) => {
        const handle = document.querySelector('.blk-handle')!
        const ev = (type: string, cx: number, cy: number) =>
          new PointerEvent(type, { pointerType: 'touch', isPrimary: true, button: 0, buttons: 1, clientX: cx, clientY: cy, bubbles: true, cancelable: true })
        handle.dispatchEvent(ev('pointerdown', x, y))
        for (const yy of [y - 10, y - 30, ty + 3]) window.dispatchEvent(ev('pointermove', x + 30, yy))
        window.dispatchEvent(ev('pointerup', x + 30, ty + 3))
      },
      { x: box.x + box.width / 2, y: box.y + box.height / 2, ty: top.y },
    )
    await expect(items.first().locator('p')).toHaveText(third)
  })

  test('submenu do menu de contexto abre no lugar do menu, dentro da tela', async ({ page }) => {
    await cards(page).filter({ hasText: 'Mercado da semana' }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Cor' }).click()
    const menu = page.locator('.menu.ctx')
    await expect(menu).toHaveCount(1)
    await expect(page.getByRole('menuitem', { name: 'Abrir' })).toHaveCount(0)
    const box = (await menu.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    // A linha de cima volta ao menu.
    await page.locator('.menu-back').click()
    await expect(page.getByRole('menuitem', { name: 'Abrir' })).toBeVisible()
    // Escolher no submenu fecha o menu e aplica.
    await page.getByRole('menuitem', { name: 'Cor' }).click()
    await menu.getByRole('menuitem').nth(3).click()
    await expect(menu).toHaveCount(0)
  })

  test('modo documento não aparece no celular', async ({ page }) => {
    await cards(page).first().tap()
    await expect(page.getByLabel('Voltar e salvar')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Abrir como documento' })).toHaveCount(0)
  })
})

test.describe('ID da nota', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] })
  test('o editor mostra o ID curto e copia; o menu do card também', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await cards(page).filter({ hasText: 'Mercado da semana' }).first().click()
    const chip = page.locator('.ed-id')
    await expect(chip).toHaveText(/^#\w{1,8}$/)
    const short = await chip.innerText()
    await chip.click()
    await expect(page.locator('.toast')).toContainText(`ID ${short} copiado`)
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(short)
    await back(page)
    await cards(page).filter({ hasText: 'Mercado da semana' }).first().click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: /Copiar ID/ })).toContainText(short)
  })
})

test.describe('colar no editor', () => {
  const paste = (page: Page, opts: { png?: boolean; html?: string; text?: string }) =>
    page.evaluate(async ({ png, html, text }) => {
      const dt = new DataTransfer()
      if (png) {
        const c = document.createElement('canvas')
        c.width = c.height = 8
        c.getContext('2d')!.fillRect(0, 0, 8, 8)
        const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'))
        dt.items.add(new File([blob], 'print.png', { type: 'image/png' }))
      }
      if (html) dt.setData('text/html', html)
      if (text) dt.setData('text/plain', text)
      document.querySelector('#corpo')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    }, opts)

  test('imagem colada vira foto da nota', async ({ page }) => {
    await newNote(page)
    await page.keyboard.type('Antes da foto')
    await paste(page, { png: true })
    await expect(page.locator('#corpo img')).toHaveCount(1)
  })

  test('trecho de planilha (HTML com imagem junto) cola o texto, não a imagem', async ({ page }) => {
    await newNote(page)
    await paste(page, { png: true, html: '<table><tr><td>Arroz</td><td>2 kg</td></tr></table>', text: 'Arroz\t2 kg' })
    await expect(page.locator('#corpo img')).toHaveCount(0)
    await expect(page.locator('#corpo')).toContainText('Arroz')
  })
})

test.describe('Markdown no editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await newNote(page)
  })

  test('atalhos enquanto escreve: títulos, citação, linha, tachado e código', async ({ page }) => {
    const body = page.locator('#corpo')
    for (const line of ['# Grande', '## Médio', '### Pequeno', '> Citação']) {
      await page.keyboard.type(line)
      await page.keyboard.press('Enter')
      if (line.startsWith('>')) await page.keyboard.press('Enter')
    }
    await page.keyboard.type('---')
    await page.keyboard.type('Texto com ~~riscado~~ e `código` no meio')
    await expect(body.locator('h1')).toHaveText('Grande')
    await expect(body.locator('h2')).toHaveText('Médio')
    await expect(body.locator('h3')).toHaveText('Pequeno')
    await expect(body.locator('blockquote')).toContainText('Citação')
    await expect(body.locator('hr')).toHaveCount(1)
    await expect(body.locator('s')).toHaveText('riscado')
    await expect(body.locator('code')).toHaveText('código')
  })

  test('título pelo botão escolhe o tamanho', async ({ page }) => {
    await page.keyboard.type('Seção')
    await page.getByRole('button', { name: 'Título' }).click()
    await page.getByRole('menuitem', { name: /Título médio/ }).click()
    await expect(page.locator('#corpo h2')).toHaveText('Seção')
  })

  test('tabela pelo +: cabeçalho, Tab entre células, linha e coluna pelo menu', async ({ page }) => {
    await page.getByRole('button', { name: 'Inserir' }).click()
    await page.getByRole('menuitem', { name: 'Tabela' }).click()
    const table = page.locator('#corpo table')
    await expect(table.locator('tr')).toHaveCount(3)
    await expect(table.locator('th')).toHaveCount(3)
    await page.keyboard.type('Item')
    await page.keyboard.press('Tab')
    await page.keyboard.type('Qtd')
    await expect(table.locator('th').nth(1)).toHaveText('Qtd')
    // Menu da tabela pela alça ⋮⋮ (no texto, o clique direito é o do sistema: copiar, colar).
    const menu = async (item: string) => {
      await table.locator('td').first().hover()
      await page.locator('.blk-handle').click()
      await page.getByRole('menuitem', { name: item }).click()
    }
    await menu('Linha abaixo')
    await expect(table.locator('tr')).toHaveCount(4)
    await menu('Coluna à direita')
    await expect(table.locator('th')).toHaveCount(4)
  })

  test('colar Markdown vira título, lista e tabela', async ({ page }) => {
    const md = '# Compras\n\n- arroz\n- feijão\n\n| Item | Qtd |\n| --- | --- |\n| Café | 1 |'
    await page.evaluate((text) => {
      const dt = new DataTransfer()
      dt.setData('text/plain', text)
      document.querySelector('#corpo')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    }, md)
    const body = page.locator('#corpo')
    await expect(body.locator('h1')).toHaveText('Compras')
    await expect(body.locator('ul li')).toHaveCount(2)
    await expect(body.locator('table th')).toHaveText(['Item', 'Qtd'])
    await expect(body).not.toContainText('|')
    // Fechada, a nota mostra só o resumo da tabela no card (Atrio 0.21.0): o tamanho e os nomes das colunas.
    await page.keyboard.press('Escape')
    const card = page.locator('.card:has(.pv-tsum)', { hasText: 'Compras' })
    await expect(card.locator('.pv-tsum-size')).toHaveText('Tabela · 2 colunas × 1 linha')
    await expect(card.locator('.pv-tsum-cols')).toHaveText('Item · Qtd')
  })
})

test.describe('Calendário e Kanban', () => {
  test.use({ viewport: { width: 1280, height: 860 } })
  const lens = (page: Page, name: string) => page.locator('.view-switch .lens', { hasText: name }).or(page.locator(`.view-switch .lens[title="${name}"]`)).first()
  /** Arrasta com o mouse (pelo ponteiro, como no app) de um elemento até outro. */
  const drag = async (page: Page, from: ReturnType<Page['locator']>, to: ReturnType<Page['locator']>) => {
    const a = (await from.boundingBox())!
    const b = (await to.boundingBox())!
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
    await page.mouse.down()
    await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 3 })
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 })
    await page.mouse.up()
  }

  test('kanban: três colunas pelo status; o seletor de cores e o arrastar mudam o status', async ({ page }) => {
    await lens(page, 'Kanban').click()
    const col = (name: string) => page.locator('.kb-col', { hasText: name })
    await expect(page.locator('.kb-head')).toHaveText([/A fazer/, /Em andamento/, /Concluído/])
    await expect(col('Em andamento').locator('.kb-card')).toHaveCount(2)
    // seletor de cores: vermelho → amarelo
    const card = () => page.locator('.kb-card', { hasText: 'Comprar pilha' })
    await card().getByRole('radio', { name: 'Em andamento' }).click()
    await expect(page.locator('.toast span')).toHaveText('Lembrete em andamento')
    await expect(col('Em andamento').locator('.kb-card', { hasText: 'Comprar pilha' })).toHaveCount(1)
    // arrastar para Concluído
    await drag(page, card(), col('Concluído'))
    await expect(col('Concluído').locator('.kb-card', { hasText: 'Comprar pilha' })).toHaveCount(1)
    await expect(page.locator('.toast span')).toHaveText('Lembrete concluído')
    // e aparece concluído em Lembretes
    await lens(page, 'Lembretes').click()
    await expect(page.locator('.r-item', { hasText: 'Comprar pilha' })).toHaveCount(0)
    // o + da coluna Em andamento cria o lembrete já amarelo
    await lens(page, 'Kanban').click()
    await page.getByRole('button', { name: 'Nova nota em Em andamento' }).click()
    await expect(page.locator('.editor').getByRole('radio', { name: 'Em andamento' })).toHaveAttribute('aria-checked', 'true')
    await page.locator('#titulo').fill('Revisar orçamento')
    await back(page)
    await expect(col('Em andamento').locator('.kb-card', { hasText: 'Revisar orçamento' })).toHaveCount(1)
    // setas do teclado no seletor de cores
    await col('Em andamento').locator('.kb-card', { hasText: 'Revisar orçamento' }).getByRole('radio', { name: 'Em andamento' }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(col('Concluído').locator('.kb-card', { hasText: 'Revisar orçamento' })).toHaveCount(1)
    // clicar no card abre a nota
    await page.locator('.kb-card', { hasText: 'Mercado da semana' }).click()
    await expect(page.locator('#titulo')).toHaveValue('Mercado da semana')
  })

  test('calendário: lembretes no dia, arrastar muda o dia, + cria lembrete no dia, semana', async ({ page }) => {
    await lens(page, 'Calendário').click()
    const today = page.locator('.cal-day.today')
    await expect(today.locator('.cal-chip', { hasText: '1:1 com o time' })).toHaveCount(1)
    const next = page.locator('.cal-day.today + .cal-day')
    // arrastar para o dia seguinte: mesma hora
    await drag(page, today.locator('.cal-chip', { hasText: '1:1 com o time' }), next)
    await expect(page.locator('.toast span')).toHaveText(/Lembrete: Amanhã, 15:00/)
    await expect(next.locator('.cal-chip', { hasText: '1:1 com o time' })).toHaveCount(1)
    // + do dia: nota nova já com lembrete nesse dia
    await next.hover()
    await next.getByRole('button', { name: 'Novo lembrete neste dia' }).click()
    await expect(page.locator('.rem-pill')).toContainText('Amanhã, 09:00')
    await page.locator('#titulo').fill('Ligar para a gráfica')
    await back(page)
    await expect(next.locator('.cal-chip', { hasText: 'Ligar para a gráfica' })).toHaveCount(1)
    // dia escolhido: o "+" de criar (e o Enter) usam ele, também depois de ir para outro mês e voltar
    await page.getByRole('button', { name: 'Próximo mês' }).click()
    await page.getByRole('button', { name: 'Mês anterior' }).click()
    await expect(page.locator('.cal-day.sel')).toHaveCount(1)
    await page.locator('.cal-day.sel').click({ position: { x: 4, y: 100 } })
    await page.keyboard.press('t')
    await expect(page.locator('.cal-day.sel.today')).toHaveCount(1)
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.cal-day.today + .cal-day.sel')).toHaveCount(1)
    await page.keyboard.press('Enter')
    await expect(page.locator('.rem-pill')).toContainText('Amanhã, 09:00')
    await page.keyboard.press('Escape')
    // concluídos só com "Mostrar concluídos"
    await expect(page.locator('.cal-chip.done')).toHaveCount(0)
    await page.getByRole('button', { name: 'Mostrar concluídos' }).click()
    await expect(page.locator('.cal-chip.done').first()).toBeVisible()
    // semana: sete dias
    await page.getByRole('radio', { name: 'Semana' }).click()
    await expect(page.locator('.cal-day')).toHaveCount(7)
    await page.getByRole('button', { name: 'Próxima semana' }).click()
    await expect(page.locator('.cal-day.today')).toHaveCount(0)
    await page.getByRole('button', { name: 'Hoje' }).click()
    await expect(page.locator('.cal-day.today')).toHaveCount(1)
  })
})

test.describe('Status em qualquer nota', () => {
  test.use({ viewport: { width: 1280, height: 860 } })

  test('nota sem lembrete ganha status pelo menu, aparece no Kanban e perde com "Sem status"', async ({ page }) => {
    const card = () => cards(page).filter({ hasText: 'Horários e estacionamento' })
    await card().click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Status' }).click()
    await page.getByRole('menuitem', { name: 'Em andamento' }).click()
    await expect(page.locator('.toast span')).toHaveText('Nota em andamento')
    // no card da lista, o status vira o seletor de três cores
    await expect(card().getByRole('radio', { name: 'Em andamento' })).toHaveAttribute('aria-checked', 'true')
    await page.locator('.view-switch .lens', { hasText: 'Kanban' }).or(page.locator('.view-switch .lens[title="Kanban"]')).first().click()
    const kcard = page.locator('.kb-col', { hasText: 'Em andamento' }).locator('.kb-card', { hasText: 'Horários e estacionamento' })
    await expect(kcard).toHaveCount(1)
    // no editor, o seletor aparece mesmo sem lembrete
    await kcard.click()
    await expect(page.locator('.editor').getByRole('radio', { name: 'Em andamento' })).toHaveAttribute('aria-checked', 'true')
    await page.locator('.editor').getByRole('radio', { name: 'Concluído' }).click()
    await back(page)
    await expect(page.locator('.kb-col', { hasText: 'Concluído' }).locator('.kb-card', { hasText: 'Horários e estacionamento' })).toHaveCount(1)
    // Sem status: sai do Kanban
    await page.locator('.kb-card', { hasText: 'Horários e estacionamento' }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Status' }).click()
    await page.getByRole('menuitem', { name: 'Sem status' }).click()
    await expect(page.locator('.kb-card', { hasText: 'Horários e estacionamento' })).toHaveCount(0)
  })

  test('o + do Kanban cria uma nota com status, sem lembrete', async ({ page }) => {
    await page.locator('.view-switch .lens', { hasText: 'Kanban' }).or(page.locator('.view-switch .lens[title="Kanban"]')).first().click()
    await page.getByRole('button', { name: 'Nova nota em A fazer' }).click()
    await expect(page.locator('.rem-pill')).toHaveCount(0)
    await expect(page.locator('.editor').getByRole('radio', { name: 'A fazer' })).toHaveAttribute('aria-checked', 'true')
    await page.locator('#titulo').fill('Planejar a mudança')
    await back(page)
    await expect(page.locator('.kb-col', { hasText: 'A fazer' }).locator('.kb-card', { hasText: 'Planejar a mudança' })).toHaveCount(1)
  })
})

test.describe('idioma', () => {
  // O navegador dos testes está em português (playwright.config: locale pt-BR). Aqui só o que é texto do Ideario: o
  // que vem das peças do Atrio pode continuar em português até o Atrio traduzir.
  test('trocar para inglês nas Configurações traduz a interface e fica guardado', async ({ page }) => {
    await openSettings(page)
    await expect(page.locator('.sheet-title')).toHaveText('Configurações')
    await page.locator('#idioma').click()
    await page.getByRole('option', { name: 'English' }).click()
    await expect(page.locator('.sheet-title')).toHaveText('Settings')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.getByText('Language', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Close' }).click()
    await expect(page.locator('.tabbar button', { hasText: 'Reminders' })).toBeVisible()
    await expect(page.locator('#busca')).toHaveAttribute('placeholder', 'Search notes')
    // a escolha fica no aparelho
    await page.reload()
    await expect(page.locator('.tabbar button', { hasText: 'Notes' })).toBeVisible()
    // e volta para o português (os nomes do menu agora estão em inglês)
    await page.getByLabel('Open menu').click()
    await page.locator('.drawer').getByRole('button', { name: 'Settings' }).click()
    await page.locator('#idioma').click()
    await page.getByRole('option', { name: 'Português' }).click()
    await expect(page.locator('.sheet-title')).toHaveText('Configurações')
  })

  test('em inglês: menu do card e aviso com Desfazer', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('atrio.locale', 'en'))
    await page.reload()
    await expect(cards(page).first()).toBeVisible()
    await cards(page).first().click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: 'Make a copy' })).toBeVisible()
    await page.getByRole('menuitem', { name: 'Archive' }).click()
    await expect(page.locator('.toast span')).toHaveText('Note archived')
    await expect(page.locator('.toast').getByRole('button', { name: 'Undo' })).toBeVisible()
  })
})
