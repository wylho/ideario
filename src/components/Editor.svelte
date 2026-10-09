<script lang="ts">
  import { mount, untrack, unmount } from 'svelte'
  import { Editor as TipTap } from '@tiptap/core'
  import { NodeSelection } from '@tiptap/pm/state'
  import { Dialog, DropdownMenu, Popover, Select } from 'bits-ui'
  import {
    Archive, ArchiveRestore, ArrowLeft, Bold, Camera, Check, ChevronDown, ChevronLeft, ChevronRight, Columns2, Heading, Image, Italic, List,
    ListChecks, Mic, MoreVertical, SquareCode, Palette, Paperclip, Pin, PinOff, Plus, Redo2, Rows2, Square, Tag, Trash2, Undo2, X,
    ArrowDown, ArrowUp, Copy, CopyPlus, Download, Eye, GripVertical, ListTodo, Pilcrow, Scissors, SquareCheck, SquareDashed, ExternalLink,
  } from '@lucide/svelte'
  import {
    blockAt, canMove, checkAll, clipNode, deleteChecked, deleteNode, duplicateNode, moveNode, startNodeDrag, type BlockHit,
  } from '../lib/editor/blocks'
  import { SEP, type MenuEntry } from '../lib/menu'
  import MenuAt from './MenuAt.svelte'
  import { imageActions, leaveRow, placeBeside } from '../lib/editor/media'
  import { canRecord, fmtSeconds, hasCamera, photoName, Recorder } from '../lib/capture.svelte'
  import MediaBlock from './MediaBlock.svelte'
  import CameraDialog from './CameraDialog.svelte'
  import { api } from '../lib/api'
  import { app, type EditorTarget } from '../lib/app.svelte'
  import { noteExtensions } from '../lib/editor/extensions'
  import { ago, fmtBytes, hashTags, normalizeTag } from '../lib/format'
  import ReminderPopover from './ReminderPopover.svelte'
  import type { Attachment, NoteColor, NoteInput, RichDoc, RichNode } from '../lib/types'

  let { target }: { target: EditorTarget } = $props()

  const COLORS: { id: NoteColor; label: string }[] = [
    { id: 'none', label: 'Padrão' }, { id: 'sand', label: 'Areia' }, { id: 'sage', label: 'Sálvia' }, { id: 'sky', label: 'Céu' },
    { id: 'rose', label: 'Rosa' }, { id: 'lilac', label: 'Lilás' }, { id: 'butter', label: 'Manteiga' },
  ]
  const SAVE_DELAY = 400

  type Meta = Omit<NoteInput, 'id' | 'body'>

  // svelte-ignore state_referenced_locally
  const { id, isNew, defaults, start } = target
  let meta = $state<Meta | null>(null)
  let files = $state.raw<Attachment[]>([])
  let editedAt = $state<number | null>(null)
  let wasTrashed = $state(false)
  let editor = $state.raw<TipTap | null>(null)
  let tick = $state(0)
  let bodyTags = $state<string[]>([])
  let tagDraft = $state('')
  /** Anexos usados no corpo, para desenhar fotos e players sem esperar. */
  const media = new Map<string, Attachment>()
  const recorder = new Recorder()
  let cameraOpen = $state(false)
  let cameraAvailable = $state(false)
  hasCamera().then((v) => (cameraAvailable = v))
  let photoInput: HTMLInputElement | undefined = $state()
  let fileInput: HTMLInputElement | undefined = $state()

  let initialBody: RichDoc = { type: 'doc', content: [{ type: 'paragraph' }] }
  let persisted = !isNew
  let closed = false
  let timer: ReturnType<typeof setTimeout> | undefined

  if (isNew) {
    meta = {
      title: '', categoryId: defaults?.categoryId ?? null, color: 'none', pinned: false, archived: false,
      trashedAt: null, reminderAt: null, reminderDone: false, tags: defaults?.tags ?? [],
    }
  } else {
    api.getNote(id).then((n) => {
      if (!n) return void (app.editor = null)
      initialBody = n.body
      files = n.files
      for (const a of n.media) media.set(a.hash, a)
      editedAt = n.updatedAt
      wasTrashed = n.trashedAt != null
      meta = {
        title: n.title, categoryId: n.categoryId, color: n.color, pinned: n.pinned, archived: n.archived,
        trashedAt: n.trashedAt, reminderAt: n.reminderAt, reminderDone: n.reminderDone, tags: n.tags,
      }
    })
  }

  const cat = $derived(app.category(meta?.categoryId))
  const extraTags = $derived(bodyTags.filter((t) => !meta?.tags.includes(t)))
  const active = $derived.by(() => {
    void tick
    // Só destaca a formatação enquanto se escreve.
    const e = editor?.isFocused ? editor : null
    return {
      bold: !!e?.isActive('bold'), italic: !!e?.isActive('italic'), heading: !!e?.isActive('heading', { level: 3 }),
      list: !!e?.isActive('bulletList'), check: !!e?.isActive('taskList'), code: !!e?.isActive('codeBlock'),
      undo: !!editor?.can().undo(), redo: !!editor?.can().redo(),
    }
  })

  // ---------- salvamento contínuo ----------
  const isEmpty = () => !meta?.title.trim() && !!editor?.isEmpty

  function save() {
    clearTimeout(timer)
    timer = undefined
    if (!editor || !meta) return
    if (!persisted && isEmpty()) return // nota nova vazia não é criada
    const input: NoteInput = { id, ...$state.snapshot(meta), body: editor.getJSON() as RichDoc }
    persisted = true
    return api.saveNote(input)
  }
  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(save, SAVE_DELAY)
  }

  let metaRuns = 0
  $effect(() => {
    if (!meta) return
    JSON.stringify(meta)
    if (metaRuns++ > 0) untrack(schedule)
  })

  async function close(patch?: Partial<Meta>, msg?: string) {
    if (closed) return
    closed = true
    // O que muda ao sair (arquivar, lixeira, restaurar) pode ser desfeito pelo aviso.
    const before = meta && patch ? (Object.fromEntries(Object.keys(patch).map((k) => [k, meta![k as keyof Meta]])) as Partial<Meta>) : null
    if (meta && patch) Object.assign(meta, patch)
    if (isNew && isEmpty()) {
      clearTimeout(timer)
      if (persisted) await api.deleteNote(id)
    } else {
      await save()
    }
    app.editor = null
    if (msg) app.say(msg, before ? { label: 'Desfazer', run: () => void api.updateNote(id, before) } : undefined)
  }

  async function deleteForever() {
    closed = true
    clearTimeout(timer)
    await api.deleteNote(id)
    app.editor = null
    app.say('Nota excluída')
  }

  // ---------- TipTap ----------
  function mountEditor(el: HTMLElement) {
    return untrack(() => {
      const ed = new TipTap({
        element: el,
        extensions: noteExtensions({
          media: (h) => ({ src: api.imageUrl(h, 'full'), width: media.get(h)?.width, height: media.get(h)?.height }),
          load: async (h) => {
            const a = media.get(h) ?? (await loadMedia(h))
            return a ? { src: api.imageUrl(h, 'full'), width: a.width, height: a.height } : null
          },
          renderFile: (h, dom) => {
            let c: ReturnType<typeof mount> | null = null
            let gone = false
            const show = (a: Attachment) => !gone && (c = mount(MediaBlock, { target: dom, props: { a, onopen: () => viewAttachment(a) } }))
            const known = media.get(h)
            // Colado de outra nota: busca os dados do anexo e desenha quando chegarem.
            if (known) show(known)
            else void loadMedia(h).then((a) => a && show(a))
            return () => {
              gone = true
              if (c) void unmount(c)
            }
          },
          onFiles: (list, pos) => void addFiles(list, pos),
          onMenu: (pos, e) => openNodeMenu(pos, e.clientX, e.clientY, e.target as Element),
          placeholder: 'Escreva… use #tag para marcar',
        }),
        content: initialBody,
        editorProps: {
          attributes: { id: 'corpo', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Texto da nota', spellcheck: 'true' },
        },
        onTransaction: () => tick++,
        onUpdate: ({ editor }) => {
          bodyTags = hashTags(editor.getText())
          schedule()
        },
      })
      bodyTags = hashTags(ed.getText())
      editor = ed
      // Nota nova: cursor no corpo já na montagem, para não perder as primeiras teclas.
      if (isNew) ed.commands.focus('end', { scrollIntoView: false })
      // Atalhos do "+": já abre gravando, com a câmera ou com os arquivos escolhidos.
      if (start && 'files' in start) void addFiles(start.files)
      else if (start && 'record' in start) void recorder.start()
      else if (start && 'camera' in start) cameraOpen = true
      return () => {
        if (!closed) save()
        ed.destroy()
      }
    })
  }

  const run = (fn: (c: ReturnType<TipTap['chain']>) => ReturnType<TipTap['chain']>) => editor && fn(editor.chain().focus()).run()

  // ---------- mídia ----------
  async function loadMedia(h: string) {
    const [a] = await api.getAttachments([h])
    if (a) media.set(h, a)
    return a
  }

  /** Abre o anexo no visualizador: foto, vídeo, áudio e PDF; outros documentos mostram a ficha com Baixar. */
  function viewAttachment(a: Attachment) {
    app.lightbox = { ...a, noteId: id, noteTitle: meta?.title ?? '', categoryId: meta?.categoryId ?? null }
  }

  async function copyImage(h: string) {
    try {
      const img = new globalThis.Image()
      img.src = api.imageUrl(h, 'full')
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      c.getContext('2d')!.drawImage(img, 0, 0)
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'))
      if (!blob) throw new Error('png')
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      app.say('Imagem copiada')
    } catch {
      app.say('Não foi possível copiar a imagem')
    }
  }

  // ---------- blocos ----------
  let blockMenu: MenuAt | undefined = $state()
  let hover = $state.raw<BlockHit | null>(null)
  let blocksEl: HTMLElement | undefined = $state()
  let handleDragging = false

  function onBodyMove(e: PointerEvent) {
    if (!editor || e.pointerType !== 'mouse' || handleDragging || e.buttons) return
    if ((e.target as Element).closest('.blk-handle, .item-handle')) return
    hover = blockAt(editor.view, e.clientY)
  }
  const topOf = (dom: HTMLElement) => (blocksEl ? dom.getBoundingClientRect().top - blocksEl.getBoundingClientRect().top : 0)

  function dragFromHandle(e: DragEvent, pos: number, dom: HTMLElement) {
    if (!editor) return
    handleDragging = true
    startNodeDrag(editor.view, pos, e, dom)
  }

  const TEXTISH = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'taskList', 'codeBlock'])
  type Shape = 'paragraph' | 'heading' | 'bullet' | 'task' | 'code'
  function transform(pos: number, to: Shape) {
    const node = editor?.state.doc.nodeAt(pos)
    if (!editor || !node) return
    const c = editor.chain().focus().setTextSelection({ from: pos + 1, to: pos + node.nodeSize - 1 }).clearNodes()
    ;(to === 'heading' ? c.setHeading({ level: 3 }) : to === 'bullet' ? c.toggleBulletList() : to === 'task' ? c.toggleTaskList() : to === 'code' ? c.setCodeBlock() : c).run()
  }
  const shapeOf = (name: string): Shape | null =>
    ({ paragraph: 'paragraph', heading: 'heading', bulletList: 'bullet', taskList: 'task', codeBlock: 'code' })[name] as Shape | null

  /** Menu de um bloco (ou de um item de lista), com as ações gerais e as do tipo. */
  function nodeEntries(pos: number, clicked?: Element): MenuEntry[] {
    const view = editor?.view
    const node = view?.state.doc.nodeAt(pos)
    if (!view || !node) return []
    const name = node.type.name
    const isItem = name === 'taskItem' || name === 'listItem'
    const out: MenuEntry[] = []
    // foto clicada (sozinha ou dentro de uma linha)
    const imgEl = clicked?.closest('img[data-hash]')
    const imgHash = imgEl?.getAttribute('data-hash') ?? (name === 'noteImage' ? node.attrs.hash : null)
    if (imgHash) {
      const a = media.get(imgHash)
      out.push(
        { label: 'Ver', icon: Eye, onSelect: () => a && viewAttachment(a) },
        { label: 'Baixar', icon: Download, onSelect: () => a && void api.downloadAttachment(a) },
        { label: 'Copiar imagem', icon: Copy, onSelect: () => void copyImage(imgHash) },
        SEP,
      )
    }
    if (name === 'noteFile') {
      const a = media.get(node.attrs.hash)
      out.push(
        { label: 'Abrir', icon: ExternalLink, onSelect: () => a && viewAttachment(a) },
        { label: 'Baixar', icon: Download, onSelect: () => a && void api.downloadAttachment(a) },
        { label: 'Copiar nome', icon: Copy, onSelect: () => a && void navigator.clipboard.writeText(a.name).then(() => app.say('Nome copiado')) },
        SEP,
      )
    }
    if (name === 'taskList') {
      let checked = 0
      node.forEach((i) => void (i.attrs.checked && checked++))
      out.push(
        { label: 'Marcar todos', icon: SquareCheck, disabled: checked === node.childCount, onSelect: () => checkAll(view, pos, true) },
        { label: 'Desmarcar todos', icon: SquareDashed, disabled: checked === 0, onSelect: () => checkAll(view, pos, false) },
        { label: 'Apagar itens marcados', icon: Trash2, disabled: checked === 0, onSelect: () => deleteChecked(view, pos) },
        SEP,
      )
    }
    out.push(
      { label: 'Copiar', icon: Copy, onSelect: () => clipNode(view, pos, 'copy') },
      { label: 'Recortar', icon: Scissors, onSelect: () => clipNode(view, pos, 'cut') },
      { label: 'Duplicar', icon: CopyPlus, onSelect: () => duplicateNode(view, pos) },
      SEP,
      { label: 'Mover para cima', icon: ArrowUp, disabled: !canMove(view, pos, -1), onSelect: () => moveNode(view, pos, -1) },
      { label: 'Mover para baixo', icon: ArrowDown, disabled: !canMove(view, pos, 1), onSelect: () => moveNode(view, pos, 1) },
    )
    if (TEXTISH.has(name)) {
      const cur = shapeOf(name)
      const opt = (label: string, icon: typeof Pilcrow, to: Shape): MenuEntry => ({ label, icon, checked: cur === to, onSelect: () => transform(pos, to) })
      out.push({
        label: 'Transformar em', icon: Pilcrow,
        sub: [opt('Texto', Pilcrow, 'paragraph'), opt('Título', Heading, 'heading'), opt('Lista', List, 'bullet'), opt('Checklist', ListTodo, 'task'), opt('Código', SquareCode, 'code')],
      })
    }
    out.push(SEP, { label: isItem ? 'Apagar item' : 'Apagar', icon: Trash2, danger: true, onSelect: () => deleteNode(view, pos) })
    return out
  }

  function openNodeMenu(pos: number, x: number, y: number, clicked?: Element) {
    blockMenu?.openAt(x, y, nodeEntries(pos, clicked))
  }

  /** Importa arquivos (do computador, arrastados, colados, da câmera ou do gravador) e põe no texto. */
  async function addFiles(list: (File | { blob: Blob; name: string })[], pos?: number) {
    if (!editor || !list.length) return
    const added: Attachment[] = []
    for (const f of list) {
      const a = f instanceof File ? await api.importFile(f, f.name) : await api.importFile(f.blob, f.name)
      media.set(a.hash, a)
      added.push(a)
    }
    // Várias fotos de uma vez entram lado a lado (até 4 por linha); o resto, um bloco cada.
    const photos = added.filter((a) => a.kind === 'image')
    const nodes: RichNode[] = []
    for (let i = 0; i < photos.length; i += 4) {
      const row = photos.slice(i, i + 4).map((a) => ({ type: 'noteImage', attrs: { hash: a.hash } }))
      nodes.push(row.length > 1 ? { type: 'imageRow', content: row } : row[0])
    }
    for (const a of added) if (a.kind !== 'image') nodes.push({ type: 'noteFile', attrs: { hash: a.hash } })
    nodes.push({ type: 'paragraph' })
    const chain = editor.chain().focus()
    ;(pos == null ? chain : chain.setTextSelection(pos)).insertContent(nodes).run()
  }

  function pick(input: HTMLInputElement | undefined) {
    if (!input) return
    input.value = ''
    input.click()
  }

  async function stopRecording() {
    const rec = await recorder.stop()
    if (rec) await addFiles([rec])
  }

  // Foto selecionada: botões para pôr ao lado da de cima, mover na linha e separar (toque e teclado).
  const selectedImage = $derived.by(() => {
    void tick
    const sel = editor?.state.selection
    // Só com o editor em foco: ao abrir uma nota que começa com foto, a seleção inicial cai nela sem ninguém clicar.
    if (!editor?.isFocused || !(sel instanceof NodeSelection) || sel.node.type.name !== 'noteImage') return null
    const dom = editor.view.nodeDOM(sel.from) as HTMLElement | null
    const acts = imageActions(editor.state, sel.from)
    if (!dom || !acts) return null
    // Posição relativa ao editor (o diálogo é a referência dos botões), sem sair das bordas.
    const box = dom.closest('.editor')?.getBoundingClientRect()
    const r = dom.getBoundingClientRect()
    if (!box) return null
    const half = 110
    const left = Math.min(Math.max(r.left + r.width / 2 - box.left, half + 8), box.width - half - 8)
    return { pos: sel.from, ...acts, top: Math.max(r.top - box.top, 56), left }
  })
  function apply(tr: ReturnType<typeof placeBeside>) {
    if (tr && editor) editor.view.dispatch(tr)
    editor?.view.focus()
  }

  function addTag() {
    const t = normalizeTag(tagDraft)
    if (meta && t && !meta.tags.includes(t)) meta.tags.push(t)
    tagDraft = ''
  }
</script>

{#if meta}
  <Dialog.Root open onOpenChange={(o) => !o && close()}>
    <Dialog.Portal>
      <Dialog.Overlay class="overlay ed-overlay" />
      <Dialog.Content class="editor c-{meta.color}" aria-describedby={undefined} onOpenAutoFocus={(e) => e.preventDefault()}>
        <div class="ed-top">
          <button class="icon-btn" aria-label="Voltar e salvar" onclick={() => close()}><ArrowLeft size={20} /></button>
          <span class="ed-saved">{isNew ? 'Nova nota' : editedAt ? `Editada ${ago(editedAt)}` : ''}</span>
          <button class="icon-btn" aria-label={meta.pinned ? 'Desafixar' : 'Fixar'} aria-pressed={meta.pinned} onclick={() => meta && (meta.pinned = !meta.pinned)}>
            {#if meta.pinned}<PinOff size={19} />{:else}<Pin size={19} />{/if}
          </button>
          <ReminderPopover value={meta.reminderAt} onchange={(v) => meta && ((meta.reminderAt = v), (meta.reminderDone = false))} />
          <DropdownMenu.Root>
            <DropdownMenu.Trigger class="icon-btn" aria-label="Mais opções"><MoreVertical size={19} /></DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content class="menu" align="end" sideOffset={6}>
                {#if wasTrashed}
                  <DropdownMenu.Item class="menu-item" onSelect={() => close({ trashedAt: null }, 'Nota restaurada')}><ArchiveRestore size={16} />Restaurar</DropdownMenu.Item>
                  <DropdownMenu.Separator class="menu-sep" />
                  <DropdownMenu.Item class="menu-item danger" onSelect={deleteForever}><Trash2 size={16} />Excluir para sempre</DropdownMenu.Item>
                {:else}
                  <DropdownMenu.Item class="menu-item" onSelect={() => meta && close({ archived: !meta.archived }, meta.archived ? 'Nota desarquivada' : 'Nota arquivada')}>
                    {#if meta.archived}<ArchiveRestore size={16} />Desarquivar{:else}<Archive size={16} />Arquivar{/if}
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator class="menu-sep" />
                  <DropdownMenu.Item class="menu-item danger" onSelect={() => close({ trashedAt: Date.now() }, 'Nota movida para a lixeira')}><Trash2 size={16} />Mover para a lixeira</DropdownMenu.Item>
                {/if}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>

        <div class="ed-scroll" onscroll={() => tick++}>
          <Dialog.Title>
            {#snippet child({ props })}
              <input
                {...props}
                id="titulo"
                class="ed-title"
                placeholder="Título"
                autocomplete="off"
                bind:value={meta!.title}
                onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), editor?.commands.focus('start'))}
              />
            {/snippet}
          </Dialog.Title>
          <!-- Blocos: com o mouse por cima, a alça ⋮⋮ à esquerda arrasta o bloco e abre o menu dele.
               Em listas e checklists, cada item tem a própria alça (reordenar como no Keep). -->
          <div
            class="ed-blocks"
            role="presentation"
            bind:this={blocksEl}
            onpointermove={onBodyMove}
            onpointerleave={() => !handleDragging && (hover = null)}
            onkeydowncapture={() => (hover = null)}
          >
            <div class="ed-body prose" {@attach mountEditor}></div>
            {#if hover}
              {@const b = hover.block}
              <button
                class="blk-handle"
                style:top="{topOf(b.dom)}px"
                draggable="true"
                aria-label="Bloco: arraste para mover ou clique para o menu"
                title="Arraste para mover · clique para o menu"
                ondragstart={(e) => dragFromHandle(e, b.pos, b.dom)}
                ondragend={() => ((handleDragging = false), (hover = null))}
                onclick={(e) => openNodeMenu(b.pos, e.clientX, e.clientY)}
                onpointerenter={() => hover?.item && (hover = { ...hover, item: null })}
              ><GripVertical size={16} /></button>
              {#if hover.item}
                {@const it = hover.item}
                <button
                  class="item-handle"
                  style:top="{topOf(it.dom)}px"
                  style:left="{it.dom.getBoundingClientRect().left - (blocksEl?.getBoundingClientRect().left ?? 0) - 18}px"
                  draggable="true"
                  aria-label="Item: arraste para reordenar ou clique para o menu"
                  title="Arraste para reordenar · clique para o menu"
                  ondragstart={(e) => dragFromHandle(e, it.pos, it.dom)}
                  ondragend={() => ((handleDragging = false), (hover = null))}
                  onclick={(e) => openNodeMenu(it.pos, e.clientX, e.clientY)}
                ><GripVertical size={14} /></button>
              {/if}
            {/if}
          </div>
          <MenuAt bind:this={blockMenu} />

          {#if files.length}
            <!-- Anexos antigos, fora do corpo: mesmo cartão dos anexos do texto. -->
            <div class="ed-files">
              {#each files as f (f.hash)}
                <MediaBlock a={f} onopen={() => viewAttachment(f)} />
              {/each}
            </div>
          {/if}

          <div class="ed-meta">
            <Select.Root
              type="single"
              items={[{ value: 'none', label: 'Sem categoria' }, ...app.categories.map((c) => ({ value: c.id, label: c.name }))]}
              bind:value={() => meta?.categoryId ?? 'none', (v) => meta && (meta.categoryId = v === 'none' ? null : v)}
            >
              <Select.Trigger id="categoria" class="picker" aria-label="Categoria">
                {#if cat}<i class="dot" style:background={cat.color}></i>{:else}<Tag size={14} />{/if}
                <span>{cat?.name ?? 'Sem categoria'}</span>
                <ChevronDown size={15} />
              </Select.Trigger>
              <Select.Portal>
                <Select.Content class="menu" sideOffset={6}>
                  <Select.Viewport>
                    <Select.Item value="none" label="Sem categoria" class="menu-item">Sem categoria</Select.Item>
                    {#each app.categories as c (c.id)}
                      <Select.Item value={c.id} label={c.name} class="menu-item">
                        {#snippet children({ selected })}
                          <i class="dot" style:background={c.color}></i>{c.name}
                          {#if selected}<span class="menu-check"><Check size={15} /></span>{/if}
                        {/snippet}
                      </Select.Item>
                    {/each}
                  </Select.Viewport>
                </Select.Content>
              </Select.Portal>
            </Select.Root>
            {#if meta.reminderAt != null}
              <ReminderPopover
                variant="pill"
                value={meta.reminderAt}
                done={meta.reminderDone}
                onchange={(v) => meta && ((meta.reminderAt = v), (meta.reminderDone = false))}
                ondone={(d) => meta && (meta.reminderDone = d)}
              />
            {/if}
          </div>

          <div class="ed-tags">
            {#each meta.tags as t (t)}
              <span class="pill tag">#{t}<button aria-label="Remover {t}" onclick={() => meta && (meta.tags = meta.tags.filter((x) => x !== t))}><X size={12} /></button></span>
            {/each}
            {#each extraTags as t (t)}
              <span class="pill tag" title="Tag vinda do texto">#{t}</span>
            {/each}
            <input
              id="nova-tag"
              class="tag-input"
              placeholder="+ tag"
              autocomplete="off"
              bind:value={tagDraft}
              onkeydown={(e) => {
                if (e.key === 'Enter' || e.key === ' ' || e.key === ',') {
                  e.preventDefault()
                  addTag()
                }
              }}
              onblur={addTag}
            />
          </div>
        </div>

        {#if selectedImage}
          <div class="img-tools" role="toolbar" aria-label="Foto" style:top="{selectedImage.top}px" style:left="{selectedImage.left}px">
            {#if selectedImage.joinTarget != null}
              <button onmousedown={(e) => e.preventDefault()} onclick={() => editor && apply(placeBeside(editor.state, selectedImage.pos, selectedImage.joinTarget!, 'right'))} aria-label="Pôr ao lado da foto de cima" title="Pôr ao lado da foto de cima"><Columns2 size={17} /></button>
            {/if}
            {#if selectedImage.left != null}
              <button onmousedown={(e) => e.preventDefault()} onclick={() => editor && apply(placeBeside(editor.state, selectedImage.pos, selectedImage.left!, 'left'))} aria-label="Mover para a esquerda" title="Mover para a esquerda"><ChevronLeft size={17} /></button>
            {/if}
            {#if selectedImage.right != null}
              <button onmousedown={(e) => e.preventDefault()} onclick={() => editor && apply(placeBeside(editor.state, selectedImage.pos, selectedImage.right!, 'right'))} aria-label="Mover para a direita" title="Mover para a direita"><ChevronRight size={17} /></button>
            {/if}
            {#if selectedImage.inRow}
              <button onmousedown={(e) => e.preventDefault()} onclick={() => editor && apply(leaveRow(editor.state, selectedImage.pos))} aria-label="Tirar da linha" title="Tirar da linha"><Rows2 size={17} /></button>
            {/if}
            <button onmousedown={(e) => e.preventDefault()} onclick={() => run((c) => c.deleteSelection())} aria-label="Remover foto" title="Remover foto"><Trash2 size={17} /></button>
          </div>
        {/if}

        <input bind:this={photoInput} type="file" accept="image/*" multiple hidden onchange={(e) => void addFiles([...(e.currentTarget.files ?? [])])} />
        <input bind:this={fileInput} type="file" multiple hidden onchange={(e) => void addFiles([...(e.currentTarget.files ?? [])])} />
        <CameraDialog bind:open={cameraOpen} oncapture={(b) => void addFiles([{ blob: b, name: photoName() }])} />

        {#if recorder.recording}
          <div class="ed-tools rec-bar" role="toolbar" aria-label="Gravação">
            <span class="rec-dot" aria-hidden="true"></span>
            <span class="rec-time" aria-live="polite">Gravando · {fmtSeconds(recorder.seconds)}</span>
            <button class="btn ghost sm" onclick={() => recorder.cancel()}>Cancelar</button>
            <button class="btn sm rec-stop" onclick={stopRecording}><Square size={13} fill="currentColor" />Parar</button>
          </div>
        {:else}
        <div class="ed-tools" role="toolbar" aria-label="Formatação">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger aria-label="Inserir" title="Inserir"><Plus size={19} /></DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content class="menu" side="top" align="start" sideOffset={10}>
                <DropdownMenu.Item class="menu-item" onSelect={() => pick(photoInput)}><Image size={16} />Foto</DropdownMenu.Item>
                {#if cameraAvailable}
                  <DropdownMenu.Item class="menu-item" onSelect={() => (cameraOpen = true)}><Camera size={16} />Câmera</DropdownMenu.Item>
                {/if}
                <DropdownMenu.Item class="menu-item" onSelect={() => pick(fileInput)}><Paperclip size={16} />Arquivo</DropdownMenu.Item>
                {#if canRecord()}
                  <DropdownMenu.Item class="menu-item" onSelect={() => void recorder.start()}><Mic size={16} />Gravar áudio</DropdownMenu.Item>
                {/if}
                <DropdownMenu.Separator class="menu-sep" />
                <DropdownMenu.Item class="menu-item" onSelect={() => run((c) => c.toggleCodeBlock())}><SquareCode size={16} />Bloco de código</DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <span class="ed-tools-sep" aria-hidden="true"></span>
          <button onmousedown={(e) => e.preventDefault()} onclick={() => run((c) => c.toggleBold())} aria-label="Negrito" aria-pressed={active.bold}><Bold size={18} /></button>
          <button onmousedown={(e) => e.preventDefault()} onclick={() => run((c) => c.toggleItalic())} aria-label="Itálico" aria-pressed={active.italic}><Italic size={18} /></button>
          <button onmousedown={(e) => e.preventDefault()} onclick={() => run((c) => c.toggleHeading({ level: 3 }))} aria-label="Título" aria-pressed={active.heading}><Heading size={18} /></button>
          <button onmousedown={(e) => e.preventDefault()} onclick={() => run((c) => c.toggleBulletList())} aria-label="Lista" aria-pressed={active.list}><List size={18} /></button>
          <button onmousedown={(e) => e.preventDefault()} onclick={() => run((c) => c.toggleTaskList())} aria-label="Checklist" aria-pressed={active.check}><ListChecks size={18} /></button>
          <Popover.Root>
            <Popover.Trigger aria-label="Cor da nota"><Palette size={18} /></Popover.Trigger>
            <Popover.Portal>
              <Popover.Content class="pop" side="top" sideOffset={10}>
                <p class="pop-title">Cor da nota</p>
                <div class="color-row">
                  {#each COLORS as c (c.id)}
                    <button
                      class="swatch c-{c.id}"
                      class:on={meta.color === c.id}
                      aria-label={c.label}
                      aria-pressed={meta.color === c.id}
                      onclick={() => meta && (meta.color = c.id)}
                    >
                      {#if meta.color === c.id}<Check size={14} />{/if}
                    </button>
                  {/each}
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          <span class="ed-tools-sep" aria-hidden="true"></span>
          <button onmousedown={(e) => e.preventDefault()} onclick={() => run((c) => c.undo())} aria-label="Desfazer" title="Desfazer (Ctrl+Z)" disabled={!active.undo}><Undo2 size={18} /></button>
          <button onmousedown={(e) => e.preventDefault()} onclick={() => run((c) => c.redo())} aria-label="Refazer" title="Refazer (Ctrl+Shift+Z)" disabled={!active.redo}><Redo2 size={18} /></button>
        </div>
        {/if}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
{/if}
