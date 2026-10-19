import { Extension, type AnyExtension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import type * as Y from 'yjs'
import { BODY } from '../ydoc'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import { Placeholder } from '@tiptap/extensions'
import { AllSelection, Plugin, PluginKey, Selection } from '@tiptap/pm/state'
import { Fragment, Slice } from '@tiptap/pm/model'
import { Mapping } from '@tiptap/pm/transform'
import { ySyncPluginKey } from '@tiptap/y-tiptap'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { ImageRow, MediaLayout, NoteFile, NoteImage, type MediaInfo } from './media'
import { LinkCard, type LinkOptions } from './link'

/** Marcar (ou desmarcar) um item de checklist faz o mesmo com os subitens dele, como no Google Keep. Só para o que
 *  se faz aqui: o que chega de outro aparelho (Yjs) já vem como lá ficou. */
const CheckCascade = Extension.create({
  name: 'checkCascade',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('checkCascade'),
        appendTransaction(trs, oldState, newState) {
          if (!trs.some((tr) => tr.docChanged) || trs.some((tr) => tr.getMeta(ySyncPluginKey))) return null
          const back = new Mapping()
          for (const tr of trs) back.appendMapping(tr.mapping)
          const inv = back.invert()
          const toggled: [number, PMNode, boolean][] = []
          newState.doc.descendants((node, pos) => {
            if (node.type.name !== 'taskItem') return
            const old = oldState.doc.nodeAt(inv.map(pos))
            if (old?.type.name === 'taskItem' && old.attrs.checked !== node.attrs.checked) toggled.push([pos, node, node.attrs.checked])
          })
          if (!toggled.length) return null
          const tr = newState.tr
          for (const [pos, item, checked] of toggled) {
            item.descendants((child, offset) => {
              if (child.type.name === 'taskItem' && child.attrs.checked !== checked) {
                tr.setNodeMarkup(pos + 1 + offset, undefined, { ...child.attrs, checked })
              }
            })
          }
          return tr.docChanged ? tr : null
        },
      }),
    ]
  },
})

/** Ctrl/⌘+A seleciona a nota inteira, e o ProseMirror põe a seleção do DOM nas pontas da raiz do editor. Se a nota
 *  começa ou termina com um checklist ou um anexo, o que está ali é um elemento não editável (a caixinha, o card do
 *  arquivo): o WebKit não pinta a seleção e o Chromium a descarta. Ancorar as pontas no primeiro e no último texto
 *  resolve; a seleção do editor continua sendo a nota toda (apagar ou digitar leva tudo, anexos inclusive). */
const SelectAllDom = Extension.create({
  name: 'selectAllDom',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('selectAllDom'),
        view: () => ({
          update(view) {
            const { doc, selection } = view.state
            if (!(selection instanceof AllSelection) || !view.hasFocus()) return
            if (doc.firstChild?.isTextblock && doc.lastChild?.isTextblock) return
            const first = Selection.findFrom(doc.resolve(0), 1, true)
            const last = Selection.findFrom(doc.resolve(doc.content.size), -1, true)
            const dom = view.dom.ownerDocument.getSelection()
            if (!first || !last || !dom) return
            const a = view.domAtPos(first.from)
            const b = view.domAtPos(last.to)
            if (dom.anchorNode === a.node && dom.anchorOffset === a.offset && dom.focusNode === b.node && dom.focusOffset === b.offset) return
            dom.setBaseAndExtent(a.node, a.offset, b.node, b.offset)
            // Avisa o observador do ProseMirror de que esta seleção do DOM já é a dele (senão ele a lê de volta
            // e troca a seleção da nota toda por uma de texto).
            ;(view as unknown as { domObserver?: { setCurSelection?: () => void } }).domObserver?.setCurSelection?.()
          },
        }),
      }),
    ]
  },
})

/** Destaca `#tag` no corpo. As tags em si são extraídas ao salvar. */
const Hashtags = Extension.create({
  name: 'hashtags',
  addProseMirrorPlugins() {
    const find = (doc: PMNode) => {
      const decos: Decoration[] = []
      const re = /(^|[^\p{L}\d_])(#[\p{L}\d_-]+)/gu
      doc.descendants((node, pos) => {
        if (!node.isText || !node.text) return
        for (const m of node.text.matchAll(re)) {
          const from = pos + m.index! + m[1].length
          decos.push(Decoration.inline(from, from + m[2].length, { class: 'hashtag' }))
        }
      })
      return DecorationSet.create(doc, decos)
    }
    return [
      new Plugin({
        key: new PluginKey('hashtags'),
        state: {
          init: (_, { doc }) => find(doc),
          apply: (tr, old) => (tr.docChanged ? find(tr.doc) : old),
        },
        props: { decorations(state) { return this.getState(state) } },
      }),
    ]
  },
})

/** Esquema do corpo das notas. O mesmo conjunto serve ao editor e à conversão de HTML. */
/** Texto com cara de Markdown: título, lista, checklist, citação, linha, tabela, bloco de código ou marcas no meio. */
const MARKDOWN = /^(#{1,3} |[-*+] |\d+[.)] |> |```|---\s*$|\|.+\|\s*$)|\*\*[^*\n]+\*\*|~~[^~\n]+~~|`[^`\n]+`/m

/** Colar Markdown (de um chat, do VS Code, de um README): vira título, lista, tabela… em vez de texto com # e |. */
export const MarkdownPaste = Extension.create<{ convert?: (md: string) => Promise<{ content?: unknown[] } | null> }>({
  name: 'markdownPaste',
  addOptions: () => ({}),
  addProseMirrorPlugins() {
    const { convert } = this.options
    return [
      new Plugin({
        key: new PluginKey('markdownPaste'),
        props: {
          handlePaste(view, e) {
            const cd = e.clipboardData
            const md = cd?.getData('text/plain') ?? ''
            if (!convert || !md || !MARKDOWN.test(md)) return false
            // Com HTML de verdade (página, outro app de texto, outra nota), vale o HTML. Editor de código manda o
            // texto num HTML só de estilo: ali o texto é o Markdown.
            const html = cd?.getData('text/html') ?? ''
            if (html && new DOMParser().parseFromString(html, 'text/html').body.querySelector('h1,h2,h3,h4,ul,ol,li,table,blockquote,img,a,b,strong,em,i')) return false
            // Dentro de código ou de tabela, cola como está.
            const $from = view.state.selection.$from
            for (let d = $from.depth; d > 0; d--) if (['codeBlock', 'table'].includes($from.node(d).type.name)) return false
            e.preventDefault()
            void convert(md).then((doc) => {
              const { state } = view
              if (!doc?.content?.length) {
                view.dispatch(state.tr.insertText(md))
                return
              }
              const frag = Fragment.fromJSON(state.schema, doc.content)
              // Um parágrafo só: entra no meio do texto, sem quebrar a linha.
              const open = frag.childCount === 1 && frag.firstChild?.type.name === 'paragraph' ? 1 : 0
              view.dispatch(state.tr.replaceSelection(new Slice(frag, open, open)).scrollIntoView())
            })
            return true
          },
        },
      }),
    ]
  },
})

export function noteExtensions(opts: {
  media?: (hash: string) => MediaInfo
  load?: (hash: string) => Promise<MediaInfo | null>
  renderFile?: (hash: string, dom: HTMLElement) => () => void
  onFiles?: (files: File[], pos: number) => void
  onMenu?: (pos: number, e: MouseEvent) => void
  clipboardImage?: () => Promise<File | null>
  /** Markdown colado → corpo do editor. */
  markdown?: (md: string) => Promise<{ content?: unknown[] } | null>
  placeholder?: string
  /** Y.Doc da nota: o corpo vive no `body` dele (TipTap Collaboration, com o desfazer do Yjs). */
  ydoc?: Y.Doc
  /** Cartão de link: buscar a prévia e abrir no navegador. */
  link?: LinkOptions
} = {}): AnyExtension[] {
  return [
    StarterKit.configure({
      // Com o Y.Doc, desfazer/refazer vêm do Yjs (Collaboration).
      ...(opts.ydoc ? { undoRedo: false as const } : {}),
      // Markdown: # ## ### (o título da nota fica à parte), > citação, `código`, ~~tachado~~, --- linha.
      heading: { levels: [1, 2, 3] },
      underline: false,
      link: false,
      // Sem nó final automático: abrir uma nota não pode alterá-la.
      trailingNode: false,
    }),
    // Tabela (a primeira linha é o cabeçalho, como no Markdown).
    TableKit.configure({ table: { resizable: false, HTMLAttributes: { class: 'note-table' } } }),
    TaskList,
    // Subitens em vários níveis (Tab recua, Shift+Tab volta), como nos marcadores.
    TaskItem.configure({
      nested: true,
      a11y: { checkboxLabel: (node, checked) => `${checked ? 'Desmarcar' : 'Marcar'} “${node.textContent || 'item vazio'}”` },
    }),
    NoteImage.configure({ media: opts.media ?? (() => ({ src: '' })), load: opts.load }),
    ImageRow,
    NoteFile.configure({ render: opts.renderFile }),
    LinkCard.configure(opts.link ?? {}),
    MediaLayout.configure({ onFiles: opts.onFiles, onMenu: opts.onMenu, clipboardImage: opts.clipboardImage }),
    MarkdownPaste.configure({ convert: opts.markdown }),
    Hashtags,
    CheckCascade,
    SelectAllDom,
    ...(opts.placeholder ? [Placeholder.configure({ placeholder: opts.placeholder })] : []),
    ...(opts.ydoc ? [Collaboration.configure({ document: opts.ydoc, field: BODY })] : []),
  ]
}
