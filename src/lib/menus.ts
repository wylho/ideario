// Menus de contexto de cada tipo de elemento. Um lugar só, para o mesmo item se comportar igual em todo o app.
import {
  Archive, ArchiveRestore, Bell, BellOff, Check, Copy, Download, ExternalLink, Files, Filter, FilterX, Image, Palette, Pin, PinOff,
  Play, Plus, RotateCcw, Tag, Trash2, AlarmClock,
} from '@lucide/svelte'
import { api } from './api'
import { app } from './app.svelte'
import { fmtReminder } from './format'
import { SEP, type MenuEntry } from './menu'
import { quickTimes, snoozeTimes } from './reminders'
import type { AttachmentRow, NoteColor, NotePatch, NoteSummary } from './types'

export const NOTE_COLORS: { id: NoteColor; label: string; css: string }[] = [
  { id: 'none', label: 'Padrão', css: 'var(--surface)' },
  { id: 'sand', label: 'Areia', css: 'var(--n-sand)' },
  { id: 'sage', label: 'Sálvia', css: 'var(--n-sage)' },
  { id: 'sky', label: 'Céu', css: 'var(--n-sky)' },
  { id: 'rose', label: 'Rosa', css: 'var(--n-rose)' },
  { id: 'lilac', label: 'Lilás', css: 'var(--n-lilac)' },
  { id: 'butter', label: 'Manteiga', css: 'var(--n-butter)' },
]

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    app.say(`${what} copiado`)
  } catch {
    app.say('Não foi possível copiar')
  }
}

/** Aplica uma mudança e oferece desfazer, como no Keep. */
function change(n: NoteSummary, patch: NotePatch, msg?: string) {
  const before = Object.fromEntries(Object.keys(patch).map((k) => [k, n[k as keyof NoteSummary]])) as NotePatch
  void api.updateNote(n.id, patch)
  if (msg) app.say(msg, { label: 'Desfazer', run: () => void api.updateNote(n.id, before) })
}

function reminderEntries(n: Pick<NoteSummary, 'id' | 'reminderAt'>, set: (v: number | null) => void, times = quickTimes()): MenuEntry[] {
  return [
    ...times.map(([label, at]) => ({ label, icon: AlarmClock, hint: fmtReminder(at).replace(/^.*?, /, ''), onSelect: () => set(at) })),
    ...(n.reminderAt != null ? [SEP, { label: 'Remover lembrete', icon: BellOff, onSelect: () => set(null) }] : []),
  ]
}

export function noteMenu(n: NoteSummary): MenuEntry[] {
  if (n.trashedAt != null) {
    return [
      { label: 'Abrir', icon: ExternalLink, onSelect: () => app.openNote(n.id) },
      { label: 'Restaurar', icon: ArchiveRestore, onSelect: () => change(n, { trashedAt: null }, 'Nota restaurada') },
      SEP,
      {
        label: 'Excluir para sempre', icon: Trash2, danger: true,
        onSelect: () => { void api.deleteNote(n.id); app.say('Nota excluída') },
      },
    ]
  }
  return [
    { label: 'Abrir', icon: ExternalLink, onSelect: () => app.openNote(n.id) },
    { label: n.pinned ? 'Desafixar' : 'Fixar', icon: n.pinned ? PinOff : Pin, onSelect: () => change(n, { pinned: !n.pinned }) },
    {
      label: n.reminderAt != null ? 'Lembrete' : 'Lembrar', icon: Bell,
      sub: reminderEntries(n, (v) => change(n, { reminderAt: v, reminderDone: false }, v == null ? 'Lembrete removido' : `Lembrete: ${fmtReminder(v)}`)),
    },
    {
      label: 'Cor', icon: Palette,
      sub: NOTE_COLORS.map((c) => ({ label: c.label, swatch: c.css, checked: n.color === c.id, onSelect: () => change(n, { color: c.id }) })),
    },
    {
      label: 'Categoria', icon: Tag,
      sub: [
        { label: 'Sem categoria', checked: !n.categoryId, onSelect: () => change(n, { categoryId: null }) },
        SEP,
        ...app.categories.map((c) => ({
          label: c.name, swatch: c.color, checked: n.categoryId === c.id,
          onSelect: () => change(n, { categoryId: c.id }, `Movida para ${c.name}`),
        })),
      ],
    },
    SEP,
    { label: 'Copiar texto', icon: Copy, onSelect: async () => copy(await api.noteText(n.id), 'Texto') },
    {
      label: 'Fazer uma cópia', icon: Files,
      onSelect: async () => {
        const id = await api.duplicateNote(n.id)
        app.say('Cópia criada', { label: 'Abrir', run: () => app.openNote(id) })
      },
    },
    SEP,
    n.archived
      ? { label: 'Desarquivar', icon: ArchiveRestore, onSelect: () => change(n, { archived: false }, 'Nota desarquivada') }
      : { label: 'Arquivar', icon: Archive, onSelect: () => change(n, { archived: true }, 'Nota arquivada') },
    { label: 'Mover para a lixeira', icon: Trash2, danger: true, onSelect: () => change(n, { trashedAt: Date.now() }, 'Nota movida para a lixeira') },
  ]
}

export function reminderMenu(n: NoteSummary): MenuEntry[] {
  return [
    { label: 'Abrir nota', icon: ExternalLink, onSelect: () => app.openNote(n.id) },
    n.reminderDone
      ? { label: 'Reabrir', icon: RotateCcw, onSelect: () => change(n, { reminderDone: false }, 'Lembrete reaberto') }
      : { label: 'Concluir', icon: Check, onSelect: () => change(n, { reminderDone: true }, 'Lembrete concluído') },
    {
      label: 'Adiar', icon: AlarmClock,
      sub: snoozeTimes().map(([label, at]) => ({
        label, hint: fmtReminder(at).replace(/^.*?, /, ''),
        onSelect: () => change(n, { reminderAt: at, reminderDone: false }, `Adiado para ${fmtReminder(at)}`),
      })),
    },
    SEP,
    { label: 'Remover lembrete', icon: BellOff, danger: true, onSelect: () => change(n, { reminderAt: null, reminderDone: false }, 'Lembrete removido') },
  ]
}

export function attachmentMenu(r: AttachmentRow): MenuEntry[] {
  return [
    ...(r.kind === 'image' ? [{ label: 'Ver imagem', icon: Image, onSelect: () => (app.lightbox = r) }] : []),
    ...(r.kind === 'video' || r.kind === 'audio' ? [{ label: 'Tocar', icon: Play, onSelect: () => (app.lightbox = r) }] : []),
    { label: 'Abrir nota de origem', icon: ExternalLink, onSelect: () => app.openNote(r.noteId) },
    { label: 'Baixar', icon: Download, onSelect: () => void api.downloadAttachment(r) },
    SEP,
    { label: 'Copiar nome do arquivo', icon: Copy, onSelect: () => copy(r.name, 'Nome') },
    ...(r.palette ? [{ label: 'Copiar cor', icon: Palette, sub: r.palette.map((hex) => ({ label: hex, swatch: hex, onSelect: () => copy(hex, hex) })) }] : []),
  ]
}

export function categoryMenu(id: string): MenuEntry[] {
  const c = app.category(id)
  if (!c) return []
  const on = app.filter.categoryId === id
  return [
    on
      ? { label: `Tirar filtro ${c.name}`, icon: FilterX, onSelect: () => app.setCategory(id) }
      : { label: `Filtrar por ${c.name}`, icon: Filter, onSelect: () => { if (!on) app.setCategory(id); app.drawerOpen = false } },
    {
      label: `Nova nota em ${c.name}`, icon: Plus,
      onSelect: () => { app.drawerOpen = false; app.openNew({ categoryId: id, tags: [] }) },
    },
    {
      label: `Ver lembretes de ${c.name}`, icon: Bell,
      onSelect: () => { app.filter.categoryId = id; app.setView('reminders'); app.drawerOpen = false },
    },
  ]
}

export function tagMenu(tag: string): MenuEntry[] {
  const on = app.filter.tags.includes(tag)
  return [
    { label: on ? 'Tirar do filtro' : 'Adicionar ao filtro', icon: on ? FilterX : Filter, onSelect: () => app.toggleTag(tag) },
    { label: 'Só esta tag', icon: Tag, onSelect: () => { app.filter = { categoryId: null, tags: [tag] }; app.drawerOpen = false } },
    { label: `Nova nota com #${tag}`, icon: Plus, onSelect: () => { app.drawerOpen = false; app.openNew({ categoryId: null, tags: [tag] }) } },
  ]
}
