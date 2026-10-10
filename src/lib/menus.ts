// Menus de contexto de cada tipo de elemento. Um lugar só, para o mesmo item se comportar igual em todo o app.
import {
  Archive, ArchiveRestore, Bell, BellOff, Check, CircleCheck, Copy, Pencil, Download, ExternalLink, Files, Filter, FilterX, Image, Palette, Pin, PinOff, FileText, Play, Plus, RotateCcw, Tag, Trash2, AlarmClock, Eye, EyeOff, Lock, LockOpen, KeyRound,
} from '@lucide/svelte'
import { api } from './api'
import { exportEntries } from './exporting'
import { app } from './app.svelte'
import { fmtReminder, normalizeTag } from './format'
import { CATEGORY_COLORS, COLOR_NAMES, nextCategoryColor } from './colors'
import { SEP, type MenuEntry } from './menu'
import { quickTimes, snoozeTimes } from './reminders'
import { reminderSet } from './notify.svelte'
import type { AttachmentRow, Category, NoteColor, NotePatch, NoteSummary } from './types'

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
    { label: 'Exportar', icon: Download, sub: exportEntries(n.id, n.title, n.imageCount + n.fileCount > 0, () => app.openNote(n.id, { print: true })) },
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
      : n.reminderRepeat
        ? {
            // Lembrete que se repete: "feito" vale para esta vez; a série continua.
            label: 'Feito por esta vez', icon: Check,
            onSelect: () => {
              const before = n.reminderAt
              void api.completeReminder(n.id)
              app.say('Feito por esta vez', { label: 'Desfazer', run: () => void api.updateNote(n.id, { reminderAt: before }) })
            },
          }
        : { label: 'Concluir', icon: Check, onSelect: () => change(n, { reminderDone: true }, 'Lembrete concluído') },
    {
      label: 'Adiar', icon: AlarmClock,
      sub: snoozeTimes().map(([label, at]) => ({
        label, hint: fmtReminder(at).replace(/^.*?, /, ''),
        // O que se repete avisa de novo nessa hora sem mudar o horário da série.
        onSelect: () => {
          const before = n.reminderAt
          void api.snoozeReminder(n.id, at)
          app.say(`Adiado para ${fmtReminder(at)}`, n.reminderRepeat ? undefined : { label: 'Desfazer', run: () => void api.updateNote(n.id, { reminderAt: before }) })
        },
      })),
    },
    SEP,
    { label: 'Remover lembrete', icon: BellOff, danger: true, onSelect: () => change(n, { reminderAt: null, reminderDone: false, reminderRepeat: null }, 'Lembrete removido') },
  ]
}

export function attachmentMenu(r: AttachmentRow): MenuEntry[] {
  return [
    ...(r.kind === 'image' ? [{ label: 'Ver imagem', icon: Image, onSelect: () => (app.lightbox = r) }] : []),
    ...(r.kind === 'pdf' ? [{ label: 'Ler PDF', icon: FileText, onSelect: () => (app.lightbox = r) }] : []),
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

/** Categoria com PIN e bloqueada: o menu só oferece abrir (nada de renomear, apagar ou ver o que tem dentro). */
function lockedMenu(c: Category): MenuEntry[] {
  return [{ label: 'Abrir com o PIN…', icon: Lock, onSelect: () => app.askUnlock(c, () => { app.setCategory(c.id); app.drawerOpen = false }) }]
}

function privacyEntries(c: Category): MenuEntry[] {
  const hide: MenuEntry = c.hidden
    ? { label: 'Mostrar nas listas', icon: Eye, onSelect: () => void api.setCategoryHidden(c.id, false).then(() => app.say(`${c.name} volta a aparecer em Tudo`)) }
    : {
        label: 'Ocultar das listas', icon: EyeOff, hint: 'some de Tudo',
        onSelect: () => void api.setCategoryHidden(c.id, true).then(() => app.say(`${c.name} oculta: as notas dela não aparecem em Tudo nem na busca`)),
      }
  if (!c.locked) {
    return [
      hide,
      {
        label: 'Proteger com PIN…', icon: Lock,
        onSelect: () => app.askPin({
          title: `Proteger ${c.name} com PIN`,
          text: 'As notas dela somem de Tudo, da busca, dos lembretes e do Claude; para abrir, clique na categoria e digite o PIN. Vale em todos os aparelhos. Não é criptografia: protege de olhares, não de quem mexe nos arquivos do computador.',
          fields: ['PIN (4 a 8 números)', 'Repita o PIN'],
          confirm: 'Proteger',
          submit: async ([pin, again]) => {
            if (pin !== again) return 'Os dois PINs não são iguais.'
            await api.setCategoryPin(c.id, null, pin)
            app.say(`${c.name} protegida com PIN`)
            return null
          },
        }),
      },
    ]
  }
  return [
    {
      label: 'Bloquear agora', icon: Lock,
      onSelect: () => void api.lockCategory(c.id).then(() => {
        if (app.filter.categoryId === c.id) app.filter.categoryId = null
        app.say(`${c.name} bloqueada`)
      }),
    },
    {
      label: 'Mudar o PIN…', icon: KeyRound,
      onSelect: () => app.askPin({
        title: `Mudar o PIN de ${c.name}`,
        fields: ['PIN atual', 'PIN novo', 'Repita o PIN novo'],
        confirm: 'Mudar',
        submit: async ([current, pin, again]) => {
          if (pin !== again) return 'Os dois PINs novos não são iguais.'
          await api.setCategoryPin(c.id, current, pin)
          app.say('PIN mudado')
          return null
        },
      }),
    },
    {
      label: 'Tirar o PIN…', icon: LockOpen,
      onSelect: () => app.askPin({
        title: `Tirar o PIN de ${c.name}`,
        text: 'A categoria volta a ser como as outras (se estiver oculta, continua oculta).',
        fields: ['PIN atual'],
        confirm: 'Tirar o PIN',
        submit: async ([current]) => {
          await api.setCategoryPin(c.id, current, null)
          app.say(`${c.name} sem PIN`)
          return null
        },
      }),
    },
  ]
}

export function categoryMenu(id: string): MenuEntry[] {
  const c = app.category(id)
  if (!c) return []
  if (c.locked && !c.unlocked) return lockedMenu(c)
  const on = app.filter.categoryId === id
  const remove = async () => {
    const notes = await api.deleteCategory(id)
    if (app.filter.categoryId === id) app.filter.categoryId = null
    app.say(`Categoria ${c.name} apagada`, { label: 'Desfazer', run: () => void api.restoreCategory(id, notes) })
  }
  return [
    on
      ? { label: `Tirar filtro ${c.name}`, icon: FilterX, onSelect: () => app.setCategory(id) }
      : { label: `Filtrar por ${c.name}`, icon: Filter, onSelect: () => { if (!on) app.openCategory(id); app.drawerOpen = false } },
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
    SEP,
    ...privacyEntries(c),
    SEP,
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
