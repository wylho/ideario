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
  ]
}

export { DAY }
