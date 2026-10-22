<script lang="ts">
  import { t } from '@wylho/atrio'
  import { untrack } from 'svelte'
  // A nota aberta no Ideario: a janela em volta do card do Atrio (`NoteEditor`, o mesmo card do Nodo), o Y.Doc com o
  // salvamento contínuo e o sync, e o que só o Ideario tem (fixar, arquivar, lixeira, exportar, modo documento).
  import { Editor as TipTap } from '@tiptap/core'
  import { Dialog, DropdownMenu } from 'bits-ui'
  import { Archive, ArchiveRestore, ChevronRight, FileDown, Trash2 } from '@lucide/svelte'
  import { exportEntries, printNote } from '../lib/exporting'
  import { bareUrl, fillPreview, insertLinkCard, NoteEditor } from '@wylho/atrio/editor'
  import { CardTopBar, features, type CardHost } from '@wylho/atrio'
  import { isDocNote, setDocNote } from '../lib/docmode'
  import { api } from '../lib/api'
  import { download, newCategory } from '../lib/menus'
  import { app, type DroppedFile, type EditorTarget } from '../lib/app.svelte'
  import * as Y from 'yjs'
  import { BODY, readMeta, writeMeta, type NoteMeta } from '../lib/ydoc'
  import { makePreviews } from '../lib/previews.svelte'
  import { reminderSet } from '../lib/notify.svelte'
  import { ago } from '../lib/format'
  import { copyNoteId, shortId } from '../lib/noteid'
  import type { Attachment, SharedIn } from '../lib/types'

  let { target }: { target: EditorTarget } = $props()

  const SAVE_DELAY = 400
  /** O card do Ideario: tudo ligado. */
  const FEATURES = features()

  type Meta = NoteMeta

  // svelte-ignore state_referenced_locally
  const { id, isNew, defaults, start, print } = target
  // Modo documento: a nota em página inteira, coluna de leitura e letra maior. Lembrado por nota.
  let docMode = $state(isDocNote(id))
  function toggleDoc() {
    docMode = !docMode
    setDocNote(id, docMode)
  }
  let card: NoteEditor | undefined = $state()

  /** O que o card do Atrio pede ao Ideario. */
  const host: CardHost = {
    tags: () => app.tags,
    categories: () => app.categories,
    mediaUrl: (h) => api.mediaUrl(h),
    imageUrl: (h, size) => api.imageUrl(h, size),
    importFile: (f, name) => api.importFile(f, name),
    importPath: (p) => api.importPath(p),
    attachments: (hs) => api.getAttachments(hs),
    download: (a) => void download(a),
    openAttachment: (a) => viewAttachment(a),
    linkPreview: (u) => api.linkPreview(u),
    openUrl: (u) => void api.openUrl(u),
    markdownToDoc: (md) => api.markdownToDoc(md),
    clipboardImage: () => api.clipboardImage(),
    newCategory: (done) => newCategory(done),
    // O diálogo de nome do Ideario; fechar sem confirmar só deixa a pergunta sem resposta (nada é inserido).
    askText: (o) => new Promise((resolve) => app.askName({ ...o, value: '', submit: resolve })),
    onReminderSet: () => void reminderSet(),
    afterImport: (added) => {
      // PDF e vídeo ganham prévia (primeira página, um quadro) em segundo plano.
      if (added.some((a) => a.kind === 'pdf' || a.kind === 'video')) makePreviews()
    },
  }

  /** Compartilhado por outro app (Android): o assunto vira o título; um link sozinho vira cartão; o texto, parágrafos;
   *  os arquivos entram depois, como os arrastados. */
  function shareIn(ed: TipTap, s: SharedIn) {
    if (s.subject?.trim() && meta) meta.title = s.subject.trim()
    const text = s.text?.trim()
    const url = text ? bareUrl(text) : null
    if (url) {
      insertLinkCard(ed.view, url, 0, ed.state.doc.content.size)
      fillPreview(ed.view, url, (u) => api.linkPreview(u))
    } else if (text) {
      ed.commands.insertContent(text.split('\n').map((line) => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] })))
    }
    if (s.files.length) void card?.addFiles(s.files.map((path) => ({ path })))
  }

  let meta = $state<Meta | null>(null)
  let files = $state.raw<Attachment[]>([])
  let known = $state.raw<Attachment[]>([])
  let editedAt = $state<number | null>(null)
  let wasTrashed = $state(false)
  // A nota é um Y.Doc (Fase 2): o TipTap edita o `body` dele e os metadados ficam no `meta`. Cada mudança vira uma
  // atualização Yjs pequena, juntada e enviada ao núcleo pelo salvamento contínuo.
  const doc = new Y.Doc()
  const LOADED = Symbol('carregado')
  let pending: Uint8Array[] = []
  let persisted = !isNew
  let closed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  doc.on('update', (u: Uint8Array, origin: unknown) => {
    if (origin === LOADED) return
    pending.push(u)
    schedule()
  })

  if (isNew) {
    meta = {
      title: '', categoryId: defaults?.categoryId ?? null, color: 'none', pinned: false, archived: false,
      trashedAt: null, reminderAt: defaults?.reminderAt ?? null, reminderDone: false, reminderDoing: !!defaults?.reminderDoing, statusOn: !!defaults?.statusOn, reminderRepeat: null, emoji: null, tags: defaults?.tags ?? [],
    }
  } else {
    Promise.all([api.getNoteState(id), api.getNote(id)]).then(([state, n]) => {
      if (!n || !state.length) return void (app.editor = null)
      Y.applyUpdate(doc, state, LOADED)
      files = n.files
      known = n.media
      editedAt = n.updatedAt
      wasTrashed = n.trashedAt != null
      meta = readMeta(doc)
    })
  }

  // Outro aparelho excluiu esta nota de vez. Com algo escrito aqui ainda não salvo, a nota volta inteira (o que se
  // escreve não se perde); sem nada novo, fecha avisando.
  $effect(() =>
    api.subscribeRemoved((ids) => {
      if (closed || !ids.includes(id)) return
      if (pending.length) {
        persisted = false
        app.say(t('Esta nota foi excluída fora desta janela (em outro aparelho ou pelo Claude); o que você escreveu aqui a manteve.'))
        schedule()
      } else {
        closed = true
        clearTimeout(timer)
        card?.cancelRecording()
        app.editor = null
        app.say(t('Esta nota foi excluída fora desta janela (em outro aparelho ou pelo Claude).'))
      }
    }),
  )

  // Outro aparelho mudou esta nota (sync): junta na hora, sem fechar nem perder o que se está escrevendo aqui.
  $effect(() =>
    api.subscribeRemote((ids) => {
      if (closed || !persisted || !ids.includes(id)) return
      void api.getNoteState(id).then((state) => {
        if (closed) return
        Y.applyUpdate(doc, state, LOADED)
        meta = readMeta(doc)
      })
    }),
  )


  // ---------- salvamento contínuo ----------
  const isEmpty = () => !!card?.isEmpty()

  /** Envia o que mudou. Se o núcleo recusar, nada se perde: volta para a fila e tenta de novo. Devolve se salvou. */
  async function save(): Promise<boolean> {
    clearTimeout(timer)
    timer = undefined
    if (!card?.getEditor() || !meta) return true
    if (!persisted && isEmpty()) return true // nota nova vazia não é criada
    // Nota nova: vai o estado inteiro; depois, só o que mudou desde o último envio.
    const wasPersisted = persisted
    const sent = pending
    const update = persisted ? (pending.length ? Y.mergeUpdates(pending) : null) : Y.encodeStateAsUpdate(doc)
    pending = []
    persisted = true
    if (!update) return true
    try {
      await api.applyNoteUpdate(id, update)
      return true
    } catch {
      pending = [...sent, ...pending]
      persisted = wasPersisted
      if (!closed) timer = setTimeout(save, 2000)
      return false
    }
  }
  const schedule = () => {
    // Fechada, a nota já foi salva: um salvamento atrasado desfaria o "Desfazer" do aviso (ex.: arquivaria de novo).
    if (closed) return
    clearTimeout(timer)
    timer = setTimeout(save, SAVE_DELAY)
  }

  // Metadados editados na tela vão para o `meta` do Y.Doc (só as chaves que mudaram).
  $effect(() => {
    if (!meta) return
    const snap = $state.snapshot(meta)
    untrack(() => writeMeta(doc, snap))
  })

  async function close(patch?: Partial<Meta>, msg?: string) {
    if (closed) return
    closed = true
    // Gravando, a gravação entra na nota; arquivos ainda entrando esperam para entrar antes de salvar.
    await card?.settle()
    // O que muda ao sair (arquivar, lixeira, restaurar) pode ser desfeito pelo aviso.
    const before = meta && patch ? (Object.fromEntries(Object.keys(patch).map((k) => [k, meta![k as keyof Meta]])) as Partial<Meta>) : null
    if (meta && patch) Object.assign(meta, patch)
    if (meta) writeMeta(doc, $state.snapshot(meta))
    if (isNew && isEmpty()) {
      clearTimeout(timer)
      if (persisted) await api.deleteNote(id)
    } else if (!(await save())) {
      // Não salvou: a nota continua aberta, com tudo o que foi escrito.
      closed = false
      app.say(t('Não foi possível salvar a nota. Ela continua aberta; tente de novo.'))
      return
    }
    api.settle()
    app.editor = null
    if (msg) app.say(msg, before ? { label: t('Desfazer'), run: () => void api.updateNote(id, before) } : undefined)
  }

  function deleteForever() {
    app.confirm({
      title: t('Excluir para sempre?'),
      text: t('A nota sai deste aparelho e do Drive. Não dá para desfazer.'),
      confirm: t('Excluir'),
      onconfirm: async () => {
        closed = true
        clearTimeout(timer)
        card?.cancelRecording()
        await api.deleteNote(id)
        app.editor = null
        app.say(t('Nota excluída'))
      },
    })
  }


  // O texto do card nasceu: o que veio junto entra agora.
  function onReady(ed: TipTap) {
    // Atalhos do "+": já abre gravando, com a câmera ou com os arquivos escolhidos.
    if (start && 'files' in start) void card?.addFiles(start.files)
    else if (start && 'shared' in start) shareIn(ed, start.shared)
    else if (start && 'record' in start) card?.startRecording()
    // A câmera é outro diálogo: abrir no mesmo instante em que o editor nasce a deixava "aberta" e invisível
    // (e os cliques seguintes não faziam nada). Abre depois que o editor terminou de abrir.
    else if (start && 'camera' in start) setTimeout(() => card?.openCamera(), 0)
    // PDF pelo menu do card: abre e já imprime (as fotos têm um instante para carregar).
    if (print) setTimeout(() => void printNote(), 400)
    // Soltos no texto entram no ponto; fora dele (título, margens, fundo), no fim da nota.
    const drop = (list: DroppedFile[], at?: { x: number; y: number }) => {
      const inside = at && ed.view.dom.contains(document.elementFromPoint(at.x, at.y))
      const pos = inside ? ed.view.posAtCoords({ left: at.x, top: at.y })?.pos : undefined
      void card?.addFiles(list, pos ?? ed.state.doc.content.size)
    }
    app.dropIntoEditor = drop
    // Arquivo solto enquanto a nota ainda abria: entra agora.
    const early = app.pendingDrop
    if (early) {
      app.pendingDrop = null
      drop(early.files, early.at)
    }
    dropFn = drop
  }
  let dropFn: ((list: DroppedFile[], at?: { x: number; y: number }) => void) | null = null

  // O texto do card vai sumir: salva o que faltar.
  function onDestroy() {
    if (app.dropIntoEditor === dropFn) app.dropIntoEditor = null
    if (!closed) save()
    clearTimeout(timer)
  }

  /** Abre o anexo no visualizador: foto, vídeo, áudio e PDF; outros documentos mostram a ficha com Baixar. */
  function viewAttachment(a: Attachment) {
    app.lightbox = { ...a, noteId: id, noteTitle: meta?.title ?? '', categoryId: meta?.categoryId ?? null }
  }
</script>


{#if meta}
  <Dialog.Root open onOpenChange={(o) => !o && close()}>
    <Dialog.Portal>
      <Dialog.Overlay class="overlay ed-overlay" />
      <Dialog.Content class="editor c-{meta.color}" data-doc={docMode && app.wide ? '' : undefined} aria-describedby={undefined} onOpenAutoFocus={(e) => e.preventDefault()}>
        {@const m = meta}
        <NoteEditor
          bind:this={card}
          {meta}
          features={FEATURES}
          {host}
          ydoc={doc}
          field={BODY}
          {known}
          {files}
          autofocus={isNew}
          dialogTitle
          onready={onReady}
          ondestroy={onDestroy}
        >
          {#snippet top()}
            <CardTopBar
              meta={m}
              {card}
              onback={() => close()}
              backLabel={t('Voltar e salvar')}
              wide={app.wide}
              {docMode}
              ondoc={toggleDoc}
              pinned={m.pinned}
              onpin={() => m && (m.pinned = !m.pinned)}
              menu={wasTrashed ? trashMenu : undefined}
            >
              {#snippet label()}
                {isNew ? t('Nova nota') : editedAt ? t('Editada {quando}', { quando: ago(editedAt) }) : ''}
                <!-- ID curto: falar desta nota com o Claude ("na nota #a1b2c3d4"). Clicar copia. -->
                {#if !isNew}<button class="ed-id" title={t('Copiar o ID da nota (para o Claude)')} onclick={() => void copyNoteId(id, (msg) => app.say(msg))}>{shortId(id)}</button>{/if}
              {/snippet}
              {#snippet menuStart()}
                <DropdownMenu.Sub>
                  <DropdownMenu.SubTrigger class="menu-item"><FileDown size={16} /><span class="grow">{t('Exportar')}</span><ChevronRight size={16} /></DropdownMenu.SubTrigger>
                  <DropdownMenu.SubContent class="menu" sideOffset={4}>
                    {#each exportEntries(id, m.title, !!card?.hasMedia(), () => void printNote()) as e (e.label)}
                      <DropdownMenu.Item class="menu-item" onSelect={e.onSelect}><e.icon size={16} />{e.label}</DropdownMenu.Item>
                    {/each}
                  </DropdownMenu.SubContent>
                </DropdownMenu.Sub>
              {/snippet}
              {#snippet menuEnd()}
                <DropdownMenu.Separator class="menu-sep" />
                <DropdownMenu.Item class="menu-item" onSelect={() => m && close({ archived: !m.archived }, m.archived ? t('Nota desarquivada') : t('Nota arquivada'))}>
                  {#if m.archived}<ArchiveRestore size={16} />{t('Desarquivar')}{:else}<Archive size={16} />{t('Arquivar')}{/if}
                </DropdownMenu.Item>
                <DropdownMenu.Separator class="menu-sep" />
                <DropdownMenu.Item class="menu-item danger" onSelect={() => close({ trashedAt: Date.now() }, t('Nota movida para a lixeira'))}><Trash2 size={16} />{t('Mover para a lixeira')}</DropdownMenu.Item>
              {/snippet}
            </CardTopBar>
          {/snippet}
        </NoteEditor>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
{/if}

<!-- Nota na lixeira: o menu do card só tem restaurar e excluir. -->
{#snippet trashMenu()}
  <DropdownMenu.Item class="menu-item" onSelect={() => close({ trashedAt: null }, t('Nota restaurada'))}><ArchiveRestore size={16} />{t('Restaurar')}</DropdownMenu.Item>
  <DropdownMenu.Separator class="menu-sep" />
  <DropdownMenu.Item class="menu-item danger" onSelect={deleteForever}><Trash2 size={16} />{t('Excluir para sempre')}</DropdownMenu.Item>
{/snippet}
