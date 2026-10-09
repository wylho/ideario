<script lang="ts">
  import { untrack } from 'svelte'
  import { Editor as TipTap } from '@tiptap/core'
  import { Dialog, DropdownMenu, Popover, Select } from 'bits-ui'
  import {
    Archive, ArchiveRestore, ArrowLeft, Bold, Check, ChevronDown, Heading, ImagePlus, Italic, List, ListChecks, MoreVertical, SquareCode, Palette, Paperclip, Pin, PinOff, Redo2, Tag, Trash2, Undo2, X,
  } from '@lucide/svelte'
  import { api } from '../lib/api'
  import { app, type EditorTarget } from '../lib/app.svelte'
  import { noteExtensions } from '../lib/editor/extensions'
  import { ago, fmtBytes, hashTags, normalizeTag } from '../lib/format'
  import ReminderPopover from './ReminderPopover.svelte'
  import type { Attachment, AttachmentRow, NoteColor, NoteInput, RichDoc } from '../lib/types'

  let { target }: { target: EditorTarget } = $props()

  const COLORS: { id: NoteColor; label: string }[] = [
    { id: 'none', label: 'Padrão' }, { id: 'sand', label: 'Areia' }, { id: 'sage', label: 'Sálvia' }, { id: 'sky', label: 'Céu' },
    { id: 'rose', label: 'Rosa' }, { id: 'lilac', label: 'Lilás' }, { id: 'butter', label: 'Manteiga' },
  ]
  const SAVE_DELAY = 400

  type Meta = Omit<NoteInput, 'id' | 'body'>

  // svelte-ignore state_referenced_locally
  const { id, isNew, defaults } = target
  let meta = $state<Meta | null>(null)
  let files = $state.raw<Attachment[]>([])
  let editedAt = $state<number | null>(null)
  let wasTrashed = $state(false)
  let editor = $state.raw<TipTap | null>(null)
  let tick = $state(0)
  let bodyTags = $state<string[]>([])
  let tagDraft = $state('')
  let samples = $state.raw<AttachmentRow[]>([])
  let imagePickerOpen = $state(false)

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
      editedAt = n.updatedAt
      wasTrashed = n.trashedAt != null
      meta = {
        title: n.title, categoryId: n.categoryId, color: n.color, pinned: n.pinned, archived: n.archived,
        trashedAt: n.trashedAt, reminderAt: n.reminderAt, reminderDone: n.reminderDone, tags: n.tags,
      }
    })
  }
  api.sampleImages().then((s) => (samples = s))

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
        extensions: noteExtensions({ resolveImage: (h) => api.imageUrl(h, 'full'), placeholder: 'Escreva… use #tag para marcar' }),
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
      return () => {
        if (!closed) save()
        ed.destroy()
      }
    })
  }

  const run = (fn: (c: ReturnType<TipTap['chain']>) => ReturnType<TipTap['chain']>) => editor && fn(editor.chain().focus()).run()

  function insertImage(hash: string) {
    run((c) => c.insertContent([{ type: 'noteImage', attrs: { hash } }, { type: 'paragraph' }]))
    imagePickerOpen = false
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

        <div class="ed-scroll">
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
          <div class="ed-body prose" {@attach mountEditor}></div>

          {#if files.length}
            <div class="ed-files">
              {#each files as f (f.hash)}
                <span class="ed-file"><Paperclip size={14} /><span>{f.name}</span><small>{fmtBytes(f.bytes)}</small></span>
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

        <div class="ed-tools" role="toolbar" aria-label="Formatação">
          <button onmousedown={(e) => e.preventDefault()} onclick={() => run((c) => c.toggleBold())} aria-label="Negrito" aria-pressed={active.bold}><Bold size={18} /></button>
          <button onmousedown={(e) => e.preventDefault()} onclick={() => run((c) => c.toggleItalic())} aria-label="Itálico" aria-pressed={active.italic}><Italic size={18} /></button>
          <button onmousedown={(e) => e.preventDefault()} onclick={() => run((c) => c.toggleHeading({ level: 3 }))} aria-label="Título" aria-pressed={active.heading}><Heading size={18} /></button>
          <button onmousedown={(e) => e.preventDefault()} onclick={() => run((c) => c.toggleBulletList())} aria-label="Lista" aria-pressed={active.list}><List size={18} /></button>
          <button onmousedown={(e) => e.preventDefault()} onclick={() => run((c) => c.toggleTaskList())} aria-label="Checklist" aria-pressed={active.check}><ListChecks size={18} /></button>
          <button onmousedown={(e) => e.preventDefault()} onclick={() => run((c) => c.toggleCodeBlock())} aria-label="Bloco de código" title="Bloco de código" aria-pressed={active.code}><SquareCode size={18} /></button>
          <Popover.Root bind:open={imagePickerOpen}>
            <Popover.Trigger aria-label="Inserir imagem" onmousedown={(e) => e.preventDefault()}><ImagePlus size={18} /></Popover.Trigger>
            <Popover.Portal>
              <Popover.Content class="pop" side="top" sideOffset={10} onOpenAutoFocus={(e) => e.preventDefault()}>
                <p class="pop-title">Inserir no texto</p>
                <p class="pop-hint">A foto é otimizada para WebP antes de entrar na nota.</p>
                <div class="pick-grid">
                  {#each samples as s (s.hash)}
                    <button onclick={() => insertImage(s.hash)} aria-label={s.name}><img src={api.imageUrl(s.hash, 'thumb')} alt="" /></button>
                  {/each}
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
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
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
{/if}
