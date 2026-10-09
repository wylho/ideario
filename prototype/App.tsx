import { useMemo, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as Select from '@radix-ui/react-select'
import * as Popover from '@radix-ui/react-popover'
import * as ToggleGroup from '@radix-ui/react-toggle-group'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as Switch from '@radix-ui/react-switch'
import * as Slider from '@radix-ui/react-slider'
import {
  Menu, Search, StickyNote, Bell, Paperclip, Images, Plus, Pin, PinOff, Archive, ArchiveRestore, Trash2, Settings,
  Tag, X, Check, ChevronDown, Bold, Italic, Heading, List, ListChecks, ImagePlus, MoreVertical, Palette,
  LayoutGrid, Rows3, FileText, FileSpreadsheet, FileAudio, File as FileIcon, CloudCheck, ArrowLeft, Download, Clock,
} from 'lucide-react'
import { CATEGORIES, FILES, IMGS, imgSrc, initialNotes, type Img, type Note, type NoteColor, type Tone } from './data'

type View = 'notas' | 'lembretes' | 'arquivos' | 'moodboard'
type Scope = { kind: 'all' } | { kind: 'cat'; id: string } | { kind: 'tag'; tag: string } | { kind: 'archive' } | { kind: 'trash' }

const IMG_BY_ID = Object.fromEntries(IMGS.map((i) => [i.id, i])) as Record<string, Img>
const CAT_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]))
const COLORS: { id: NoteColor; label: string }[] = [
  { id: 'none', label: 'Padrão' }, { id: 'sand', label: 'Areia' }, { id: 'sage', label: 'Sálvia' }, { id: 'sky', label: 'Céu' },
  { id: 'rose', label: 'Rosa' }, { id: 'lilac', label: 'Lilás' }, { id: 'butter', label: 'Manteiga' },
]
const TONES: { id: Tone; label: string; sw: string }[] = [
  { id: 'quente', label: 'Quentes', sw: '#D98E4A' }, { id: 'frio', label: 'Frios', sw: '#3D63D6' },
  { id: 'verde', label: 'Verdes', sw: '#4F8A60' }, { id: 'rosa', label: 'Rosas', sw: '#E58FA6' }, { id: 'neutro', label: 'Neutros', sw: '#A39E92' },
]

// ---------- helpers ----------
const hydrate = (html: string) =>
  html.replace(/<img data-img="(\w+)"[^>]*>/g, (_, id) => (IMG_BY_ID[id] ? `<img data-img="${id}" src="${imgSrc(IMG_BY_ID[id])}" alt="">` : ''))
const dehydrate = (html: string) => html.replace(/<img data-img="(\w+)"[^>]*>/g, '<img data-img="$1" alt="">')

function parse(html: string) {
  const doc = new DOMParser().parseFromString(html.replace(/<(p|li|h3|div|br)\b/g, ' <$1'), 'text/html')
  const imgs = [...doc.querySelectorAll('img[data-img]')].map((e) => e.getAttribute('data-img')!).filter((i) => IMG_BY_ID[i])
  const checks = [...doc.querySelectorAll('ul.check li')].map((li) => ({ text: li.textContent || '', done: li.getAttribute('data-done') === 'true' }))
  doc.querySelectorAll('ul.check').forEach((u) => u.remove())
  const text = (doc.body.textContent || '').replace(/\s+/g, ' ').trim()
  return { imgs, checks, text }
}
const hashTags = (text: string) => [...text.matchAll(/#([\p{L}\d-]+)/gu)].map((m) => m[1].toLowerCase())

function dayDiff(iso: string) {
  const a = new Date(iso); a.setHours(0, 0, 0, 0)
  const b = new Date(); b.setHours(0, 0, 0, 0)
  return Math.round((a.getTime() - b.getTime()) / 864e5)
}
function fmtReminder(iso: string) {
  const d = new Date(iso)
  const t = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const dd = dayDiff(iso)
  if (dd === 0) return `Hoje, ${t}`
  if (dd === 1) return `Amanhã, ${t}`
  if (dd === -1) return `Ontem, ${t}`
  return `${d.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' })}, ${t}`
}
const isOverdue = (n: Note) => !!n.reminder && !n.reminderDone && new Date(n.reminder).getTime() < Date.now()
const fmtKB = (kb: number) => (kb >= 1024 ? `${(kb / 1024).toFixed(1).replace('.', ',')} MB` : `${kb} KB`)
const ago = (h: number) => (h < 1 ? 'agora' : h < 24 ? `há ${h} h` : `há ${Math.round(h / 24)} d`)
function atLocal(dayOffset: number, h: number) {
  const d = new Date(); d.setDate(d.getDate() + dayOffset); d.setHours(h, 0, 0, 0); return d.toISOString()
}
function toLocalInput(iso: string) {
  const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

// ---------- app ----------
export default function App() {
  const [notes, setNotes] = useState<Note[]>(initialNotes)
  const [view, setView] = useState<View>('notas')
  const [scope, setScope] = useState<Scope>({ kind: 'all' })
  const [query, setQuery] = useState('')
  const [layout, setLayout] = useState<'grid' | 'list'>('grid')
  const [drawer, setDrawer] = useState(false)
  const [settings, setSettings] = useState(false)
  const [editing, setEditing] = useState<Note | null>(null)
  const [lightbox, setLightbox] = useState<{ img: Img; noteId: string } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<number>()

  const say = (msg: string) => {
    setToast(msg)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2600)
  }

  const live = notes.filter((n) => !n.trashed && !n.archived)
  const allTags = useMemo(() => {
    const m = new Map<string, number>()
    live.forEach((n) => n.tags.forEach((t) => m.set(t, (m.get(t) || 0) + 1)))
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [notes])

  const update = (n: Note) => setNotes((ns) => (ns.some((x) => x.id === n.id) ? ns.map((x) => (x.id === n.id ? n : x)) : [n, ...ns]))

  const openNew = () => {
    setEditing({
      id: 'n' + Date.now(), title: '', html: '', category: scope.kind === 'cat' ? scope.id : 'none',
      tags: scope.kind === 'tag' ? [scope.tag] : [], color: 'none', pinned: false, reminder: null, updatedHoursAgo: 0,
    })
  }
  const openNote = (id: string) => {
    const n = notes.find((x) => x.id === id)
    if (n) setEditing(n)
  }

  const go = (v: View, s?: Scope) => {
    setView(v)
    if (s) setScope(s)
    setDrawer(false)
  }

  const scopeLabel =
    scope.kind === 'cat' ? CAT_BY_ID[scope.id]?.name : scope.kind === 'tag' ? `#${scope.tag}` : scope.kind === 'archive' ? 'Arquivo' : scope.kind === 'trash' ? 'Lixeira' : null
  const viewLabel = { notas: 'notas', lembretes: 'lembretes', arquivos: 'arquivos', moodboard: 'imagens' }[view]

  return (
    <div className="stage">
      <div className="shell">
        <header className="topbar">
          <button className="icon-btn" aria-label="Abrir menu" onClick={() => setDrawer(true)}><Menu size={20} /></button>
          <label className="search">
            <Search size={16} aria-hidden />
            <input
              id="busca"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Buscar ${viewLabel}${scopeLabel ? ` em ${scopeLabel}` : ''}`}
            />
            {query && <button className="icon-btn sm" aria-label="Limpar busca" onClick={() => setQuery('')}><X size={14} /></button>}
          </label>
          {view === 'notas' && (
            <button className="icon-btn" aria-label={layout === 'grid' ? 'Ver em lista' : 'Ver em grade'} onClick={() => setLayout(layout === 'grid' ? 'list' : 'grid')}>
              {layout === 'grid' ? <Rows3 size={19} /> : <LayoutGrid size={19} />}
            </button>
          )}
          <button className="sync" aria-label="Sincronização" onClick={() => setSettings(true)}>
            <CloudCheck size={18} />
          </button>
        </header>

        {scopeLabel && view !== 'lembretes' && (
          <div className="scope-bar">
            <span className="scope-pill">
              {scope.kind === 'cat' && <i className="dot" style={{ background: CAT_BY_ID[scope.id].dot }} />}
              {scopeLabel}
              <button aria-label="Remover filtro" onClick={() => setScope({ kind: 'all' })}><X size={13} /></button>
            </span>
          </div>
        )}

        <main className="content">
          {view === 'notas' && (
            <NotesView notes={notes} scope={scope} query={query} layout={layout} onOpen={openNote} onTag={(t) => setScope({ kind: 'tag', tag: t })} />
          )}
          {view === 'lembretes' && (
            <RemindersView
              notes={live} query={query} onOpen={openNote}
              onDone={(n) => { update({ ...n, reminderDone: !n.reminderDone }); say(n.reminderDone ? 'Lembrete reaberto' : 'Lembrete concluído') }}
            />
          )}
          {view === 'arquivos' && <FilesView notes={live} scope={scope} query={query} onOpen={openNote} onImage={(img, noteId) => setLightbox({ img, noteId })} />}
          {view === 'moodboard' && <MoodboardView notes={live} scope={scope} query={query} onImage={(img, noteId) => setLightbox({ img, noteId })} />}
        </main>

        {view !== 'moodboard' && scope.kind !== 'trash' && (
          <button className="fab" onClick={openNew} aria-label="Nova nota"><Plus size={26} strokeWidth={2.2} /></button>
        )}

        <nav className="tabbar" aria-label="Seções">
          {([
            ['notas', 'Notas', StickyNote], ['lembretes', 'Lembretes', Bell], ['arquivos', 'Arquivos', Paperclip], ['moodboard', 'Moodboard', Images],
          ] as const).map(([id, label, Icon]) => (
            <button key={id} className={view === id ? 'on' : ''} aria-current={view === id ? 'page' : undefined} onClick={() => setView(id)}>
              <span className="tab-ico"><Icon size={20} /></span>
              {label}
              {id === 'lembretes' && live.some(isOverdue) && <i className="badge" aria-label="Lembretes atrasados" />}
            </button>
          ))}
        </nav>

        <Drawer
          open={drawer} onOpenChange={setDrawer} view={view} scope={scope} notes={notes} tags={allTags}
          go={go} openSettings={() => { setDrawer(false); setSettings(true) }}
        />

        <SettingsDialog open={settings} onOpenChange={setSettings} say={say} />

        {editing && (
          <Editor
            key={editing.id}
            note={editing}
            onClose={(n, msg) => {
              const empty = !n.title.trim() && !parse(n.html).text && !parse(n.html).imgs.length && !parse(n.html).checks.length
              if (!empty) update(n)
              else if (notes.some((x) => x.id === n.id)) update(n)
              setEditing(null)
              if (msg) say(msg)
            }}
          />
        )}

        <Lightbox data={lightbox} onClose={() => setLightbox(null)} onOpenNote={(id) => { setLightbox(null); openNote(id) }} say={say} />

        <div className={`toast ${toast ? 'show' : ''}`} role="status" aria-live="polite">{toast}</div>
      </div>
    </div>
  )
}

// ---------- drawer ----------
function Drawer(props: {
  open: boolean; onOpenChange: (b: boolean) => void; view: View; scope: Scope; notes: Note[]; tags: [string, number][]
  go: (v: View, s?: Scope) => void; openSettings: () => void
}) {
  const { notes, scope, view, go } = props
  const count = (id: string) => notes.filter((n) => n.category === id && !n.trashed && !n.archived).length
  const isOn = (k: Scope['kind'], id?: string) =>
    scope.kind === k && (id === undefined || (scope.kind === 'cat' && scope.id === id) || (scope.kind === 'tag' && scope.tag === id))
  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="drawer" aria-describedby={undefined}>
          <div className="drawer-head">
            <Dialog.Title className="brand">Ideário</Dialog.Title>
            <span className="meta">Sincronizado · Drive</span>
          </div>
          <div className="drawer-scroll">
            <button className={`d-item ${view === 'notas' && scope.kind === 'all' ? 'on' : ''}`} onClick={() => go('notas', { kind: 'all' })}><StickyNote size={19} />Notas</button>
            <button className={`d-item ${view === 'lembretes' ? 'on' : ''}`} onClick={() => go('lembretes')}><Bell size={19} />Lembretes</button>
            <button className={`d-item ${view === 'arquivos' ? 'on' : ''}`} onClick={() => go('arquivos', scope.kind === 'archive' || scope.kind === 'trash' ? { kind: 'all' } : undefined)}><Paperclip size={19} />Arquivos</button>
            <button className={`d-item ${view === 'moodboard' ? 'on' : ''}`} onClick={() => go('moodboard', scope.kind === 'archive' || scope.kind === 'trash' ? { kind: 'all' } : undefined)}><Images size={19} />Moodboard</button>

            <div className="d-sep" />
            <div className="d-label"><span>Categorias</span><button className="link">Editar</button></div>
            {CATEGORIES.map((c) => (
              <button key={c.id} className={`d-item ${isOn('cat', c.id) ? 'on' : ''}`} onClick={() => go(view === 'lembretes' ? 'notas' : view, { kind: 'cat', id: c.id })}>
                <i className="dot lg" style={{ background: c.dot }} />
                <span className="grow">{c.name}</span>
                <span className="count">{count(c.id)}</span>
              </button>
            ))}
            <button className="d-item muted"><Plus size={19} />Nova categoria</button>

            <div className="d-sep" />
            <div className="d-label"><span>Tags</span></div>
            <div className="tag-cloud">
              {props.tags.map(([t, n]) => (
                <button key={t} className={`chip ${isOn('tag', t) ? 'on' : ''}`} onClick={() => go(view === 'lembretes' ? 'notas' : view, { kind: 'tag', tag: t })}>
                  #{t}<span className="count">{n}</span>
                </button>
              ))}
            </div>

            <div className="d-sep" />
            <button className={`d-item ${isOn('archive') ? 'on' : ''}`} onClick={() => go('notas', { kind: 'archive' })}><Archive size={19} />Arquivo</button>
            <button className={`d-item ${isOn('trash') ? 'on' : ''}`} onClick={() => go('notas', { kind: 'trash' })}><Trash2 size={19} />Lixeira</button>
            <button className="d-item" onClick={props.openSettings}><Settings size={19} />Configurações</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ---------- notes ----------
function matches(n: Note, q: string) {
  if (!q) return true
  const s = q.toLowerCase().replace(/^#/, '')
  return n.title.toLowerCase().includes(s) || parse(n.html).text.toLowerCase().includes(s) || n.tags.some((t) => t.includes(s))
}
function inScope(n: Note, scope: Scope) {
  if (scope.kind === 'trash') return !!n.trashed
  if (scope.kind === 'archive') return !!n.archived && !n.trashed
  if (n.trashed || n.archived) return false
  if (scope.kind === 'cat') return n.category === scope.id
  if (scope.kind === 'tag') return n.tags.includes(scope.tag)
  return true
}

function NotesView({ notes, scope, query, layout, onOpen, onTag }: {
  notes: Note[]; scope: Scope; query: string; layout: 'grid' | 'list'; onOpen: (id: string) => void; onTag: (t: string) => void
}) {
  const list = notes.filter((n) => inScope(n, scope) && matches(n, query)).sort((a, b) => a.updatedHoursAgo - b.updatedHoursAgo)
  const pinned = scope.kind === 'trash' ? [] : list.filter((n) => n.pinned)
  const rest = list.filter((n) => !pinned.includes(n))
  if (!list.length)
    return (
      <Empty
        icon={scope.kind === 'trash' ? <Trash2 /> : scope.kind === 'archive' ? <Archive /> : <StickyNote />}
        title={query ? 'Nada encontrado' : scope.kind === 'trash' ? 'Lixeira vazia' : scope.kind === 'archive' ? 'Nada arquivado' : 'Nenhuma nota aqui'}
        text={query ? `Nenhuma nota contém “${query}”.` : 'Toque em + para anotar algo.'}
      />
    )
  const grid = (ns: Note[]) => (
    <div className={layout === 'grid' ? 'masonry' : 'stack'}>
      {ns.map((n) => <NoteCard key={n.id} n={n} onOpen={onOpen} onTag={onTag} />)}
    </div>
  )
  return (
    <>
      {scope.kind === 'trash' && <p className="banner">Notas na lixeira são apagadas depois de 30 dias.</p>}
      {pinned.length > 0 && <><h2 className="section-label">Fixadas</h2>{grid(pinned)}</>}
      {pinned.length > 0 && rest.length > 0 && <h2 className="section-label">Outras</h2>}
      {rest.length > 0 && grid(rest)}
    </>
  )
}

function NoteCard({ n, onOpen, onTag }: { n: Note; onOpen: (id: string) => void; onTag: (t: string) => void }) {
  const { imgs, checks, text } = useMemo(() => parse(n.html), [n.html])
  const cover = imgs[0] ? IMG_BY_ID[imgs[0]] : null
  const cat = CAT_BY_ID[n.category]
  return (
    <article className={`card c-${n.color}`} onClick={() => onOpen(n.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(n.id)}>
      {cover && (
        <div className="card-media">
          <img src={imgSrc(cover)} alt="" style={{ aspectRatio: `${cover.w}/${cover.h}` }} />
          {imgs.length > 1 && <span className="more">+{imgs.length - 1}</span>}
        </div>
      )}
      <div className="card-body">
        {n.title && <h3>{n.title}</h3>}
        {text && <p className={n.title ? 'excerpt' : 'excerpt big'}>{text}</p>}
        {checks.length > 0 && (
          <ul className="mini-check">
            {checks.slice(0, 4).map((c, i) => (
              <li key={i} className={c.done ? 'done' : ''}><span className="box">{c.done && <Check size={10} strokeWidth={3} />}</span>{c.text}</li>
            ))}
            {checks.length > 4 && <li className="more-items">+{checks.length - 4} itens</li>}
          </ul>
        )}
        {(n.reminder || cat || n.tags.length > 0 || FILES.some((f) => f.noteId === n.id)) && (
          <div className="card-meta">
            {n.reminder && (
              <span className={`pill ${isOverdue(n) ? 'late' : ''} ${n.reminderDone ? 'done' : ''}`}><Bell size={11} />{fmtReminder(n.reminder)}</span>
            )}
            {cat && <span className="pill"><i className="dot" style={{ background: cat.dot }} />{cat.name.split(' ')[0]}</span>}
            {FILES.some((f) => f.noteId === n.id) && <span className="pill"><Paperclip size={11} />{FILES.filter((f) => f.noteId === n.id).length}</span>}
            {n.tags.map((t) => (
              <button key={t} className="pill tag" onClick={(e) => { e.stopPropagation(); onTag(t) }}>#{t}</button>
            ))}
          </div>
        )}
      </div>
    </article>
  )
}

function Empty({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="empty">
      <div className="empty-ico">{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  )
}

// ---------- reminders ----------
function RemindersView({ notes, query, onOpen, onDone }: { notes: Note[]; query: string; onOpen: (id: string) => void; onDone: (n: Note) => void }) {
  const [showDone, setShowDone] = useState(false)
  const withR = notes.filter((n) => n.reminder && matches(n, query) && (showDone || !n.reminderDone))
    .sort((a, b) => +new Date(a.reminder!) - +new Date(b.reminder!))
  const groups: [string, Note[]][] = [
    ['Atrasados', withR.filter((n) => isOverdue(n))],
    ['Hoje', withR.filter((n) => !isOverdue(n) && dayDiff(n.reminder!) === 0)],
    ['Amanhã', withR.filter((n) => !isOverdue(n) && dayDiff(n.reminder!) === 1)],
    ['Próximos', withR.filter((n) => !isOverdue(n) && dayDiff(n.reminder!) > 1)],
    ['Concluídos', withR.filter((n) => n.reminderDone && !isOverdue(n) && dayDiff(n.reminder!) < 0)],
  ]
  return (
    <>
      <div className="toolbar">
        <p className="hint">Lembretes ficam dentro das notas. Esta aba reúne todos por data.</p>
        <label className="switch-row">
          <Switch.Root id="mostrar-concluidos" className="switch" checked={showDone} onCheckedChange={setShowDone}><Switch.Thumb className="thumb" /></Switch.Root>
          Concluídos
        </label>
      </div>
      {!withR.length && <Empty icon={<Bell />} title="Nenhum lembrete" text="Abra uma nota e toque no sino para lembrar dela depois." />}
      {groups.filter(([, g]) => g.length).map(([label, g]) => (
        <section key={label} className="r-group">
          <h2 className={`section-label ${label === 'Atrasados' ? 'late' : ''}`}>{label}<span className="count">{g.length}</span></h2>
          <div className="r-list">
            {g.map((n) => {
              const cat = CAT_BY_ID[n.category]
              const d = new Date(n.reminder!)
              return (
                <div key={n.id} className={`r-item ${n.reminderDone ? 'done' : ''}`}>
                  <button className="r-check" aria-label={n.reminderDone ? 'Reabrir lembrete' : 'Concluir lembrete'} onClick={() => onDone(n)}>
                    {n.reminderDone && <Check size={14} strokeWidth={3} />}
                  </button>
                  <button className="r-main" onClick={() => onOpen(n.id)}>
                    <span className="r-title">{n.title || parse(n.html).text}</span>
                    <span className="r-sub">
                      {cat && <><i className="dot" style={{ background: cat.dot }} />{cat.name}</>}
                      {!cat && 'Sem categoria'}
                    </span>
                  </button>
                  <span className={`r-time ${isOverdue(n) ? 'late' : ''}`}>
                    <b>{d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</b>
                    {Math.abs(dayDiff(n.reminder!)) > 1 && <small>{d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}</small>}
                    {dayDiff(n.reminder!) === -1 && <small>ontem</small>}
                  </span>
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </>
  )
}

// ---------- files ----------
type FileRow = { id: string; name: string; type: 'foto' | 'pdf' | 'doc' | 'planilha' | 'audio'; kb: number; origKB?: number; noteId: string; noteTitle: string; cat: string; daysAgo: number; img?: Img }

function FilesView({ notes, scope, query, onOpen, onImage }: {
  notes: Note[]; scope: Scope; query: string; onOpen: (id: string) => void; onImage: (i: Img, noteId: string) => void
}) {
  const [type, setType] = useState('tudo')
  const [sort, setSort] = useState('recentes')
  const [mode, setMode] = useState<'grid' | 'list'>('list')

  const rows: FileRow[] = useMemo(() => {
    const out: FileRow[] = []
    notes.filter((n) => inScope(n, scope)).forEach((n) => {
      parse(n.html).imgs.forEach((id) => {
        const i = IMG_BY_ID[id]
        out.push({ id: n.id + id, name: i.name, type: 'foto', kb: i.optKB, origKB: i.origKB, noteId: n.id, noteTitle: n.title || 'Sem título', cat: n.category, daysAgo: Math.round(n.updatedHoursAgo / 24), img: i })
      })
      FILES.filter((f) => f.noteId === n.id).forEach((f) =>
        out.push({ id: f.id, name: f.name, type: f.kind, kb: f.kb, noteId: n.id, noteTitle: n.title || 'Sem título', cat: n.category, daysAgo: f.daysAgo }),
      )
    })
    return out
  }, [notes, scope])

  const list = rows
    .filter((r) => (type === 'tudo' || r.type === type) && (!query || (r.name + r.noteTitle).toLowerCase().includes(query.toLowerCase())))
    .sort((a, b) => (sort === 'nome' ? a.name.localeCompare(b.name) : sort === 'tamanho' ? b.kb - a.kb : a.daysAgo - b.daysAgo))

  const saved = rows.filter((r) => r.origKB).reduce((s, r) => s + (r.origKB! - r.kb), 0)
  const total = rows.reduce((s, r) => s + r.kb, 0)
  const icon = (t: FileRow['type']) =>
    t === 'pdf' ? <FileText size={20} /> : t === 'planilha' ? <FileSpreadsheet size={20} /> : t === 'audio' ? <FileAudio size={20} /> : <FileIcon size={20} />

  return (
    <>
      <div className="stats">
        <div><b>{rows.length}</b><span>arquivos</span></div>
        <div><b>{fmtKB(total)}</b><span>no Drive</span></div>
        <div className="good"><b>−{fmtKB(saved)}</b><span>economizados nas fotos</span></div>
      </div>

      <ToggleGroup.Root type="single" value={type} onValueChange={(v) => v && setType(v)} className="seg scroll-x" aria-label="Tipo de arquivo">
        {[['tudo', 'Tudo'], ['foto', 'Fotos'], ['pdf', 'PDFs'], ['doc', 'Documentos'], ['planilha', 'Planilhas'], ['audio', 'Áudio']].map(([v, l]) => (
          <ToggleGroup.Item key={v} value={v} className="seg-item">{l}<span className="count">{v === 'tudo' ? rows.length : rows.filter((r) => r.type === v).length}</span></ToggleGroup.Item>
        ))}
      </ToggleGroup.Root>

      <div className="toolbar">
        <Picker
          id="ordenar"
          value={sort}
          onChange={setSort}
          prefix="Ordenar:"
          options={[['recentes', 'Mais recentes'], ['nome', 'Nome'], ['tamanho', 'Tamanho']]}
        />
        <ToggleGroup.Root type="single" value={mode} onValueChange={(v) => v && setMode(v as 'grid' | 'list')} className="seg tight" aria-label="Visualização">
          <ToggleGroup.Item value="list" className="seg-item" aria-label="Lista"><Rows3 size={16} /></ToggleGroup.Item>
          <ToggleGroup.Item value="grid" className="seg-item" aria-label="Grade"><LayoutGrid size={16} /></ToggleGroup.Item>
        </ToggleGroup.Root>
      </div>

      {!list.length && <Empty icon={<Paperclip />} title="Nenhum arquivo" text="Mude o filtro ou anexe algo a uma nota." />}

      {mode === 'list' ? (
        <div className="f-list">
          {list.map((r) => (
            <button key={r.id} className="f-row" onClick={() => (r.img ? onImage(r.img, r.noteId) : onOpen(r.noteId))}>
              {r.img ? <img className="f-thumb" src={imgSrc(r.img)} alt="" /> : <span className={`f-ico t-${r.type}`}>{icon(r.type)}</span>}
              <span className="f-text">
                <span className="f-name">{r.name}</span>
                <span className="f-sub">
                  {CAT_BY_ID[r.cat] && <i className="dot" style={{ background: CAT_BY_ID[r.cat].dot }} />}
                  {r.noteTitle} · {r.daysAgo === 0 ? 'hoje' : `há ${r.daysAgo} d`}
                </span>
              </span>
              <span className="f-size">
                {fmtKB(r.kb)}
                {r.origKB && <small>de {fmtKB(r.origKB)}</small>}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="f-grid">
          {list.map((r) => (
            <button key={r.id} className="f-tile" onClick={() => (r.img ? onImage(r.img, r.noteId) : onOpen(r.noteId))}>
              {r.img ? <img src={imgSrc(r.img)} alt="" /> : <span className={`f-ico big t-${r.type}`}>{icon(r.type)}</span>}
              <span className="f-name">{r.name}</span>
              <span className="f-sub">{fmtKB(r.kb)}</span>
            </button>
          ))}
        </div>
      )}
    </>
  )
}

function Picker({ id, value, onChange, options, prefix }: { id: string; value: string; onChange: (v: string) => void; options: string[][]; prefix?: string }) {
  return (
    <Select.Root value={value} onValueChange={onChange}>
      <Select.Trigger id={id} className="picker" aria-label={prefix}>
        {prefix && <span className="muted">{prefix}</span>}
        <Select.Value />
        <Select.Icon><ChevronDown size={15} /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="menu" position="popper" sideOffset={6}>
          <Select.Viewport>
            {options.map(([v, l]) => (
              <Select.Item key={v} value={v} className="menu-item">
                <Select.ItemText>{l}</Select.ItemText>
                <Select.ItemIndicator className="menu-check"><Check size={15} /></Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  )
}

// ---------- moodboard ----------
function MoodboardView({ notes, scope, query, onImage }: { notes: Note[]; scope: Scope; query: string; onImage: (i: Img, noteId: string) => void }) {
  const [tone, setTone] = useState<Tone | ''>('')
  const items = notes
    .filter((n) => inScope(n, scope) && matches(n, query))
    .flatMap((n) => parse(n.html).imgs.map((id) => ({ img: IMG_BY_ID[id], note: n })))
    .filter((x) => !tone || x.img.tone === tone)
  return (
    <>
      <div className="tones" role="group" aria-label="Filtrar por cor">
        {TONES.map((t) => (
          <button key={t.id} className={`tone ${tone === t.id ? 'on' : ''}`} aria-pressed={tone === t.id} onClick={() => setTone(tone === t.id ? '' : t.id)}>
            <i style={{ background: t.sw }} />{t.label}
          </button>
        ))}
      </div>
      {!items.length && <Empty icon={<Images />} title="Nenhuma imagem" text="Imagens coladas nas notas aparecem aqui automaticamente." />}
      <div className="mood">
        {items.map(({ img, note }) => (
          <button key={note.id + img.id} className="mood-tile" onClick={() => onImage(img, note.id)}>
            <img src={imgSrc(img)} alt={img.name} style={{ aspectRatio: `${img.w}/${img.h}` }} />
            <span className="mood-pal">{img.pal.map((p) => <i key={p} style={{ background: p }} />)}</span>
            <span className="mood-cap">{note.title || 'Sem título'}</span>
          </button>
        ))}
      </div>
    </>
  )
}

function Lightbox({ data, onClose, onOpenNote, say }: { data: { img: Img; noteId: string } | null; onClose: () => void; onOpenNote: (id: string) => void; say: (s: string) => void }) {
  const copy = async (hex: string) => {
    try { await navigator.clipboard.writeText(hex); say(`${hex} copiado`) } catch { say(hex) }
  }
  return (
    <Dialog.Root open={!!data} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay dark" />
        <Dialog.Content className="lightbox" aria-describedby={undefined}>
          {data && (
            <>
              <div className="lb-top">
                <Dialog.Close className="icon-btn on-dark" aria-label="Fechar"><X size={20} /></Dialog.Close>
                <Dialog.Title className="lb-title">{data.img.name}</Dialog.Title>
              </div>
              <img className="lb-img" src={imgSrc(data.img)} alt="" />
              <div className="lb-sheet">
                <div className="lb-pal">
                  {data.img.pal.map((p) => (
                    <button key={p} onClick={() => copy(p)} aria-label={`Copiar ${p}`}>
                      <i style={{ background: p }} />
                      <code>{p}</code>
                    </button>
                  ))}
                </div>
                <p className="lb-opt">
                  <span>Original {fmtKB(data.img.origKB)}</span>
                  <span className="arrow">→</span>
                  <b>WebP {fmtKB(data.img.optKB)}</b>
                  <span className="good">−{Math.round((1 - data.img.optKB / data.img.origKB) * 100)}%</span>
                </p>
                <div className="lb-actions">
                  <button className="btn ghost" onClick={() => say('Original mantido no Drive')}><Download size={16} />Original</button>
                  <button className="btn primary" onClick={() => onOpenNote(data.noteId)}>Abrir nota</button>
                </div>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ---------- editor ----------
function Editor({ note, onClose }: { note: Note; onClose: (n: Note, msg?: string) => void }) {
  const [n, setN] = useState(note)
  const body = useRef<HTMLDivElement | null>(null)
  const isNew = !note.title && !note.html
  const attachBody = (el: HTMLDivElement | null) => {
    if (el && body.current !== el) {
      body.current = el
      el.innerHTML = hydrate(note.html)
      if (isNew) setTimeout(() => el.focus(), 30)
    }
  }

  const snapshot = (): Note => {
    const html = dehydrate(body.current?.innerHTML || '')
    const tags = [...new Set([...n.tags, ...hashTags(parse(html).text)])]
    return { ...n, html, tags, updatedHoursAgo: 0 }
  }
  const close = (patch?: Partial<Note>, msg?: string) => onClose({ ...snapshot(), ...patch }, msg)

  const exec = (cmd: string, val?: string) => {
    body.current?.focus()
    document.execCommand(cmd, false, val)
  }
  const insertChecklist = () => exec('insertHTML', '<ul class="check"><li data-done="false">&#8203;</li></ul>')
  const insertImage = (id: string) => exec('insertHTML', `<img data-img="${id}" src="${imgSrc(IMG_BY_ID[id])}" alt=""><p><br></p>`)

  const onBodyClick = (e: React.MouseEvent) => {
    const li = (e.target as HTMLElement).closest('ul.check li') as HTMLElement | null
    if (li && e.nativeEvent.offsetX < 30) li.setAttribute('data-done', li.getAttribute('data-done') === 'true' ? 'false' : 'true')
  }

  const [tagDraft, setTagDraft] = useState('')
  const addTag = () => {
    const t = tagDraft.trim().replace(/^#/, '').toLowerCase()
    if (t && !n.tags.includes(t)) setN({ ...n, tags: [...n.tags, t] })
    setTagDraft('')
  }
  const files = FILES.filter((f) => f.noteId === n.id)

  return (
    <Dialog.Root open onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Content className={`editor c-${n.color}`} aria-describedby={undefined} onOpenAutoFocus={(e) => !isNew && e.preventDefault()}>
          <div className="ed-top">
            <button className="icon-btn" aria-label="Voltar e salvar" onClick={() => close()}><ArrowLeft size={20} /></button>
            <span className="ed-saved">{isNew ? 'Nova nota' : `Editada ${ago(note.updatedHoursAgo)}`}</span>
            <button className="icon-btn" aria-label={n.pinned ? 'Desafixar' : 'Fixar'} aria-pressed={n.pinned} onClick={() => setN({ ...n, pinned: !n.pinned })}>
              {n.pinned ? <PinOff size={19} /> : <Pin size={19} />}
            </button>
            <ReminderPopover value={n.reminder} onChange={(r) => setN({ ...n, reminder: r, reminderDone: false })} />
            <DropdownMenu.Root>
              <DropdownMenu.Trigger className="icon-btn" aria-label="Mais opções"><MoreVertical size={19} /></DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="menu" align="end" sideOffset={6}>
                  {note.trashed ? (
                    <DropdownMenu.Item className="menu-item" onSelect={() => close({ trashed: false }, 'Nota restaurada')}><ArchiveRestore size={16} />Restaurar</DropdownMenu.Item>
                  ) : (
                    <>
                      <DropdownMenu.Item className="menu-item" onSelect={() => close({ archived: !n.archived }, n.archived ? 'Nota desarquivada' : 'Nota arquivada')}>
                        {n.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}{n.archived ? 'Desarquivar' : 'Arquivar'}
                      </DropdownMenu.Item>

                      <DropdownMenu.Separator className="menu-sep" />
                      <DropdownMenu.Item className="menu-item danger" onSelect={() => close({ trashed: true }, 'Nota movida para a lixeira')}><Trash2 size={16} />Mover para a lixeira</DropdownMenu.Item>
                    </>
                  )}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>

          <div className="ed-scroll">
            <Dialog.Title asChild>
              <input id="titulo" className="ed-title" placeholder="Título" value={n.title} onChange={(e) => setN({ ...n, title: e.target.value })} />
            </Dialog.Title>
            <div
              ref={attachBody}
              id="corpo"
              className="ed-body prose"
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-multiline
              aria-label="Texto da nota"
              data-placeholder="Escreva… use #tag para marcar"
              onClick={onBodyClick}
            />

            {files.length > 0 && (
              <div className="ed-files">
                {files.map((f) => (
                  <span key={f.id} className="ed-file"><Paperclip size={14} /><span>{f.name}</span><small>{fmtKB(f.kb)}</small></span>
                ))}
              </div>
            )}

            <div className="ed-meta">
              <Select.Root value={n.category} onValueChange={(v) => setN({ ...n, category: v })}>
                <Select.Trigger id="categoria" className="picker" aria-label="Categoria">
                  {CAT_BY_ID[n.category] ? <i className="dot" style={{ background: CAT_BY_ID[n.category].dot }} /> : <Tag size={14} />}
                  <Select.Value />
                  <Select.Icon><ChevronDown size={15} /></Select.Icon>
                </Select.Trigger>
                <Select.Portal>
                  <Select.Content className="menu" position="popper" sideOffset={6}>
                    <Select.Viewport>
                      <Select.Item value="none" className="menu-item"><Select.ItemText>Sem categoria</Select.ItemText></Select.Item>
                      {CATEGORIES.map((c) => (
                        <Select.Item key={c.id} value={c.id} className="menu-item">
                          <i className="dot" style={{ background: c.dot }} />
                          <Select.ItemText>{c.name}</Select.ItemText>
                          <Select.ItemIndicator className="menu-check"><Check size={15} /></Select.ItemIndicator>
                        </Select.Item>
                      ))}
                    </Select.Viewport>
                  </Select.Content>
                </Select.Portal>
              </Select.Root>
              {n.reminder && (
                <span className={`pill ${isOverdue(n) ? 'late' : ''}`}>
                  <Bell size={11} />{fmtReminder(n.reminder)}
                  <button aria-label="Remover lembrete" onClick={() => setN({ ...n, reminder: null })}><X size={12} /></button>
                </span>
              )}
            </div>

            <div className="ed-tags">
              {n.tags.map((t) => (
                <span key={t} className="pill tag">#{t}<button aria-label={`Remover ${t}`} onClick={() => setN({ ...n, tags: n.tags.filter((x) => x !== t) })}><X size={12} /></button></span>
              ))}
              <input
                id="nova-tag"
                className="tag-input"
                placeholder="+ tag"
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === ',') { e.preventDefault(); addTag() } }}
                onBlur={addTag}
              />
            </div>
          </div>

          <div className="ed-tools" role="toolbar" aria-label="Formatação">
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => exec('bold')} aria-label="Negrito"><Bold size={18} /></button>
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => exec('italic')} aria-label="Itálico"><Italic size={18} /></button>
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => exec('formatBlock', 'h3')} aria-label="Título"><Heading size={18} /></button>
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertUnorderedList')} aria-label="Lista"><List size={18} /></button>
            <button onMouseDown={(e) => e.preventDefault()} onClick={insertChecklist} aria-label="Checklist"><ListChecks size={18} /></button>
            <Popover.Root>
              <Popover.Trigger aria-label="Inserir imagem" onMouseDown={(e) => e.preventDefault()}><ImagePlus size={18} /></Popover.Trigger>
              <Popover.Portal>
                <Popover.Content className="pop" side="top" sideOffset={10} onOpenAutoFocus={(e) => e.preventDefault()}>
                  <p className="pop-title">Inserir no texto</p>
                  <p className="pop-hint">A foto é otimizada para WebP antes de entrar na nota.</p>
                  <div className="pick-grid">
                    {IMGS.map((i) => (
                      <Popover.Close key={i.id} asChild>
                        <button onClick={() => insertImage(i.id)} aria-label={i.name}><img src={imgSrc(i)} alt="" /></button>
                      </Popover.Close>
                    ))}
                  </div>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
            <Popover.Root>
              <Popover.Trigger aria-label="Cor da nota"><Palette size={18} /></Popover.Trigger>
              <Popover.Portal>
                <Popover.Content className="pop" side="top" sideOffset={10}>
                  <p className="pop-title">Cor da nota</p>
                  <div className="color-row">
                    {COLORS.map((c) => (
                      <button key={c.id} className={`swatch c-${c.id} ${n.color === c.id ? 'on' : ''}`} aria-label={c.label} aria-pressed={n.color === c.id} onClick={() => setN({ ...n, color: c.id })}>
                        {n.color === c.id && <Check size={14} />}
                      </button>
                    ))}
                  </div>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ReminderPopover({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const nextMonday = (() => { const d = new Date(); const add = ((8 - d.getDay()) % 7) || 7; return add })()
  const quick: [string, string][] = [
    ['Hoje à noite', atLocal(new Date().getHours() >= 18 ? 1 : 0, 18)],
    ['Amanhã de manhã', atLocal(1, 9)],
    ['Segunda que vem', atLocal(nextMonday, 9)],
  ]
  return (
    <Popover.Root>
      <Popover.Trigger className={`icon-btn ${value ? 'active' : ''}`} aria-label="Lembrete"><Bell size={19} /></Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="pop" align="end" sideOffset={6}>
          <p className="pop-title">Lembrar de mim</p>
          <div className="quick">
            {quick.map(([l, iso]) => (
              <Popover.Close key={l} asChild>
                <button onClick={() => onChange(iso)}><Clock size={15} /><span>{l}</span><small>{fmtReminder(iso)}</small></button>
              </Popover.Close>
            ))}
          </div>
          <label className="field">
            <span>Data e hora</span>
            <input id="lembrete-data" type="datetime-local" value={value ? toLocalInput(value) : ''} onChange={(e) => e.target.value && onChange(new Date(e.target.value).toISOString())} />
          </label>
          {value && <Popover.Close asChild><button className="btn ghost full" onClick={() => onChange(null)}>Remover lembrete</button></Popover.Close>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

// ---------- settings ----------
function SettingsDialog({ open, onOpenChange, say }: { open: boolean; onOpenChange: (b: boolean) => void; say: (s: string) => void }) {
  const [wifi, setWifi] = useState(true)
  const [keepOrig, setKeepOrig] = useState(false)
  const [quality, setQuality] = useState('equilibrada')
  const [cache, setCache] = useState([2])
  const used = 0.31
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="sheet" aria-describedby={undefined}>
          <div className="sheet-head">
            <Dialog.Title className="sheet-title">Configurações</Dialog.Title>
            <Dialog.Close className="icon-btn" aria-label="Fechar"><X size={20} /></Dialog.Close>
          </div>
          <div className="sheet-scroll">
            <section className="set-group">
              <h3>Sincronização</h3>
              <div className="sync-card">
                <CloudCheck size={22} />
                <div>
                  <b>Google Drive conectado</b>
                  <span>Última sincronização há 2 min · 214 notas</span>
                </div>
                <button className="btn ghost sm" onClick={() => say('Sincronizando…')}>Agora</button>
              </div>
              <label className="set-row" htmlFor="so-wifi">
                <span><b>Sincronizar só no Wi-Fi</b><small>Anexos grandes esperam o Wi-Fi. Texto sincroniza sempre.</small></span>
                <Switch.Root id="so-wifi" className="switch" checked={wifi} onCheckedChange={setWifi}><Switch.Thumb className="thumb" /></Switch.Root>
              </label>
            </section>

            <section className="set-group">
              <h3>Fotos</h3>
              <div className="set-row">
                <span><b>Qualidade</b><small>Aplicada ao importar.</small></span>
                <Picker id="qualidade" value={quality} onChange={setQuality} options={[['economica', 'Econômica · 1280px'], ['equilibrada', 'Equilibrada · 2048px'], ['alta', 'Alta · 3072px']]} />
              </div>
              <label className="set-row" htmlFor="originais">
                <span><b>Manter originais</b><small>Guarda a foto sem compressão no Drive, além da versão otimizada.</small></span>
                <Switch.Root id="originais" className="switch" checked={keepOrig} onCheckedChange={setKeepOrig}><Switch.Thumb className="thumb" /></Switch.Root>
              </label>
            </section>

            <section className="set-group">
              <h3>Cache neste aparelho</h3>
              <div className="cache">
                <div className="cache-bar"><i style={{ width: `${(used / cache[0]) * 100}%` }} /></div>
                <p><b>{Math.round(used * 1000)} MB</b> usados de {cache[0].toString().replace('.', ',')} GB</p>
                <Slider.Root id="cache" className="slider" min={0.5} max={5} step={0.5} value={cache} onValueChange={setCache} aria-label="Limite do cache">
                  <Slider.Track className="track"><Slider.Range className="range" /></Slider.Track>
                  <Slider.Thumb className="s-thumb" aria-label="Limite do cache" />
                </Slider.Root>
                <small>Texto e miniaturas ficam sempre aqui. Anexos pouco usados saem primeiro quando o limite enche.</small>
              </div>
            </section>

            <section className="set-group">
              <h3>Importar</h3>
              <button className="import" onClick={() => say('Escolha o .zip do Google Takeout')}>
                <span className="import-ico"><StickyNote size={20} /></span>
                <span><b>Trazer notas do Google Keep</b><small>Marcadores viram categorias. Fotos são otimizadas no caminho.</small></span>
              </button>
            </section>
            <p className="footnote">Protótipo de design com dados de exemplo.</p>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
