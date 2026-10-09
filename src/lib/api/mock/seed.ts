// Dados de exemplo da Fase 0, portados do protótipo.
import type { AttachmentKind, NoteColor, RichDoc, RichNode, Tone } from '../../types'
import type { FakeImage } from './fake-images'

const HOUR = 3_600_000
const DAY = 86_400_000

export interface SeedCategory {
  id: string
  name: string
  color: string
}

export interface SeedImage extends FakeImage {
  hash: string
  name: string
  tone: Tone
  origKB: number
  optKB: number
}

export interface SeedFile {
  hash: string
  name: string
  kind: Exclude<AttachmentKind, 'image'>
  mime: string
  kb: number
  noteId: string
  daysAgo: number
}

export interface SeedNote {
  id: string
  title: string
  body: RichDoc
  categoryId: string | null
  tags: string[]
  color: NoteColor
  pinned: boolean
  reminderAt: number | null
  reminderDone?: boolean
  archived?: boolean
  trashedDaysAgo?: number
  updatedAt: number
}

export const SEED_CATEGORIES: SeedCategory[] = [
  { id: 'cat-aromate', name: 'Arómate', color: '#C26A3D' },
  { id: 'cat-fluency', name: 'Fluency', color: '#3E8E7E' },
  { id: 'cat-gestao', name: 'Gestão de Pessoas', color: '#8A6BC4' },
  { id: 'cat-hospital', name: 'Hospital', color: '#C25478' },
  { id: 'cat-linvo', name: 'Linvo', color: '#3D63D6' },
  { id: 'cat-mba', name: 'MBA em Finanças e Análise de Dados', color: '#B08A1E' },
]

export const SEED_IMAGES: SeedImage[] = [
  { hash: 'img-campanha', name: 'campanha-q4-grid.webp', kind: 'swatch', w: 600, h: 420, pal: ['#1D2B6B', '#3D63D6', '#A9BCF5', '#F2EDE4', '#E86A3A'], tone: 'frio', origKB: 3480, optKB: 286 },
  { hash: 'img-frasco', name: 'frasco-ref-01.webp', kind: 'bottle', w: 600, h: 800, pal: ['#E9D6C1', '#C26A3D', '#7A3B1F', '#F6EEE5', '#2E1A10'], tone: 'quente', origKB: 4210, optKB: 344 },
  { hash: 'img-serra', name: 'paisagem-serra.webp', kind: 'landscape', w: 600, h: 450, pal: ['#F4C9A0', '#E8875A', '#FBE6C8', '#6E4A6B', '#3B2A44'], tone: 'quente', origKB: 5120, optKB: 402 },
  { hash: 'img-grotesca', name: 'specimen-grotesca.webp', kind: 'type', w: 600, h: 600, pal: ['#EDEBE4', '#141414', '#D9D4C7', '#E04B2B', '#8F8B80'], tone: 'neutro', origKB: 1980, optKB: 151 },
  { hash: 'img-arcos', name: 'arcos-fachada.webp', kind: 'arch', w: 600, h: 760, pal: ['#E7E2D6', '#7FA393', '#355E54', '#C9B79C', '#1F3A33'], tone: 'verde', origKB: 4630, optKB: 371 },
  { hash: 'img-outono', name: 'paleta-outono.webp', kind: 'waves', w: 600, h: 500, pal: ['#F3E3CF', '#D98E4A', '#A8502C', '#6B3A2A', '#E7C08A'], tone: 'quente', origKB: 3890, optKB: 298 },
  { hash: 'img-lavanda', name: 'tons-lavanda.webp', kind: 'landscape', w: 600, h: 640, pal: ['#D9D3F2', '#9C8FD8', '#F4EFFB', '#5B4C9C', '#2D2552'], tone: 'frio', origKB: 4400, optKB: 335 },
  { hash: 'img-rosa', name: 'blocos-rosa.webp', kind: 'blocks', w: 600, h: 520, pal: ['#F7DDE3', '#E58FA6', '#B24A6C', '#FFF4F1', '#3C1B27'], tone: 'rosa', origKB: 2760, optKB: 219 },
  { hash: 'img-mata', name: 'mata-atlantica.webp', kind: 'waves', w: 600, h: 720, pal: ['#DCEBDD', '#6FA57A', '#2F6B45', '#B8D6A5', '#173826'], tone: 'verde', origKB: 6010, optKB: 455 },
  { hash: 'img-serif', name: 'serif-editorial.webp', kind: 'type', w: 600, h: 460, pal: ['#1B2440', '#F2E9DA', '#C8A35B', '#3D63D6', '#0D1222'], tone: 'frio', origKB: 2150, optKB: 172 },
  { hash: 'img-mockup', name: 'mockup-app-lancamento.webp', kind: 'blocks', w: 600, h: 760, pal: ['#E2E8FB', '#2547C9', '#0F1B4D', '#F7F9F8', '#8EA4FF'], tone: 'frio', origKB: 3320, optKB: 241 },
  { hash: 'img-rotulo', name: 'rotulo-prova-03.webp', kind: 'bottle', w: 600, h: 720, pal: ['#F1E4D3', '#B5652F', '#5C2F17', '#FAF4EC', '#2B160B'], tone: 'quente', origKB: 4870, optKB: 362 },
  { hash: 'img-amostras', name: 'amostras-papel.webp', kind: 'swatch', w: 600, h: 400, pal: ['#E9E5DC', '#CFC8B8', '#A39E92', '#6F6A60', '#3A3731'], tone: 'neutro', origKB: 2240, optKB: 168 },
  { hash: 'img-praia', name: 'paraty-cais.webp', kind: 'landscape', w: 600, h: 440, pal: ['#CFE6EE', '#5FA3BF', '#EAF5F7', '#2F6E73', '#163E45'], tone: 'frio', origKB: 5480, optKB: 418 },
  { hash: 'img-folhagem', name: 'paraty-mata.webp', kind: 'arch', w: 600, h: 780, pal: ['#E4EEDB', '#8DB580', '#3F7346', '#C7DDB5', '#1D3B22'], tone: 'verde', origKB: 4960, optKB: 389 },
  { hash: 'img-pao', name: 'pao-fermentacao.webp', kind: 'waves', w: 600, h: 520, pal: ['#F6EADB', '#D9A066', '#9A5B2E', '#5A341B', '#EBCB9C'], tone: 'quente', origKB: 3610, optKB: 276 },
]

const PDF = 'application/pdf'
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export const SEED_FILES: SeedFile[] = [
  { hash: 'file-aula07', name: 'Aula 07 - Fluxo de caixa descontado.pdf', kind: 'pdf', mime: PDF, kb: 2410, noteId: 'n4', daysAgo: 2 },
  { hash: 'file-manual', name: 'Manual de marca Linvo v3.pdf', kind: 'pdf', mime: PDF, kb: 8120, noteId: 'n1', daysAgo: 6 },
  { hash: 'file-briefing', name: 'Briefing Arómate.docx', kind: 'doc', mime: DOCX, kb: 186, noteId: 'n2', daysAgo: 9 },
  { hash: 'file-aula14', name: 'Aula de conversação 14.m4a', kind: 'audio', mime: 'audio/mp4', kb: 6240, noteId: 'n3', daysAgo: 1 },
  { hash: 'file-valuation', name: 'Valuation - modelo.xlsx', kind: 'sheet', mime: XLSX, kb: 512, noteId: 'n4', daysAgo: 3 },
  { hash: 'file-pauta', name: 'Pauta 1:1 outubro.docx', kind: 'doc', mime: DOCX, kb: 64, noteId: 'n5', daysAgo: 0 },
  { hash: 'file-shadowing', name: 'Shadowing ep. 42.mp3', kind: 'audio', mime: 'audio/mpeg', kb: 4380, noteId: 'n15', daysAgo: 2 },
  { hash: 'file-avaliacao', name: 'Avaliação Q1 - consolidado.pdf', kind: 'pdf', mime: PDF, kb: 1240, noteId: 'n16', daysAgo: 4 },
  { hash: 'file-lista3', name: 'Lista de exercícios 3.pdf', kind: 'pdf', mime: PDF, kb: 860, noteId: 'n19', daysAgo: 1 },
  { hash: 'file-gastos', name: 'Gastos de setembro.xlsx', kind: 'sheet', mime: XLSX, kb: 96, noteId: 'n24', daysAgo: 12 },
  { hash: 'file-roteiro', name: 'Roteiro Paraty.pdf', kind: 'pdf', mime: PDF, kb: 540, noteId: 'n21', daysAgo: 3 },
]

// Construtores do documento rico (mesmo formato JSON que o TipTap produz).
type Inline = RichNode | string
const inline = (c: Inline[]): RichNode[] => c.map((x) => (typeof x === 'string' ? { type: 'text', text: x } : x))
const doc = (...content: RichNode[]): RichDoc => ({ type: 'doc', content })
const p = (...c: Inline[]): RichNode => ({ type: 'paragraph', content: inline(c) })
const h3 = (text: string): RichNode => ({ type: 'heading', attrs: { level: 3 }, content: inline([text]) })
const bold = (text: string): RichNode => ({ type: 'text', text, marks: [{ type: 'bold' }] })
const ul = (...items: string[]): RichNode => ({ type: 'bulletList', content: items.map((t) => ({ type: 'listItem', content: [p(t)] })) })
const img = (hash: string): RichNode => ({ type: 'noteImage', attrs: { hash } })
const check = (items: [string, boolean][]): RichNode => ({
  type: 'taskList',
  content: items.map(([t, done]) => ({ type: 'taskItem', attrs: { checked: done }, content: [p(t)] })),
})

function at(dayOffset: number, h: number, m = 0) {
  const d = new Date()
  d.setDate(d.getDate() + dayOffset)
  d.setHours(h, m, 0, 0)
  return d.getTime()
}
const hoursAgo = (h: number) => Date.now() - h * HOUR

export function seedNotes(): SeedNote[] {
  return [
    {
      id: 'n1', title: 'Ideias de campanha Q4', categoryId: 'cat-linvo', tags: ['campanha', 'ideia'], color: 'sky', pinned: true,
      reminderAt: at(6, 10), updatedAt: hoursAgo(3),
      body: doc(
        p('Fio condutor: ', bold('o dinheiro que trabalha enquanto você dorme'), '. Testar três ângulos antes da reunião.'),
        img('img-campanha'),
        ul('Série de posts com casos reais', 'Landing com simulador', 'E-mail de reativação'),
        p('Conferir tom de voz no manual antes de fechar o texto. #copy'),
      ),
    },
    {
      id: 'n2', title: 'Embalagem: direção visual', categoryId: 'cat-aromate', tags: ['embalagem', 'referência'], color: 'sand', pinned: true,
      reminderAt: null, updatedAt: hoursAgo(20),
      body: doc(p('Vidro âmbar, rótulo pequeno e muito respiro. Nada de dourado.'), img('img-frasco'), p('A serra ao fim da tarde é a paleta do frasco:'), img('img-serra')),
    },
    {
      id: 'n3', title: 'Phrasal verbs pra revisar', categoryId: 'cat-fluency', tags: ['estudo'], color: 'sage', pinned: false,
      reminderAt: at(1, 19), updatedAt: hoursAgo(26),
      body: doc(check([['figure out', true], ['come up with', true], ['look forward to', false], ['put off', false], ['run into', false]])),
    },
    {
      id: 'n4', title: 'Valuation: fluxo de caixa descontado', categoryId: 'cat-mba', tags: ['estudo', 'entrega'], color: 'butter', pinned: false,
      reminderAt: at(3, 9), updatedAt: hoursAgo(50),
      body: doc(
        h3('Passos'),
        ul('Projetar FCL por 5 anos', 'Calcular WACC', 'Valor terminal (Gordon)'),
        p('Entregar o modelo até sexta. A planilha e o PDF da aula estão anexados.'),
      ),
    },
    {
      id: 'n5', title: '1:1 com o time — pauta', categoryId: 'cat-gestao', tags: ['reunião'], color: 'lilac', pinned: false,
      reminderAt: at(0, 15), updatedAt: hoursAgo(5),
      body: doc(check([['Retomar metas do trimestre', false], ['Feedback do projeto de onboarding', false], ['Férias de dezembro', true]])),
    },
    {
      id: 'n6', title: 'Horários e estacionamento', categoryId: 'cat-hospital', tags: [], color: 'none', pinned: false,
      reminderAt: null, updatedAt: hoursAgo(120),
      body: doc(p('Visitas das 14h às 20h. Estacionamento conveniado na rua de trás, entrada pela portaria B.')),
    },
    {
      id: 'n7', title: 'Referências tipográficas', categoryId: 'cat-linvo', tags: ['tipografia', 'referência'], color: 'none', pinned: false,
      reminderAt: null, updatedAt: hoursAgo(72),
      body: doc(img('img-grotesca'), p('Grotesca com bastante contraste para títulos, serifada só em citações.'), img('img-serif')),
    },
    {
      id: 'n8', title: '', categoryId: null, tags: [], color: 'none', pinned: false,
      reminderAt: at(-1, 18), updatedAt: hoursAgo(30),
      body: doc(p('Comprar pilha AA e lâmpada da varanda')),
    },
    {
      id: 'n9', title: 'Ideario: app de notas', categoryId: null, tags: ['ideia', 'app'], color: 'rose', pinned: false,
      reminderAt: null, updatedAt: hoursAgo(1),
      body: doc(
        p('Bloco de notas rápido + hub de ideias. Local-first, sync pelo Google Drive.'),
        ul('Abrir direto numa nota nova', 'Fotos otimizadas', 'Moodboard com paletas'),
        img('img-rosa'),
      ),
    },
    {
      id: 'n10', title: 'Paleta outono', categoryId: 'cat-aromate', tags: ['cor', 'referência'], color: 'none', pinned: false,
      reminderAt: null, updatedAt: hoursAgo(96),
      body: doc(img('img-outono'), img('img-arcos'), p('Testar terracota com verde-musgo.')),
    },
    {
      id: 'n11', title: 'Moodboard lavanda', categoryId: 'cat-linvo', tags: ['cor'], color: 'none', pinned: false,
      reminderAt: null, updatedAt: hoursAgo(200), archived: true,
      body: doc(img('img-lavanda'), p('Descartado para a campanha, guardar para o futuro.')),
    },
    {
      id: 'n12', title: 'Trilha na mata', categoryId: null, tags: ['viagem'], color: 'sage', pinned: false,
      reminderAt: null, updatedAt: hoursAgo(300), trashedDaysAgo: 4,
      body: doc(img('img-mata'), p('Fotos da trilha.')),
    },
    {
      id: 'n13', title: 'Mercado da semana', categoryId: null, tags: ['casa', 'compras'], color: 'butter', pinned: true,
      reminderAt: at(0, 19, 30), updatedAt: hoursAgo(2),
      body: doc(
        p('O que está faltando:'),
        check([['Arroz', true], ['Café em grão', false], ['Leite', false], ['Sabão em pó', false], ['Tomate e cebola', true], ['Papel toalha', false], ['Azeite', false]]),
      ),
    },
    {
      id: 'n14', title: 'Post de lançamento do app', categoryId: 'cat-linvo', tags: ['campanha', 'copy'], color: 'none', pinned: false,
      reminderAt: at(2, 11), updatedAt: hoursAgo(8),
      body: doc(p('Abrir com a dor: ', bold('dinheiro parado perde valor'), '. Mostrar o app em 3 telas e fechar com o convite para a lista de espera.'), img('img-mockup')),
    },
    {
      id: 'n15', title: 'Shadowing: episódio 42', categoryId: 'cat-fluency', tags: ['estudo', 'pronúncia'], color: 'sage', pinned: false,
      reminderAt: at(-1, 7, 30), reminderDone: true, updatedAt: hoursAgo(28),
      body: doc(check([['Ouvir uma vez sem legenda', true], ['Repetir em voz alta, frase a frase', true], ['Gravar e comparar', false]]), p('Atenção ao "th" e ao ritmo das frases longas.')),
    },
    {
      id: 'n16', title: 'Feedbacks do trimestre', categoryId: 'cat-gestao', tags: ['reunião', 'feedback'], color: 'none', pinned: false,
      reminderAt: at(5, 14), updatedAt: hoursAgo(60),
      body: doc(
        p('Resumo das conversas individuais de setembro. Levar para a reunião geral só o que for do time todo; o resto fica nos 1:1.'),
        h3('Pontos fortes do time'), ul('Entregas no prazo', 'Boa documentação', 'Apoio entre áreas'),
        h3('A melhorar'), ul('Estimativas', 'Reuniões longas demais', 'Passagem de bastão entre turnos'),
        h3('Combinados'), check([['Pauta enviada 1 dia antes', true], ['Reunião de 30 min, no máximo', false], ['Ata no canal do time', false]]),
        h3('Próximos passos'), p('Rever metas do Q4 com cada pessoa e marcar a retrospectiva no fim de novembro.'),
      ),
    },
    {
      id: 'n17', title: 'Exames e consultas', categoryId: 'cat-hospital', tags: ['saúde'], color: 'rose', pinned: false,
      reminderAt: null, updatedAt: hoursAgo(90),
      body: doc(check([['Hemograma completo', true], ['Retorno com a cardiologista', false], ['Levar o raio-X antigo', false], ['Pedir segunda via do laudo', false]])),
    },
    {
      id: 'n18', title: 'Rótulos: provas de cor', categoryId: 'cat-aromate', tags: ['embalagem', 'impressão'], color: 'none', pinned: false,
      reminderAt: at(-2, 10), updatedAt: hoursAgo(54),
      body: doc(img('img-rotulo'), p('A prova 03 ficou quente demais. Pedir ajuste de 5% no magenta e testar no papel kraft.'), img('img-amostras')),
    },
    {
      id: 'n19', title: 'Prova de Estatística', categoryId: 'cat-mba', tags: ['estudo', 'prova'], color: 'butter', pinned: false,
      reminderAt: at(1, 8), updatedAt: hoursAgo(14),
      body: doc(check([['Intervalo de confiança', true], ['Teste de hipótese', false], ['Regressão linear simples', false], ['Refazer a lista 3', false], ['Revisar fórmulas', false]])),
    },
    {
      id: 'n20', title: '', categoryId: null, tags: [], color: 'none', pinned: false,
      reminderAt: at(-3, 9), reminderDone: true, updatedAt: hoursAgo(75),
      body: doc(p('Ligar para o contador sobre a declaração do IR e mandar os informes de rendimento.')),
    },
    {
      id: 'n21', title: 'Viagem para Paraty', categoryId: null, tags: ['viagem'], color: 'sky', pinned: false,
      reminderAt: at(9, 8), updatedAt: hoursAgo(40),
      body: doc(img('img-praia'), check([['Reservar pousada', true], ['Protetor solar', false], ['Repelente', false], ['Câmera e baterias', false]]), img('img-folhagem')),
    },
    {
      id: 'n22', title: 'Fontes para testar', categoryId: 'cat-linvo', tags: ['tipografia'], color: 'none', pinned: false,
      reminderAt: null, updatedAt: hoursAgo(130),
      body: doc(ul('Grotesca com itálico de verdade', 'Mono para números das telas', 'Serifada só para citações'), p('Comparar legibilidade em 12px no celular.')),
    },
    {
      id: 'n23', title: 'Pão de fermentação natural', categoryId: null, tags: ['receita', 'casa'], color: 'sand', pinned: false,
      reminderAt: null, updatedAt: hoursAgo(160),
      body: doc(img('img-pao'), h3('Ingredientes'), ul('500 g de farinha', '350 ml de água', '100 g de levain', '10 g de sal'), p('Dobras a cada 30 min nas primeiras 2 horas.')),
    },
    {
      id: 'n24', title: 'Gastos de setembro', categoryId: 'cat-mba', tags: ['finanças'], color: 'none', pinned: false,
      reminderAt: null, updatedAt: hoursAgo(290), archived: true,
      body: doc(p('Fechado. Ficou 8% abaixo do orçamento; a planilha está anexada.')),
    },
    {
      id: 'n25', title: 'Rascunho antigo de post', categoryId: 'cat-linvo', tags: [], color: 'none', pinned: false,
      reminderAt: null, updatedAt: hoursAgo(400), trashedDaysAgo: 11,
      body: doc(p('Versão descartada do texto de reativação.')),
    },
  ]
}

export { DAY }
