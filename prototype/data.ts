// Dados de exemplo do protótipo. Imagens são composições SVG geradas aqui,
// cada uma com a paleta "extraída" que o app calcularia na importação.

export type Tone = 'quente' | 'frio' | 'verde' | 'rosa' | 'neutro'
export type NoteColor = 'none' | 'sand' | 'sage' | 'sky' | 'rose' | 'lilac' | 'butter'

export interface Img {
  id: string
  name: string
  kind: 'landscape' | 'swatch' | 'arch' | 'type' | 'bottle' | 'waves' | 'blocks'
  w: number
  h: number
  pal: string[]
  tone: Tone
  origKB: number
  optKB: number
}

export interface FileItem {
  id: string
  name: string
  kind: 'pdf' | 'doc' | 'planilha' | 'audio'
  kb: number
  noteId: string
  daysAgo: number
}

export interface Category {
  id: string
  name: string
  dot: string
}

export interface Note {
  id: string
  title: string
  html: string
  category: string // 'none' = sem categoria
  tags: string[]
  color: NoteColor
  pinned: boolean
  reminder: string | null // ISO
  reminderDone?: boolean
  archived?: boolean
  trashed?: boolean
  updatedHoursAgo: number
}

export const CATEGORIES: Category[] = [
  { id: 'aromate', name: 'Arómate', dot: '#C26A3D' },
  { id: 'fluency', name: 'Fluency', dot: '#3E8E7E' },
  { id: 'gestao', name: 'Gestão de Pessoas', dot: '#8A6BC4' },
  { id: 'hospital', name: 'Hospital', dot: '#C25478' },
  { id: 'linvo', name: 'Linvo', dot: '#3D63D6' },
  { id: 'mba', name: 'MBA em Finanças e Análise de Dados', dot: '#B08A1E' },
]

export const IMGS: Img[] = [
  { id: 'i1', name: 'campanha-q4-grid.webp', kind: 'swatch', w: 600, h: 420, pal: ['#1D2B6B', '#3D63D6', '#A9BCF5', '#F2EDE4', '#E86A3A'], tone: 'frio', origKB: 3480, optKB: 286 },
  { id: 'i2', name: 'frasco-ref-01.webp', kind: 'bottle', w: 600, h: 800, pal: ['#E9D6C1', '#C26A3D', '#7A3B1F', '#F6EEE5', '#2E1A10'], tone: 'quente', origKB: 4210, optKB: 344 },
  { id: 'i3', name: 'paisagem-serra.webp', kind: 'landscape', w: 600, h: 450, pal: ['#F4C9A0', '#E8875A', '#FBE6C8', '#6E4A6B', '#3B2A44'], tone: 'quente', origKB: 5120, optKB: 402 },
  { id: 'i4', name: 'specimen-grotesca.webp', kind: 'type', w: 600, h: 600, pal: ['#EDEBE4', '#141414', '#D9D4C7', '#E04B2B', '#8F8B80'], tone: 'neutro', origKB: 1980, optKB: 151 },
  { id: 'i5', name: 'arcos-fachada.webp', kind: 'arch', w: 600, h: 760, pal: ['#E7E2D6', '#7FA393', '#355E54', '#C9B79C', '#1F3A33'], tone: 'verde', origKB: 4630, optKB: 371 },
  { id: 'i6', name: 'paleta-outono.webp', kind: 'waves', w: 600, h: 500, pal: ['#F3E3CF', '#D98E4A', '#A8502C', '#6B3A2A', '#E7C08A'], tone: 'quente', origKB: 3890, optKB: 298 },
  { id: 'i7', name: 'tons-lavanda.webp', kind: 'landscape', w: 600, h: 640, pal: ['#D9D3F2', '#9C8FD8', '#F4EFFB', '#5B4C9C', '#2D2552'], tone: 'frio', origKB: 4400, optKB: 335 },
  { id: 'i8', name: 'blocos-rosa.webp', kind: 'blocks', w: 600, h: 520, pal: ['#F7DDE3', '#E58FA6', '#B24A6C', '#FFF4F1', '#3C1B27'], tone: 'rosa', origKB: 2760, optKB: 219 },
  { id: 'i9', name: 'mata-atlantica.webp', kind: 'waves', w: 600, h: 720, pal: ['#DCEBDD', '#6FA57A', '#2F6B45', '#B8D6A5', '#173826'], tone: 'verde', origKB: 6010, optKB: 455 },
  { id: 'i10', name: 'serif-editorial.webp', kind: 'type', w: 600, h: 460, pal: ['#1B2440', '#F2E9DA', '#C8A35B', '#3D63D6', '#0D1222'], tone: 'frio', origKB: 2150, optKB: 172 },
]

export const FILES: FileItem[] = [
  { id: 'f1', name: 'Aula 07 - Fluxo de caixa descontado.pdf', kind: 'pdf', kb: 2410, noteId: 'n4', daysAgo: 2 },
  { id: 'f2', name: 'Manual de marca Linvo v3.pdf', kind: 'pdf', kb: 8120, noteId: 'n1', daysAgo: 6 },
  { id: 'f3', name: 'Briefing Arómate.docx', kind: 'doc', kb: 186, noteId: 'n2', daysAgo: 9 },
  { id: 'f4', name: 'Aula de conversação 14.m4a', kind: 'audio', kb: 6240, noteId: 'n3', daysAgo: 1 },
  { id: 'f5', name: 'Valuation - modelo.xlsx', kind: 'planilha', kb: 512, noteId: 'n4', daysAgo: 3 },
  { id: 'f6', name: 'Pauta 1:1 outubro.docx', kind: 'doc', kb: 64, noteId: 'n5', daysAgo: 0 },
]

const img = (id: string) => `<img data-img="${id}" alt="">`
const check = (items: [string, boolean][]) =>
  `<ul class="check">${items.map(([t, d]) => `<li data-done="${d}">${t}</li>`).join('')}</ul>`

function at(dayOffset: number, h: number, m = 0) {
  const d = new Date()
  d.setDate(d.getDate() + dayOffset)
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}

export function initialNotes(): Note[] {
  return [
    {
      id: 'n1', title: 'Ideias de campanha Q4', category: 'linvo', tags: ['campanha', 'ideia'], color: 'sky', pinned: true,
      reminder: at(6, 10), updatedHoursAgo: 3,
      html: `<p>Fio condutor: <b>o dinheiro que trabalha enquanto você dorme</b>. Testar três ângulos antes da reunião.</p>${img('i1')}<ul><li>Série de posts com casos reais</li><li>Landing com simulador</li><li>E-mail de reativação</li></ul><p>Conferir tom de voz no manual antes de fechar o texto. #copy</p>`,
    },
    {
      id: 'n2', title: 'Embalagem: direção visual', category: 'aromate', tags: ['embalagem', 'referência'], color: 'sand', pinned: true,
      reminder: null, updatedHoursAgo: 20,
      html: `<p>Vidro âmbar, rótulo pequeno e muito respiro. Nada de dourado.</p>${img('i2')}<p>A serra ao fim da tarde é a paleta do frasco:</p>${img('i3')}`,
    },
    {
      id: 'n3', title: 'Phrasal verbs pra revisar', category: 'fluency', tags: ['estudo'], color: 'sage', pinned: false,
      reminder: at(1, 19), updatedHoursAgo: 26,
      html: check([['figure out', true], ['come up with', true], ['look forward to', false], ['put off', false], ['run into', false]]),
    },
    {
      id: 'n4', title: 'Valuation: fluxo de caixa descontado', category: 'mba', tags: ['estudo', 'entrega'], color: 'butter', pinned: false,
      reminder: at(3, 9), updatedHoursAgo: 50,
      html: `<h3>Passos</h3><ul><li>Projetar FCL por 5 anos</li><li>Calcular WACC</li><li>Valor terminal (Gordon)</li></ul><p>Entregar o modelo até sexta. A planilha e o PDF da aula estão anexados.</p>`,
    },
    {
      id: 'n5', title: '1:1 com o time — pauta', category: 'gestao', tags: ['reunião'], color: 'lilac', pinned: false,
      reminder: at(0, 15), updatedHoursAgo: 5,
      html: check([['Retomar metas do trimestre', false], ['Feedback do projeto de onboarding', false], ['Férias de dezembro', true]]),
    },
    {
      id: 'n6', title: 'Horários e estacionamento', category: 'hospital', tags: [], color: 'none', pinned: false,
      reminder: null, updatedHoursAgo: 120,
      html: `<p>Visitas das 14h às 20h. Estacionamento conveniado na rua de trás, entrada pela portaria B.</p>`,
    },
    {
      id: 'n7', title: 'Referências tipográficas', category: 'linvo', tags: ['tipografia', 'referência'], color: 'none', pinned: false,
      reminder: null, updatedHoursAgo: 72,
      html: `${img('i4')}<p>Grotesca com bastante contraste para títulos, serifada só em citações.</p>${img('i10')}`,
    },
    {
      id: 'n8', title: '', category: 'none', tags: [], color: 'none', pinned: false,
      reminder: at(-1, 18), updatedHoursAgo: 30,
      html: `<p>Comprar pilha AA e lâmpada da varanda</p>`,
    },
    {
      id: 'n9', title: 'Ideário: app de notas', category: 'none', tags: ['ideia', 'app'], color: 'rose', pinned: false,
      reminder: null, updatedHoursAgo: 1,
      html: `<p>Bloco de notas rápido + hub de ideias. Local-first, sync pelo Google Drive.</p><ul><li>Abrir direto numa nota nova</li><li>Fotos otimizadas</li><li>Moodboard com paletas</li></ul>${img('i8')}`,
    },
    {
      id: 'n10', title: 'Paleta outono', category: 'aromate', tags: ['cor', 'referência'], color: 'none', pinned: false,
      reminder: null, updatedHoursAgo: 96,
      html: `${img('i6')}${img('i5')}<p>Testar terracota com verde-musgo.</p>`,
    },
    {
      id: 'n11', title: 'Moodboard lavanda', category: 'linvo', tags: ['cor'], color: 'none', pinned: false,
      reminder: null, updatedHoursAgo: 200, archived: true,
      html: `${img('i7')}<p>Descartado para a campanha, guardar para o futuro.</p>`,
    },
    {
      id: 'n12', title: 'Trilha na mata', category: 'none', tags: ['viagem'], color: 'sage', pinned: false,
      reminder: null, updatedHoursAgo: 300, trashed: true,
      html: `${img('i9')}<p>Fotos da trilha.</p>`,
    },
  ]
}

// ---------- gerador das imagens de exemplo ----------
export function imgSrc(i: Img): string {
  const [a, b, c, d, e] = i.pal
  const { w, h } = i
  let body = ''
  switch (i.kind) {
    case 'landscape':
      body = `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="${a}"/></linearGradient></defs>
      <rect width="${w}" height="${h}" fill="url(#g)"/>
      <circle cx="${w * 0.68}" cy="${h * 0.42}" r="${w * 0.12}" fill="${b}"/>
      <path d="M0 ${h * 0.68} Q ${w * 0.25} ${h * 0.5} ${w * 0.5} ${h * 0.66} T ${w} ${h * 0.6} V ${h} H 0Z" fill="${d}"/>
      <path d="M0 ${h * 0.82} Q ${w * 0.3} ${h * 0.7} ${w * 0.62} ${h * 0.84} T ${w} ${h * 0.8} V ${h} H 0Z" fill="${e}"/>`
      break
    case 'swatch': {
      const cw = w / 5
      body = i.pal.map((p, k) => `<rect x="${k * cw}" y="0" width="${cw + 1}" height="${h}" fill="${p}"/>`).join('') +
        `<rect x="${w * 0.08}" y="${h * 0.62}" width="${w * 0.84}" height="${h * 0.26}" rx="6" fill="${d}"/>
        <rect x="${w * 0.12}" y="${h * 0.68}" width="${w * 0.5}" height="${h * 0.05}" fill="${a}"/>
        <rect x="${w * 0.12}" y="${h * 0.77}" width="${w * 0.32}" height="${h * 0.04}" fill="${b}"/>`
      break
    }
    case 'arch':
      body = `<rect width="${w}" height="${h}" fill="${a}"/>` +
        [0, 1, 2].map((k) => {
          const x = w * (0.1 + k * 0.29), aw = w * 0.22, top = h * 0.25
          return `<path d="M${x} ${h} V ${top + aw / 2} A ${aw / 2} ${aw / 2} 0 0 1 ${x + aw} ${top + aw / 2} V ${h}Z" fill="${[b, c, d][k]}"/>`
        }).join('') + `<rect y="${h * 0.9}" width="${w}" height="${h * 0.1}" fill="${e}"/>`
      break
    case 'type':
      body = `<rect width="${w}" height="${h}" fill="${a}"/>
      <text x="${w * 0.08}" y="${h * 0.62}" font-family="Georgia, serif" font-size="${h * 0.48}" fill="${b}">Ag</text>
      <rect x="${w * 0.08}" y="${h * 0.74}" width="${w * 0.6}" height="3" fill="${d}"/>
      <text x="${w * 0.08}" y="${h * 0.84}" font-family="monospace" font-size="${h * 0.045}" fill="${e}">ABCDEFGHIJ 0123456789</text>
      <circle cx="${w * 0.86}" cy="${h * 0.18}" r="${w * 0.05}" fill="${d}"/>`
      break
    case 'bottle':
      body = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${d}"/><stop offset="1" stop-color="${a}"/></linearGradient></defs>
      <rect width="${w}" height="${h}" fill="url(#g)"/>
      <ellipse cx="${w / 2}" cy="${h * 0.86}" rx="${w * 0.26}" ry="${h * 0.025}" fill="${e}" opacity=".18"/>
      <rect x="${w * 0.3}" y="${h * 0.38}" width="${w * 0.4}" height="${h * 0.48}" rx="${w * 0.06}" fill="${b}"/>
      <rect x="${w * 0.42}" y="${h * 0.28}" width="${w * 0.16}" height="${h * 0.1}" rx="6" fill="${c}"/>
      <rect x="${w * 0.38}" y="${h * 0.56}" width="${w * 0.24}" height="${h * 0.1}" fill="${d}"/>
      <rect x="${w * 0.33}" y="${h * 0.4}" width="${w * 0.04}" height="${h * 0.42}" rx="6" fill="${d}" opacity=".35"/>`
      break
    case 'waves':
      body = `<rect width="${w}" height="${h}" fill="${a}"/>` +
        [b, e, c, d].map((p, k) => {
          const y = h * (0.3 + k * 0.17)
          return `<path d="M0 ${y} C ${w * 0.3} ${y - h * 0.12} ${w * 0.6} ${y + h * 0.12} ${w} ${y - h * 0.04} V ${h} H 0Z" fill="${p}"/>`
        }).join('')
      break
    case 'blocks':
      body = `<rect width="${w}" height="${h}" fill="${d}"/>
      <rect x="${w * 0.08}" y="${h * 0.1}" width="${w * 0.5}" height="${h * 0.5}" fill="${a}"/>
      <circle cx="${w * 0.66}" cy="${h * 0.56}" r="${w * 0.22}" fill="${b}"/>
      <rect x="${w * 0.2}" y="${h * 0.68}" width="${w * 0.3}" height="${h * 0.22}" fill="${c}"/>
      <rect x="${w * 0.72}" y="${h * 0.12}" width="${w * 0.14}" height="${w * 0.14}" fill="${e}"/>`
      break
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}
