import { Extension, type AnyExtension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Placeholder } from '@tiptap/extensions'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { ImageRow, MediaLayout, NoteFile, NoteImage, type MediaInfo } from './media'

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
export function noteExtensions(opts: {
  media?: (hash: string) => MediaInfo
  load?: (hash: string) => Promise<MediaInfo | null>
  renderFile?: (hash: string, dom: HTMLElement) => () => void
  onFiles?: (files: File[], pos: number) => void
  onMenu?: (pos: number, e: MouseEvent) => void
  placeholder?: string
} = {}): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [3] },
      blockquote: false,
      code: false,
      horizontalRule: false,
      strike: false,
      underline: false,
      link: false,
      // Sem nó final automático: abrir uma nota não pode alterá-la.
      trailingNode: false,
    }),
    TaskList,
    TaskItem.configure({
      nested: false,
      a11y: { checkboxLabel: (node, checked) => `${checked ? 'Desmarcar' : 'Marcar'} “${node.textContent || 'item vazio'}”` },
    }),
    NoteImage.configure({ media: opts.media ?? (() => ({ src: '' })), load: opts.load }),
    ImageRow,
    NoteFile.configure({ render: opts.renderFile }),
    MediaLayout.configure({ onFiles: opts.onFiles, onMenu: opts.onMenu }),
    Hashtags,
    ...(opts.placeholder ? [Placeholder.configure({ placeholder: opts.placeholder })] : []),
  ]
}
