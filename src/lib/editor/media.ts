// Mídia no corpo da nota: fotos (sozinhas ou lado a lado, até 4 por linha) e anexos inline (vídeo, áudio, documentos).
//
// Inspirado no editor de blocos do WordPress (Gutenberg): arrastar uma foto para a borda esquerda ou direita de outra põe as
// duas na mesma linha; arrastar para entre os parágrafos tira da linha. Para toque e teclado, a foto
// selecionada ganha botões (juntar com a de cima, mover, separar) — ver Editor.svelte.
import { Extension, mergeAttributes, Node } from '@tiptap/core'
import { Fragment, type Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

/** Fotos por linha, no máximo. */
export const ROW_MAX = 4

export interface MediaInfo {
  src: string
  width?: number | null
  height?: number | null
}

/**
 * Foto no meio do texto. O documento guarda só o hash do anexo (`<img data-hash="…">`, SPEC §5);
 * o caminho local e a proporção vêm do resolvedor na hora de desenhar.
 */
export const NoteImage = Node.create<{ media: (hash: string) => MediaInfo; load?: (hash: string) => Promise<MediaInfo | null> }>({
  name: 'noteImage',
  group: 'block',
  atom: true,
  draggable: true,
  addOptions: () => ({ media: () => ({ src: '' }) }),
  addAttributes: () => ({
    hash: {
      default: null,
      parseHTML: (el) => el.getAttribute('data-hash'),
      renderHTML: (attrs) => ({ 'data-hash': attrs.hash }),
    },
  }),
  parseHTML: () => [{ tag: 'img[data-hash]' }],
  renderHTML({ node, HTMLAttributes }) {
    const m = this.options.media(node.attrs.hash)
    return ['img', mergeAttributes(HTMLAttributes, { src: m.src, alt: '', style: ratioStyle(m) })]
  },
  addNodeView() {
    const { media, load } = this.options
    return ({ node }) => {
      const img = document.createElement('img')
      img.dataset.hash = node.attrs.hash
      img.alt = ''
      const apply = (m: MediaInfo) => {
        img.src = m.src
        img.setAttribute('style', ratioStyle(m))
      }
      const m = media(node.attrs.hash)
      apply(m)
      // Colada de outra nota: o editor ainda não conhece a proporção; busca e ajusta.
      if (!m.width && load) void load(node.attrs.hash).then((x) => x && apply(x))
      return { dom: img, ignoreMutation: () => true }
    }
  },
})

/** Proporção fixa: reserva o espaço antes de carregar e, numa linha, deixa todas com a mesma altura. */
function ratioStyle(m: MediaInfo) {
  const ratio = m.width && m.height ? m.width / m.height : 4 / 3
  return `aspect-ratio: ${ratio}; flex-grow: ${ratio}`
}

/** Linha de fotos lado a lado (2 a 4). Uma linha que fica com uma foto só volta a ser foto solta. */
export const ImageRow = Node.create({
  name: 'imageRow',
  group: 'block',
  content: 'noteImage+',
  isolating: true,
  parseHTML: () => [{ tag: 'div[data-type="image-row"]' }],
  renderHTML: () => ['div', { 'data-type': 'image-row', class: 'img-row' }, 0],
})

/**
 * Anexo inline que não é foto: vídeo e áudio com player, documentos como um cartão de arquivo.
 * O desenho fica com quem usa o editor (`render`), para reaproveitar os componentes da UI.
 */
export const NoteFile = Node.create<{ render?: (hash: string, dom: HTMLElement) => () => void }>({
  name: 'noteFile',
  group: 'block',
  atom: true,
  draggable: true,
  addOptions: () => ({}),
  addAttributes: () => ({
    hash: {
      default: null,
      parseHTML: (el) => el.getAttribute('data-file-hash'),
      renderHTML: (attrs) => ({ 'data-file-hash': attrs.hash }),
    },
  }),
  parseHTML: () => [{ tag: 'div[data-file-hash]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { class: 'note-file' })],
  addNodeView() {
    const render = this.options.render
    return ({ node }) => {
      const dom = document.createElement('div')
      dom.className = 'note-file'
      dom.dataset.fileHash = node.attrs.hash
      const destroy = render?.(node.attrs.hash, dom)
      return {
        dom,
        // Os controles do player e os botões são do anexo, não do editor.
        // (o clique direito segue para o editor, que abre o menu do bloco)
        stopEvent: (e) => e.type !== 'dragstart' && e.type !== 'contextmenu' && !!(e.target as Element).closest?.('audio, video, button'),
        ignoreMutation: () => true,
        destroy,
      }
    }
  },
})

// ---------- reorganizar linhas ----------

type Loc = { top: number; inRow: number | null }
/** Onde está a foto em `pos`: no nível de cima ou dentro de uma linha (só esses dois casos). */
function locate(doc: PMNode, pos: number): Loc | null {
  const node = doc.nodeAt(pos)
  if (node?.type.name !== 'noteImage') return null
  const $p = doc.resolve(pos)
  if ($p.depth === 0) return { top: $p.index(0), inRow: null }
  if ($p.depth === 1 && $p.parent.type.name === 'imageRow') return { top: $p.index(0), inRow: $p.index(1) }
  return null
}

type Entry = { node: PMNode } | { row: PMNode[] }

function entries(doc: PMNode): (Entry | null)[] {
  const out: (Entry | null)[] = []
  doc.forEach((n) => out.push(n.type.name === 'imageRow' ? { row: n.children.slice() } : { node: n }))
  return out
}

function rebuild(state: EditorState, list: (Entry | null)[], moved: PMNode): Transaction {
  const rowType = state.schema.nodes.imageRow
  const nodes = list.flatMap((e): PMNode[] => {
    if (!e) return []
    if ('node' in e) return [e.node]
    if (e.row.length === 0) return []
    return e.row.length === 1 ? [e.row[0]] : [rowType.create(null, e.row)]
  })
  const tr = state.tr.replaceWith(0, state.doc.content.size, Fragment.fromArray(nodes))
  // Deixa a foto movida selecionada, para dar para seguir ajustando.
  tr.doc.descendants((n, pos) => {
    if (n === moved) {
      tr.setSelection(NodeSelection.create(tr.doc, pos))
      return false
    }
  })
  return tr.scrollIntoView()
}

/** Põe a foto de `from` ao lado (esquerda ou direita) da foto em `to`. Devolve null se não der (linha cheia). */
export function placeBeside(state: EditorState, from: number, to: number, side: 'left' | 'right'): Transaction | null {
  const s = locate(state.doc, from)
  const t = locate(state.doc, to)
  if (!s || !t || from === to) return null
  const moved = state.doc.nodeAt(from)!
  const target = state.doc.nodeAt(to)!
  const list = entries(state.doc)
  const sameRow = s.top === t.top && s.inRow != null
  const dest = list[t.top]!
  if ('row' in dest && !sameRow && dest.row.length >= ROW_MAX) return null
  // tira de onde estava
  const src = list[s.top]!
  if ('row' in src) src.row.splice(s.inRow!, 1)
  else list[s.top] = null
  // põe ao lado do alvo
  if ('row' in dest) {
    const i = dest.row.indexOf(target)
    dest.row.splice(side === 'left' ? i : i + 1, 0, moved)
  } else {
    list[t.top] = { row: side === 'left' ? [moved, target] : [target, moved] }
  }
  return rebuild(state, list, moved)
}

/** Tira a foto da linha e a põe sozinha logo abaixo dela. */
export function leaveRow(state: EditorState, pos: number): Transaction | null {
  const s = locate(state.doc, pos)
  if (!s || s.inRow == null) return null
  const moved = state.doc.nodeAt(pos)!
  const list = entries(state.doc)
  ;(list[s.top] as { row: PMNode[] }).row.splice(s.inRow, 1)
  list.splice(s.top + 1, 0, { node: moved })
  return rebuild(state, list, moved)
}

/** O que dá para fazer com a foto em `pos` (para os botões da foto selecionada). */
export function imageActions(state: EditorState, pos: number) {
  const s = locate(state.doc, pos)
  if (!s) return null
  const doc = state.doc
  const row = s.inRow != null ? doc.child(s.top) : null
  // Foto solta: junta com a foto (ou linha) logo acima, se houver espaço.
  let joinTarget: number | null = null
  if (s.inRow == null && s.top > 0) {
    const prev = doc.child(s.top - 1)
    let prevPos = 0
    for (let i = 0; i < s.top - 1; i++) prevPos += doc.child(i).nodeSize
    if (prev.type.name === 'noteImage') joinTarget = prevPos
    else if (prev.type.name === 'imageRow' && prev.childCount < ROW_MAX) joinTarget = prevPos + prev.nodeSize - 1 - prev.lastChild!.nodeSize
  }
  const sibling = (d: -1 | 1) => {
    if (!row || s.inRow == null) return null
    const j = s.inRow + d
    if (j < 0 || j >= row.childCount) return null
    let p = 1
    for (let i = 0; i < s.top; i++) p += doc.child(i).nodeSize
    for (let i = 0; i < j; i++) p += row.child(i).nodeSize
    return p
  }
  return { inRow: s.inRow != null, joinTarget, left: sibling(-1), right: sibling(1) }
}

// ---------- arrastar, soltar e colar ----------

const key = new PluginKey('mediaLayout')

/** Zona de soltar: borda esquerda ou direita (35%) de uma foto. */
function dropZone(view: EditorView, e: DragEvent): { pos: number; side: 'left' | 'right'; el: HTMLElement } | null {
  const el = (e.target as Element | null)?.closest?.('img[data-hash]') as HTMLElement | null
  if (!el || !view.dom.contains(el)) return null
  const r = el.getBoundingClientRect()
  const x = (e.clientX - r.left) / r.width
  if (x > 0.35 && x < 0.65) return null
  const pos = imagePos(view, el)
  return pos == null ? null : { pos, side: x <= 0.35 ? 'left' : 'right', el }
}

/** Posição da foto cujo elemento é `el`. */
function imagePos(view: EditorView, el: Element): number | null {
  let pos: number | null = null
  view.state.doc.descendants((n, p) => {
    if (pos != null) return false
    if (n.type.name === 'noteImage' && view.nodeDOM(p) === el) pos = p
  })
  return pos
}

/**
 * Foto sendo arrastada dentro do editor. Anotada no início do arraste: o ProseMirror guarda o nó só no
 * próprio estado de arraste e o descarta antes de chamar handleDrop.
 */
let dragFrom: number | null = null

let marked: HTMLElement | null = null
function mark(el: HTMLElement | null, side?: 'left' | 'right') {
  if (marked && marked !== el) delete marked.dataset.drop
  marked = el
  if (el && side) el.dataset.drop = side
}

export const MediaLayout = Extension.create<{
  onFiles?: (files: File[], pos: number) => void
  /** Clique direito numa foto ou anexo: `pos` é o nó clicado. */
  onMenu?: (pos: number, e: MouseEvent) => void
}>({
  name: 'mediaLayout',
  addOptions: () => ({}),
  addProseMirrorPlugins() {
    const { onFiles, onMenu } = this.options
    return [
      new Plugin({
        key,
        // Linha que ficou com uma foto só (apagou as outras) volta a ser foto solta.
        appendTransaction(trs, _old, state) {
          if (!trs.some((t) => t.docChanged)) return null
          const fixes: { pos: number; node: PMNode }[] = []
          state.doc.forEach((n, pos) => {
            if (n.type.name === 'imageRow' && n.childCount === 1) fixes.push({ pos, node: n })
          })
          if (!fixes.length) return null
          const tr = state.tr
          for (const f of fixes.reverse()) tr.replaceWith(f.pos, f.pos + f.node.nodeSize, f.node.firstChild!)
          return tr
        },
        props: {
          handleDOMEvents: {
            contextmenu(view, e) {
              const el = (e.target as Element | null)?.closest?.('img[data-hash], .note-file, .link-card')
              if (!el || !onMenu || !view.dom.contains(el)) return false
              let pos: number | null = null
              view.state.doc.descendants((n, p) => {
                if (pos != null) return false
                if (view.nodeDOM(p) === el) pos = p
              })
              if (pos == null) return false
              e.preventDefault()
              onMenu(pos, e)
              return true
            },
            dragstart(view, e) {
              const el = (e.target as Element | null)?.closest?.('img[data-hash]')
              dragFrom = el ? imagePos(view, el) : null
              return false
            },
            dragover(view, e) {
              const from = dragFrom
              const zone = from != null ? dropZone(view, e) : null
              if (!zone || zone.pos === from) {
                mark(null)
                return false
              }
              e.preventDefault()
              mark(zone.el, zone.side)
              return true
            },
            dragleave(_view, e) {
              if (e.target === marked) mark(null)
              return false
            },
            dragend() {
              mark(null)
              dragFrom = null
              return false
            },
          },
          handleDrop(view, e, _slice, moved) {
            mark(null)
            const files = [...(e.dataTransfer?.files ?? [])]
            if (files.length && onFiles) {
              const at = view.posAtCoords({ left: e.clientX, top: e.clientY })
              onFiles(files, at ? at.pos : view.state.selection.to)
              return true
            }
            const from = moved ? dragFrom : null
            dragFrom = null
            const zone = from != null ? dropZone(view, e) : null
            if (from == null || !zone) return false
            const tr = placeBeside(view.state, from, zone.pos, zone.side)
            if (!tr) return true // linha cheia: não muda nada
            view.dispatch(tr)
            return true
          },
          handlePaste(view, e) {
            const files = [...(e.clipboardData?.files ?? [])]
            if (!files.length || !onFiles) return false
            onFiles(files, view.state.selection.from)
            return true
          },
        },
      }),
    ]
  },
})
