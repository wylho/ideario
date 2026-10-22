// Menus de contexto de cada tipo de elemento. Um lugar só, para o mesmo item se comportar igual em todo o app.
import {
  ArrowDown, ArrowUp, Archive, Hash, ArchiveRestore, Bell, BellOff, CircleCheck, Copy, Pencil, Download, ExternalLink, Files, Filter, FilterX, Image, Palette, Pin, PinOff, FileText, Play, Plus, Tag, Trash2, AlarmClock, Eye, EyeOff, Lock, LockOpen, KeyRound,
} from '@lucide/svelte'
import { copyNoteId, shortId } from './noteid'
import { api } from './api'
import { exportEntries } from './exporting'
import { app } from './app.svelte'
import { fmtReminder, normalizeTag } from './format'
import { CATEGORY_COLORS, COLOR_NAMES, nextCategoryColor } from './colors'
import { SEP, type MenuEntry } from './menu'
import { quickTimes, snoozeTimes } from './reminders'
import { reminderSet } from './notify.svelte'
import { statusOf, type AttachmentRow, type Category, type NoteColor, type NotePatch, type NoteSummary } from './types'
import { t, tn, writeCard } from '@wylho/atrio'
import { STATUS, changeStatus, keepStatus, statusMenu } from './status'

export const NOTE_COLORS: { id: NoteColor; label: string; css: string }[] = [
  { id: 'none', get label() { return t('Padrão') }, css: 'var(--surface)' },
  { id: 'sand', get label() { return t('Areia') }, css: 'var(--n-sand)' },
  { id: 'sage', get label() { return t('Sálvia') }, css: 'var(--n-sage)' },
  { id: 'sky', get label() { return t('Céu') }, css: 'var(--n-sky)' },
  { id: 'rose', get label() { return t('Rosa') }, css: 'var(--n-rose)' },
  { id: 'lilac', get label() { return t('Lilás') }, css: 'var(--n-lilac)' },
  { id: 'butter', get label() { return t('Manteiga') }, css: 'var(--n-butter)' },
]

/** `done` é o aviso de copiado ("Texto copiado"). */
async function copy(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text)
    app.say(done)
  } catch {
    app.say(t('Não foi possível copiar'))
  }
}

/** Copia a nota como card do Atrio: o Nodo cola como nó com a nota, e outra janela do Ideario como nota nova. */
export async function copyCard(id: string) {
  try {
    await writeCard(await api.noteCard(id))
    app.say(t('Copiado como card'))
  } catch {
    app.say(t('Não foi possível copiar'))
  }
}

/** Aplica uma mudança e oferece desfazer, como no Keep. */
function change(n: NoteSummary, patch: NotePatch, msg?: string) {
  const before = Object.fromEntries(Object.keys(patch).map((k) => [k, n[k as keyof NoteSummary]])) as NotePatch
  void api.updateNote(n.id, patch)
  if (msg) app.say(msg, { label: t('Desfazer'), run: () => void api.updateNote(n.id, before) })
}

/** Baixar um anexo: no app vai para a pasta Downloads e o aviso diz onde; no navegador, o download normal. */
export async function download(a: Pick<AttachmentRow, 'hash' | 'name' | 'mime'>) {
  try {
    const path = await api.downloadAttachment(a)
    if (path) app.say(t('Salvo em Downloads: {nome}', { nome: path.split(/[\\/]/).pop() ?? '' }))
  } catch {
    app.say(t('Não foi possível salvar o arquivo'))
  }
}

/** A mesma mudança em várias notas, com um "Desfazer" só para todas. */
export function changeMany(notes: NoteSummary[], patch: NotePatch, msg: string) {
  const before = notes.map((n) => [n.id, Object.fromEntries(Object.keys(patch).map((k) => [k, n[k as keyof NoteSummary]])) as NotePatch] as const)
  for (const n of notes) void api.updateNote(n.id, patch)
  app.say(msg, { label: t('Desfazer'), run: () => before.forEach(([id, p]) => void api.updateNote(id, p)) })
}


function reminderEntries(n: Pick<NoteSummary, 'id' | 'reminderAt'>, set: (v: number | null) => void, times = quickTimes()): MenuEntry[] {
  return [
    ...times.map(([label, at]) => ({ label, icon: AlarmClock, hint: fmtReminder(at).replace(/^.*?, /, ''), onSelect: () => set(at) })),
    ...(n.reminderAt != null ? [SEP, { label: t('Remover lembrete'), icon: BellOff, onSelect: () => set(null) }] : []),
  ]
}

export function noteMenu(n: NoteSummary): MenuEntry[] {
  if (n.trashedAt != null) {
    return [
      { label: t('Abrir'), icon: ExternalLink, onSelect: () => app.openNote(n.id) },
      { label: t('Selecionar'), icon: CircleCheck, onSelect: () => app.toggleSelect(n.id) },
      { label: t('Restaurar'), icon: ArchiveRestore, onSelect: () => change(n, { trashedAt: null }, t('Nota restaurada')) },
      SEP,
      {
        label: t('Excluir para sempre'), icon: Trash2, danger: true,
        onSelect: () =>
          app.confirm({
            title: t('Excluir para sempre?'),
            text: t('A nota sai deste aparelho e do Drive. Não dá para desfazer.'),
            confirm: t('Excluir'),
            onconfirm: () => void api.deleteNote(n.id).then(() => app.say(t('Nota excluída'))),
          }),
      },
    ]
  }
  return [
    { label: t('Abrir'), icon: ExternalLink, onSelect: () => app.openNote(n.id) },
    { label: t('Selecionar'), icon: CircleCheck, onSelect: () => app.toggleSelect(n.id) },
    { label: n.pinned ? t('Desafixar') : t('Fixar'), icon: n.pinned ? PinOff : Pin, onSelect: () => change(n, { pinned: !n.pinned }) },
    {
      label: n.reminderAt != null ? t('Lembrete') : t('Lembrar'), icon: Bell,
      sub: reminderEntries(n, (v) => {
        // Sem lembrete não há repetição (senão um lembrete marcado depois voltaria a se repetir sozinho).
        change(n, v == null ? { reminderAt: null, reminderRepeat: null, ...keepStatus(n) } : { reminderAt: v, reminderDone: false }, v == null ? t('Lembrete removido') : t('Lembrete: {quando}', { quando: fmtReminder(v) }))
        if (v != null) void reminderSet()
      }),
    },
    statusMenu(n),
    {
      label: t('Cor'), icon: Palette,
      sub: NOTE_COLORS.map((c) => ({ label: c.label, swatch: c.css, checked: n.color === c.id, onSelect: () => change(n, { color: c.id }) })),
    },
    {
      label: t('Categoria'), icon: Tag,
      sub: [
        { label: t('Sem categoria'), checked: !n.categoryId, onSelect: () => change(n, { categoryId: null }) },
        SEP,
        ...app.categories.map((c) => ({
          label: c.name, swatch: c.color, checked: n.categoryId === c.id,
          // clicar na que já está marcada tira a categoria
          onSelect: () => (n.categoryId === c.id ? change(n, { categoryId: null }, t('Sem categoria')) : change(n, { categoryId: c.id }, t('Movida para {nome}', { nome: c.name }))),
        })),
        SEP,
        { label: t('Nova categoria…'), icon: Plus, onSelect: () => newCategory((id, name) => change(n, { categoryId: id }, t('Movida para {nome}', { nome: name }))) },
      ],
    },
    SEP,
    { label: t('Copiar texto'), icon: Copy, onSelect: async () => copy(await api.noteText(n.id), t('Texto copiado')) },
    { label: t('Copiar como card'), icon: Copy, hint: t('cola no Nodo'), onSelect: () => void copyCard(n.id) },
    { label: t('Copiar ID'), icon: Hash, hint: shortId(n.id), onSelect: () => void copyNoteId(n.id, (m) => app.say(m)) },
    {
      label: t('Fazer uma cópia'), icon: Files,
      onSelect: async () => {
        const id = await api.duplicateNote(n.id)
        app.say(t('Cópia criada'), { label: t('Abrir'), run: () => app.openNote(id) })
      },
    },
    { label: t('Exportar'), icon: Download, sub: exportEntries(n.id, n.title, n.imageCount + n.fileCount > 0, () => app.openNote(n.id, { print: true })) },
    SEP,
    n.archived
      ? { label: t('Desarquivar'), icon: ArchiveRestore, onSelect: () => change(n, { archived: false }, t('Nota desarquivada')) }
      : { label: t('Arquivar'), icon: Archive, onSelect: () => change(n, { archived: true }, t('Nota arquivada')) },
    { label: t('Mover para a lixeira'), icon: Trash2, danger: true, onSelect: () => change(n, { trashedAt: Date.now() }, t('Nota movida para a lixeira')) },
  ]
}

export function reminderMenu(n: NoteSummary): MenuEntry[] {
  return [
    { label: t('Abrir nota'), icon: ExternalLink, onSelect: () => app.openNote(n.id) },
    // Status (o seletor de três cores): os dois que a nota não está.
    ...(['todo', 'doing', 'done'] as const)
      .filter((st) => st !== statusOf(n))
      .map((st) => ({
        label: st === 'done' ? (n.reminderRepeat ? t('Feito por esta vez') : t('Concluir')) : st === 'doing' ? t('Em andamento') : n.reminderDone ? t('Reabrir') : t('A fazer'),
        swatch: STATUS[st].color,
        onSelect: () => void changeStatus(n, st),
      })),
    {
      label: t('Adiar'), icon: AlarmClock,
      sub: snoozeTimes().map(([label, at]) => ({
        label, hint: fmtReminder(at).replace(/^.*?, /, ''),
        // O que se repete avisa de novo nessa hora sem mudar o horário da série.
        onSelect: () => {
          const before = n.reminderAt
          void api.snoozeReminder(n.id, at)
          app.say(t('Adiado para {quando}', { quando: fmtReminder(at) }), n.reminderRepeat ? undefined : { label: t('Desfazer'), run: () => void api.updateNote(n.id, { reminderAt: before }) })
        },
      })),
    },
    SEP,
    { label: t('Remover lembrete'), icon: BellOff, danger: true, onSelect: () => change(n, { reminderAt: null, reminderRepeat: null, ...keepStatus(n) }, t('Lembrete removido')) },
  ]
}

export function attachmentMenu(r: AttachmentRow): MenuEntry[] {
  return [
    ...(r.kind === 'image' ? [{ label: t('Ver imagem'), icon: Image, onSelect: () => (app.lightbox = r) }] : []),
    ...(r.kind === 'pdf' ? [{ label: t('Ler PDF'), icon: FileText, onSelect: () => (app.lightbox = r) }] : []),
    ...(r.kind === 'video' || r.kind === 'audio' ? [{ label: t('Tocar'), icon: Play, onSelect: () => (app.lightbox = r) }] : []),
    { label: t('Abrir nota de origem'), icon: ExternalLink, onSelect: () => app.openNote(r.noteId) },
    { label: t('Baixar'), icon: Download, onSelect: () => void download(r) },
    SEP,
    { label: t('Copiar nome do arquivo'), icon: Copy, onSelect: () => copy(r.name, t('Nome copiado')) },
    ...(r.palette ? [{ label: t('Copiar cor'), icon: Palette, sub: r.palette.map((hex) => ({ label: hex, swatch: hex, onSelect: () => copy(hex, t('{cor} copiado', { cor: hex })) })) }] : []),
  ]
}

/** Nova categoria: nome e cor (a primeira cor ainda não usada já vem marcada). */
export function newCategory(then?: (id: string, name: string) => void) {
  app.askName({
    title: t('Nova categoria'), label: t('Nome'), value: '', confirm: t('Criar'),
    color: nextCategoryColor(app.categories.map((c) => c.color)),
    submit: (name, color) => void api.createCategory(name, color!).then((c) => then?.(c.id, c.name)),
  })
}

/** Categoria com PIN e bloqueada: o menu só oferece abrir (nada de renomear, apagar ou ver o que tem dentro). */
function lockedMenu(c: Category): MenuEntry[] {
  return [{ label: t('Abrir com o PIN…'), icon: Lock, onSelect: () => app.askUnlock(c, () => { app.setCategory(c.id); app.drawerOpen = false }) }]
}

function privacyEntries(c: Category): MenuEntry[] {
  const hide: MenuEntry = c.hidden
    ? { label: t('Mostrar nas listas'), icon: Eye, onSelect: () => void api.setCategoryHidden(c.id, false).then(() => app.say(t('{nome} volta a aparecer em Tudo', { nome: c.name }))) }
    : {
        label: t('Ocultar das listas'), icon: EyeOff, hint: t('some de Tudo'),
        onSelect: () => void api.setCategoryHidden(c.id, true).then(() => app.say(t('{nome} oculta: as notas dela não aparecem em Tudo nem na busca', { nome: c.name }))),
      }
  if (!c.locked) {
    return [
      hide,
      {
        label: t('Proteger com PIN…'), icon: Lock,
        onSelect: () => app.askPin({
          title: t('Proteger {nome} com PIN', { nome: c.name }),
          text: t('As notas dela somem de Tudo, da busca, dos lembretes e do Claude; para abrir, clique na categoria e digite o PIN. Vale em todos os aparelhos. Não é criptografia: protege de olhares, não de quem mexe nos arquivos do computador.'),
          fields: [t('PIN (4 a 8 números)'), t('Repita o PIN')],
          confirm: t('Proteger'),
          submit: async ([pin, again]) => {
            if (pin !== again) return t('Os dois PINs não são iguais.')
            await api.setCategoryPin(c.id, null, pin)
            app.say(t('{nome} protegida com PIN', { nome: c.name }))
            return null
          },
        }),
      },
    ]
  }
  return [
    {
      label: t('Bloquear agora'), icon: Lock,
      onSelect: () => void api.lockCategory(c.id).then(() => {
        if (app.filter.categoryId === c.id) app.filter.categoryId = null
        app.say(t('{nome} bloqueada', { nome: c.name }))
      }),
    },
    {
      label: t('Mudar o PIN…'), icon: KeyRound,
      onSelect: () => app.askPin({
        title: t('Mudar o PIN de {nome}', { nome: c.name }),
        fields: [t('PIN atual'), t('PIN novo'), t('Repita o PIN novo')],
        confirm: t('Mudar'),
        submit: async ([current, pin, again]) => {
          if (pin !== again) return t('Os dois PINs novos não são iguais.')
          await api.setCategoryPin(c.id, current, pin)
          app.say(t('PIN mudado'))
          return null
        },
      }),
    },
    {
      label: t('Tirar o PIN…'), icon: LockOpen,
      onSelect: () => app.askPin({
        title: t('Tirar o PIN de {nome}', { nome: c.name }),
        text: t('A categoria volta a ser como as outras (se estiver oculta, continua oculta).'),
        fields: [t('PIN atual')],
        confirm: t('Tirar o PIN'),
        submit: async ([current]) => {
          await api.setCategoryPin(c.id, current, null)
          app.say(t('{nome} sem PIN', { nome: c.name }))
          return null
        },
      }),
    },
  ]
}

/** Mover na ordem (o arrastar do toque e do teclado). A ordem da tela vira a manual. */
function moveEntries(id: string): MenuEntry[] {
  const ids = app.categories.map((c) => c.id)
  const i = ids.indexOf(id)
  const move = (to: number) => {
    ids.splice(i, 1)
    ids.splice(to, 0, id)
    app.reorderCategories(ids)
  }
  return [
    { label: t('Mover para cima'), icon: ArrowUp, disabled: i <= 0, onSelect: () => move(i - 1) },
    { label: t('Mover para baixo'), icon: ArrowDown, disabled: i < 0 || i >= ids.length - 1, onSelect: () => move(i + 1) },
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
    app.say(t('Categoria {nome} apagada', { nome: c.name }), { label: t('Desfazer'), run: () => void api.restoreCategory(id, notes) })
  }
  return [
    on
      ? { label: t('Tirar filtro {nome}', { nome: c.name }), icon: FilterX, onSelect: () => app.setCategory(id) }
      : { label: t('Filtrar por {nome}', { nome: c.name }), icon: Filter, onSelect: () => { if (!on) app.openCategory(id); app.drawerOpen = false } },
    {
      label: t('Nova nota em {onde}', { onde: c.name }), icon: Plus,
      onSelect: () => { app.drawerOpen = false; app.openNew({ categoryId: id, tags: [] }) },
    },
    {
      label: t('Ver lembretes de {nome}', { nome: c.name }), icon: Bell,
      onSelect: () => { app.filter.categoryId = id; app.setView('reminders'); app.drawerOpen = false },
    },
    SEP,
    {
      label: t('Renomear…'), icon: Pencil,
      onSelect: () => app.askName({ title: t('Renomear categoria'), label: t('Nome'), value: c.name, confirm: t('Salvar'), submit: (name) => void api.updateCategory(id, { name }) }),
    },
    {
      label: t('Cor'), icon: Palette,
      sub: CATEGORY_COLORS.map((col) => ({ label: COLOR_NAMES[col] ? t(COLOR_NAMES[col]) : col, swatch: col, checked: c.color.toLowerCase() === col.toLowerCase(), onSelect: () => void api.updateCategory(id, { color: col }) })),
    },
    ...moveEntries(id),
    SEP,
    ...privacyEntries(c),
    SEP,
    { label: t('Apagar categoria'), icon: Trash2, danger: true, hint: c.noteCount ? t('as notas ficam') : undefined, onSelect: () => void remove() },
  ]
}

export function tagMenu(tag: string): MenuEntry[] {
  const on = app.filter.tags.includes(tag)
  return [
    { label: on ? t('Tirar do filtro') : t('Adicionar ao filtro'), icon: on ? FilterX : Filter, onSelect: () => app.toggleTag(tag) },
    { label: t('Só esta tag'), icon: Tag, onSelect: () => { app.filter = { categoryId: null, tags: [tag] }; app.drawerOpen = false } },
    { label: t('Nova nota com #{tag}', { tag }), icon: Plus, onSelect: () => { app.drawerOpen = false; app.openNew({ categoryId: null, tags: [tag] }) } },
    SEP,
    {
      label: t('Renomear…'), icon: Pencil,
      onSelect: () =>
        app.askName({
          title: t('Renomear #{tag}', { tag }), label: t('Novo nome'), value: tag, confirm: t('Renomear'),
          submit: (to) =>
            void api.renameTag(tag, to).then((n) => {
              if (app.filter.tags.includes(tag)) app.filter.tags = app.filter.tags.map((x) => (x === tag ? normalizeTag(to) : x))
              app.say(tn(n, 'Tag renomeada em {n} nota', 'Tag renomeada em {n} notas'))
            }),
        }),
    },
    {
      label: t('Tirar de todas as notas'), icon: Trash2, danger: true,
      onSelect: () =>
        app.confirm({
          title: t('Tirar #{tag} de todas as notas?', { tag }),
          text: t('A tag sai das notas. Onde ela estava escrita no texto, a palavra continua, só sem o #.'),
          confirm: t('Tirar'),
          onconfirm: () =>
            void api.renameTag(tag, null).then((n) => {
              app.filter.tags = app.filter.tags.filter((x) => x !== tag)
              app.say(tn(n, 'Tag tirada de {n} nota', 'Tag tirada de {n} notas'))
            }),
        }),
    },
  ]
}
