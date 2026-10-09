// Blocos, como no Notion: cada nó de primeiro nível do documento (parágrafo, título, lista ou checklist inteiro,
// foto, linha de fotos, anexo, código) é um bloco que se arrasta pela alça e tem o próprio menu.
// Dentro de listas e checklists, cada item também tem alça, para reordenar como no Keep.
import { NodeSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'

const ITEMS = new Set(['listItem', 'taskItem'])

export interface BlockHit {
  /** Bloco de primeiro nível sob o ponteiro. */
  block: { pos: number; node: PMNode; dom: HTMLElement }
  /** Item de lista/checklist sob o ponteiro, se houver. */
  item: { pos: number; node: PMNode; dom: HTMLElement } | null
}

/** Bloco (e item de lista) na altura `y` do editor. */
export function blockAt(view: EditorView, y: number): BlockHit | null {
  const r = view.dom.getBoundingClientRect()
  const res = view.posAtCoords({ left: r.left + Math.min(40, r.width / 2), top: y })
  if (!res) return null
  const doc = view.state.doc
  const p = res.inside >= 0 ? res.inside : res.pos
  const $p = doc.resolve(Math.min(p, doc.content.size))
  let blockPos: number
  if ($p.depth === 0) {
    // entre blocos ou num átomo (foto, anexo) de primeiro nível
    const atom = doc.nodeAt(p)
    if (!atom) return null
    blockPos = p
  } else {
    blockPos = $p.before(1)
  }
  const node = doc.nodeAt(blockPos)
  const dom = view.nodeDOM(blockPos) as HTMLElement | null
  if (!node || !dom) return null
  let item: BlockHit['item'] = null
  for (let d = $p.depth; d > 1; d--) {
    if (ITEMS.has($p.node(d).type.name)) {
      const pos = $p.before(d)
      const idom = view.nodeDOM(pos) as HTMLElement | null
      if (idom) item = { pos, node: $p.node(d), dom: idom }
      break
    }
  }
  return { block: { pos: blockPos, node, dom }, item }
}

/** Começa a arrastar o nó em `pos` a partir da alça: o ProseMirror cuida do soltar (e mostra a linha onde vai cair). */
export function startNodeDrag(view: EditorView, pos: number, e: DragEvent, image: HTMLElement) {
  const sel = NodeSelection.create(view.state.doc, pos)
  view.dispatch(view.state.tr.setSelection(sel))
  const slice = sel.content()
  const { dom, text } = view.serializeForClipboard(slice)
  e.dataTransfer?.clearData()
  e.dataTransfer?.setData('text/html', dom.innerHTML)
  e.dataTransfer?.setData('text/plain', text)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copyMove'
  e.dataTransfer?.setDragImage(image, 0, 0)
  ;(view as unknown as { dragging: unknown }).dragging = { slice, move: true, node: sel }
}

/** Sobe ou desce o nó em `pos` entre os irmãos (bloco entre blocos, item entre itens). */
export function moveNode(view: EditorView, pos: number, dir: -1 | 1) {
  const { doc } = view.state
  const node = doc.nodeAt(pos)
  if (!node) return false
  const $p = doc.resolve(pos)
  if (dir < 0) {
    const prev = $p.nodeBefore
    if (!prev) return false
    const tr = view.state.tr.replaceWith(pos - prev.nodeSize, pos + node.nodeSize, [node, prev])
    tr.setSelection(NodeSelection.create(tr.doc, pos - prev.nodeSize))
    view.dispatch(tr.scrollIntoView())
  } else {
    const next = doc.nodeAt(pos + node.nodeSize)
    if (!next || $p.index() + 1 >= $p.parent.childCount) return false
    const tr = view.state.tr.replaceWith(pos, pos + node.nodeSize + next.nodeSize, [next, node])
    tr.setSelection(NodeSelection.create(tr.doc, pos + next.nodeSize))
    view.dispatch(tr.scrollIntoView())
  }
  return true
}

export function canMove(view: EditorView, pos: number, dir: -1 | 1) {
  const $p = view.state.doc.resolve(pos)
  return dir < 0 ? $p.index() > 0 : $p.index() + 1 < $p.parent.childCount
}

export function duplicateNode(view: EditorView, pos: number) {
  const node = view.state.doc.nodeAt(pos)
  if (!node) return
  const tr = view.state.tr.insert(pos + node.nodeSize, node)
  tr.setSelection(NodeSelection.create(tr.doc, pos + node.nodeSize))
  view.dispatch(tr.scrollIntoView())
}

export function deleteNode(view: EditorView, pos: number) {
  const node = view.state.doc.nodeAt(pos)
  if (node) view.dispatch(view.state.tr.delete(pos, pos + node.nodeSize))
}

/** Copia ou recorta o nó pela área de transferência do sistema (dá para colar em outra nota, com fotos e anexos). */
export function clipNode(view: EditorView, pos: number, how: 'copy' | 'cut') {
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)))
  view.focus()
  return document.execCommand(how)
}

/** Checklist: marca ou desmarca todos os itens. */
export function checkAll(view: EditorView, pos: number, checked: boolean) {
  const list = view.state.doc.nodeAt(pos)
  if (!list) return
  const tr = view.state.tr
  list.forEach((item, offset) => {
    if (item.type.name === 'taskItem' && item.attrs.checked !== checked) tr.setNodeMarkup(pos + 1 + offset, undefined, { ...item.attrs, checked })
  })
  view.dispatch(tr)
}

/** Checklist: apaga os itens marcados (e o checklist, se não sobrar nenhum). */
export function deleteChecked(view: EditorView, pos: number) {
  const list = view.state.doc.nodeAt(pos)
  if (!list) return
  const tr = view.state.tr
  const ranges: [number, number][] = []
  list.forEach((item, offset) => {
    if (item.attrs.checked) ranges.push([pos + 1 + offset, pos + 1 + offset + item.nodeSize])
  })
  if (ranges.length === list.childCount) tr.delete(pos, pos + list.nodeSize)
  else for (const [a, b] of ranges.reverse()) tr.delete(a, b)
  view.dispatch(tr)
}
