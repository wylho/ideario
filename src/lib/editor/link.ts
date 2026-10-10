import { mergeAttributes, Node } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import type { LinkPreview } from '../types'

/** Endereço http(s) sozinho (o que se cola para virar cartão). */
export function bareUrl(text: string): string | null {
  const t = text.trim()
  if (!/^https?:\/\/\S+$/i.test(t)) return null
  try {
    const u = new URL(t)
    return u.hostname ? u.toString() : null
  } catch {
    return null
  }
}

export const siteOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export interface LinkOptions {
  /** Busca a prévia (título, descrição, imagem) em segundo plano. */
  preview?: (url: string) => Promise<LinkPreview>
  /** Abre no navegador do sistema. */
  open?: (url: string) => void
}

/**
 * Cartão de link: o endereço colado sozinho numa linha vazia vira um cartão com título, descrição, imagem e site.
 * A prévia chega depois (o cartão aparece na hora com o site); sem rede, fica assim mesmo.
 */
export const LinkCard = Node.create<LinkOptions>({
  name: 'linkCard',
  group: 'block',
  atom: true,
  draggable: true,
  addOptions: () => ({}),
  addAttributes: () => ({
    url: { default: null, parseHTML: (el) => el.getAttribute('href'), renderHTML: (a) => ({ href: a.url }) },
    title: { default: null, parseHTML: (el) => el.getAttribute('data-title'), renderHTML: (a) => (a.title ? { 'data-title': a.title } : {}) },
    description: { default: null, parseHTML: (el) => el.getAttribute('data-description'), renderHTML: (a) => (a.description ? { 'data-description': a.description } : {}) },
    site: { default: null, parseHTML: (el) => el.getAttribute('data-site'), renderHTML: (a) => (a.site ? { 'data-site': a.site } : {}) },
    image: { default: null, parseHTML: (el) => el.getAttribute('data-image'), renderHTML: (a) => (a.image ? { 'data-image': a.image } : {}) },
  }),
  parseHTML: () => [{ tag: 'a[data-link-card]' }],
  renderHTML: ({ HTMLAttributes }) => ['a', mergeAttributes(HTMLAttributes, { 'data-link-card': '', class: 'link-card' }), HTMLAttributes['data-title'] ?? HTMLAttributes.href ?? ''],
  addNodeView() {
    const open = this.options.open
    return ({ node }) => {
      const dom = document.createElement('div')
      dom.className = 'link-card'
      dom.setAttribute('role', 'link')
      dom.tabIndex = -1
      const draw = (n: typeof node) => {
        const { url, title, description, image } = n.attrs as Record<string, string | null>
        const site = n.attrs.site || (url ? siteOf(url) : '')
        dom.dataset.url = url ?? ''
        dom.title = url ?? ''
        dom.replaceChildren()
        if (image?.startsWith('data:image/')) {
          const img = document.createElement('img')
          img.src = image
          img.alt = ''
          img.className = 'lc-img'
          dom.append(img)
        }
        const text = document.createElement('div')
        text.className = 'lc-text'
        const t = document.createElement('b')
        t.className = 'lc-title'
        t.textContent = title || url || ''
        text.append(t)
        if (description) {
          const d = document.createElement('span')
          d.className = 'lc-desc'
          d.textContent = description
          text.append(d)
        }
        const s = document.createElement('small')
        s.className = 'lc-site'
        s.textContent = site
        text.append(s)
        dom.append(text)
      }
      draw(node)
      dom.addEventListener('click', (e) => {
        const url = dom.dataset.url
        if (url && open && !e.defaultPrevented && e.button === 0) open(url)
      })
      return {
        dom,
        update: (n) => {
          if (n.type.name !== 'linkCard') return false
          draw(n)
          return true
        },
        ignoreMutation: () => true,
      }
    }
  },
  addProseMirrorPlugins() {
    const preview = this.options.preview
    return [
      new Plugin({
        key: new PluginKey('linkPaste'),
        props: {
          // Endereço colado sozinho numa linha vazia: vira cartão (no meio do texto, continua texto).
          handlePaste(view, event) {
            const url = bareUrl(event.clipboardData?.getData('text/plain') ?? '')
            const { $from, empty } = view.state.selection
            if (!url || !empty || $from.parent.type.name !== 'paragraph' || $from.parent.content.size > 0 || $from.depth !== 1) return false
            insertLinkCard(view, url, $from.before(), $from.after())
            if (preview) fillPreview(view, url, preview)
            return true
          },
        },
      }),
    ]
  },
})

/**
 * Põe o cartão no lugar de `from..to` (um bloco de primeiro nível) e o cursor na linha de baixo, criando-a se
 * preciso; senão o que se digita em seguida apagaria o cartão (ele fica selecionado).
 */
export function insertLinkCard(view: EditorView, url: string, from: number, to: number) {
  const { schema } = view.state
  const card = schema.nodes.linkCard.create({ url, site: siteOf(url) })
  const tr = view.state.tr.replaceWith(from, to, card)
  const after = from + card.nodeSize
  const next = tr.doc.resolve(after).nodeAfter
  if (!next || next.type.name !== 'paragraph' || next.content.size > 0) tr.insert(after, schema.nodes.paragraph.create())
  tr.setSelection(TextSelection.create(tr.doc, after + 1)).scrollIntoView()
  view.dispatch(tr)
  view.focus()
}

/** Busca a prévia e completa os cartões com esse endereço que ainda não têm título. */
export function fillPreview(view: EditorView, url: string, preview: (url: string) => Promise<LinkPreview>) {
  void preview(url)
    .then((p) => {
      if (view.isDestroyed) return
      const tr = view.state.tr
      view.state.doc.descendants((n, pos) => {
        if (n.type.name === 'linkCard' && n.attrs.url === url && !n.attrs.title) {
          tr.setNodeMarkup(pos, undefined, { ...n.attrs, title: p.title, description: p.description, site: p.site ?? n.attrs.site, image: p.image })
        }
      })
      if (tr.docChanged) view.dispatch(tr)
    })
    .catch(() => {})
}
