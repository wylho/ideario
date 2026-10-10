// Menus de contexto de cada tipo de elemento. Um lugar só, para o mesmo item se comportar igual em todo o app.
import {
  Archive, ArchiveRestore, Bell, BellOff, Check, CircleCheck, Copy, Pencil, Download, ExternalLink, Files, Filter, FilterX, Image, Palette, Pin, PinOff,
  Play, Plus, RotateCcw, Tag, Trash2, AlarmClock,
} from '@lucide/svelte'
import { api } from './api'
import { app } from './app.svelte'
import { fmtReminder, normalizeTag } from './format'
import { CATEGORY_COLORS, COLOR_NAMES, nextCategoryColor } from './colors'
import { SEP, type MenuEntry } from './menu'
import { quickTimes, snoozeTimes } from './reminders'
import { reminderSet } from './notify.svelte'
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

/** Baixar um anexo: no app vai para a pasta Downloads e o aviso diz onde; no navegador, o download normal. */
export async function download(a: Pick<AttachmentRow, 'hash' | 'name' | 'mime'>) {
  try {
    const path = await api.downloadAttachment(a)
    if (path) app.say(`Salvo em Downloads: ${path.split(/[\\/]/).pop()}`)
  } catch {
    app.say('Não foi possível salvar o arquivo')
  }
}

/** A mesma mudança em várias notas, com um "Desfazer" só para todas. */
export function changeMany(notes: NoteSummary[], patch: NotePatch, msg: string) {
  const before = notes.map((n) => [n.id, Object.fromEntries(Object.keys(patch).map((k) => [k, n[k as keyof NoteSummary]])) as NotePatch] as const)
  for (const n of notes) void api.updateNote(n.id, patch)
  app.say(msg, { label: 'Desfazer', run: () => before.forEach(([id, p]) => void api.updateNote(id, p)) })
}

/** "Nota arquivada" ou "3 notas arquivadas". */
export const manyMsg = (n: number, one: string, many: string) => (n === 1 ? `Nota ${one}` : `${n} notas ${many}`)

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
      { label: 'Selecionar', icon: CircleCheck, onSelect: () => app.toggleSelect(n.id) },
      { label: 'Restaurar', icon: ArchiveRestore, onSelect: () => change(n, { trashedAt: null }, 'Nota restaurada') },
      SEP,
      {
        label: 'Excluir para sempre', icon: Trash2, danger: true,
        onSelect: () =>
          app.confirm({
            title: 'Excluir para sempre?',
            text: 'A nota sai deste aparelho e do Drive. Não dá para desfazer.',
            confirm: 'Excluir',
            onconfirm: () => void api.deleteNote(n.id).then(() => app.say('Nota excluída')),
          }),
      },
    ]
  }
  return [
    { label: 'Abrir', icon: ExternalLink, onSelect: () => app.openNote(n.id) },
    { label: 'Selecionar', icon: CircleCheck, onSelect: () => app.toggleSelect(n.id) },
    { label: n.pinned ? 'Desafixar' : 'Fixar', icon: n.pinned ? PinOff : Pin, onSelect: () => change(n, { pinned: !n.pinned }) },
    {
      label: n.reminderAt != null ? 'Lembrete' : 'Lembrar', icon: Bell,
      sub: reminderEntries(n, (v) => {
        // Sem lembrete não há repetição (senão um lembrete marcado depois voltaria a se repetir sozinho).
        change(n, v == null ? { reminderAt: null, reminderDone: false, reminderRepeat: null } : { reminderAt: v, reminderDone: false }, v == null ? 'Lembrete removido' : `Lembrete: ${fmtReminder(v)}`)
        if (v != null) void reminderSet()
      }),
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
        SEP,
        { label: 'Nova categoria…', icon: Plus, onSelect: () => newCategory((id, name) => change(n, { categoryId: id }, `Movida para ${name}`)) },
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
    { label: 'Remover lembrete', icon: BellOff, danger: true, onSelect: () => change(n, { reminderAt: null, reminderDone: false, reminderRepeat: null }, 'Lembrete removido') },
  ]
}

export function attachmentMenu(r: AttachmentRow): MenuEntry[] {
  return [
    ...(r.kind === 'image' ? [{ label: 'Ver imagem', icon: Image, onSelect: () => (app.lightbox = r) }] : []),
    ...(r.kind === 'video' || r.kind === 'audio' ? [{ label: 'Tocar', icon: Play, onSelect: () => (app.lightbox = r) }] : []),
    { label: 'Abrir nota de origem', icon: ExternalLink, onSelect: () => app.openNote(r.noteId) },
    { label: 'Baixar', icon: Download, onSelect: () => void download(r) },
    SEP,
    { label: 'Copiar nome do arquivo', icon: Copy, onSelect: () => copy(r.name, 'Nome') },
    ...(r.palette ? [{ label: 'Copiar cor', icon: Palette, sub: r.palette.map((hex) => ({ label: hex, swatch: hex, onSelect: () => copy(hex, hex) })) }] : []),
  ]
}

/** Nova categoria: nome e cor (a primeira cor ainda não usada já vem marcada). */
export function newCategory(then?: (id: string, name: string) => void) {
  app.askName({
    title: 'Nova categoria', label: 'Nome', value: '', confirm: 'Criar',
    color: nextCategoryColor(app.categories.map((c) => c.color)),
    submit: (name, color) => void api.createCategory(name, color!).then((c) => then?.(c.id, c.name)),
  })
}

export function categoryMenu(id: string): MenuEntry[] {
  const c = app.category(id)
  if (!c) return []
  const on = app.filter.categoryId === id
  const remove = async () => {
    const notes = await api.deleteCategory(id)
    if (app.filter.categoryId === id) app.filter.categoryId = null
    app.say(`Categoria ${c.name} apagada`, { label: 'Desfazer', run: () => void api.restoreCategory(id, notes) })
  }
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
    SEP,
    {
      label: 'Renomear…', icon: Pencil,
      onSelect: () => app.askName({ title: 'Renomear categoria', label: 'Nome', value: c.name, confirm: 'Salvar', submit: (name) => void api.updateCategory(id, { name }) }),
    },
    {
      label: 'Cor', icon: Palette,
      sub: CATEGORY_COLORS.map((col) => ({ label: COLOR_NAMES[col] ?? col, swatch: col, checked: c.color.toLowerCase() === col.toLowerCase(), onSelect: () => void api.updateCategory(id, { color: col }) })),
    },
    { label: 'Apagar categoria', icon: Trash2, danger: true, hint: c.noteCount ? 'as notas ficam' : undefined, onSelect: () => void remove() },
  ]
}

export function tagMenu(tag: string): MenuEntry[] {
  const on = app.filter.tags.includes(tag)
  return [
    { label: on ? 'Tirar do filtro' : 'Adicionar ao filtro', icon: on ? FilterX : Filter, onSelect: () => app.toggleTag(tag) },
    { label: 'Só esta tag', icon: Tag, onSelect: () => { app.filter = { categoryId: null, tags: [tag] }; app.drawerOpen = false } },
    { label: `Nova nota com #${tag}`, icon: Plus, onSelect: () => { app.drawerOpen = false; app.openNew({ categoryId: null, tags: [tag] }) } },
    SEP,
    {
      label: 'Renomear…', icon: Pencil,
      onSelect: () =>
        app.askName({
          title: `Renomear #${tag}`, label: 'Novo nome', value: tag, confirm: 'Renomear',
          submit: (to) =>
            void api.renameTag(tag, to).then((n) => {
              if (app.filter.tags.includes(tag)) app.filter.tags = app.filter.tags.map((t) => (t === tag ? normalizeTag(to) : t))
              app.say(n === 1 ? 'Tag renomeada em 1 nota' : `Tag renomeada em ${n} notas`)
            }),
        }),
    },
    {
      label: 'Tirar de todas as notas', icon: Trash2, danger: true,
      onSelect: () =>
        app.confirm({
          title: `Tirar #${tag} de todas as notas?`,
          text: 'A tag sai das notas. Onde ela estava escrita no texto, a palavra continua, só sem o #.',
          confirm: 'Tirar',
          onconfirm: () =>
            void api.renameTag(tag, null).then((n) => {
              app.filter.tags = app.filter.tags.filter((t) => t !== tag)
              app.say(n === 1 ? 'Tag tirada de 1 nota' : `Tag tirada de ${n} notas`)
            }),
        }),
    },
  ]
}
