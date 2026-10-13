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

/** Bloco (e item de lista) sob o ponteiro. Na margem esquerda (onde fica a alça) vale a linha; dentro do texto, o
 *  ponto exato (um subitem fica mais à direita que o item de cima). */
export function blockAt(view: EditorView, y: number, x?: number): BlockHit | null {
  const r = view.dom.getBoundingClientRect()
  const left = Math.min(Math.max(x ?? 0, r.left + Math.min(40, r.width / 2)), r.right - 4)
  const res = view.posAtCoords({ left, top: y })
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
  return { block: { pos: blockPos, node, dom }, item: itemAtRow(view, blockPos, node, y) }
}

/** Item de lista/checklist na linha `y`, em qualquer nível. Cada item é dono da faixa que vai do topo dele até onde
 *  começam os subitens, então a altura basta: na coluna da alça, à esquerda do recuo, o ponteiro ainda está "dentro"
 *  do item de cima, mas a linha é do subitem. */
function itemAtRow(view: EditorView, blockPos: number, block: PMNode, y: number): BlockHit['item'] {
  let hit: BlockHit['item'] = null
  block.descendants((n, rel) => {
    if (hit) return false
    if (!ITEMS.has(n.type.name)) return true
    const pos = blockPos + 1 + rel
    const dom = view.nodeDOM(pos) as HTMLElement | null
    if (!dom) return false
    const r = dom.getBoundingClientRect()
    if (y < r.top || y >= r.bottom) return false
    const sub = [...dom.children].find((c) => c.matches('ul, ol') || !!c.querySelector(':scope > ul, :scope > ol'))
    const nested = sub?.matches('ul, ol') ? sub : sub?.querySelector(':scope > ul, :scope > ol')
    const ownBottom = nested ? nested.getBoundingClientRect().top : r.bottom
    if (y < ownBottom) hit = { pos, node: n, dom }
    return true
  })
  return hit
}

export interface DropTarget {
  /** Posição no documento onde o nó entra. */
  pos: number
  /** Linha que mostra onde vai cair (coordenadas da tela). */
  line: { top: number; left: number; width: number }
}

/**
 * Onde o nó arrastado pela alça cairia com o ponteiro em `y`. Item de lista cai antes ou depois de outro item do mesmo
 * tipo (em qualquer nível, levando os subitens junto); bloco cai antes ou depois de outro bloco. Nada dentro dele mesmo.
 * O arraste é feito com o ponteiro (não com o arrastar do HTML): no macOS e no Windows a janela do Tauri fica com todo
 * arraste para receber arquivos do sistema, e a página nunca recebia o soltar.
 */
export function dropTargetAt(view: EditorView, from: number, y: number): DropTarget | null {
  const { doc } = view.state
  const node = doc.nodeAt(from)
  if (!node) return null
  const inside = (p: number) => p >= from && p < from + node.nodeSize
  const at = (pos: number, dom: HTMLElement, before: boolean, ownBottom: number): DropTarget => {
    const r = dom.getBoundingClientRect()
    return { pos, line: { top: before ? r.top : ownBottom, left: r.left, width: r.width } }
  }
  if (ITEMS.has(node.type.name)) {
    let target: DropTarget | null = null
    doc.forEach((block, offset) => {
      if (target || !['bulletList', 'orderedList', 'taskList'].includes(block.type.name)) return
      const hit = itemAtRow(view, offset, block, y)
      if (!hit || hit.node.type !== node.type || inside(hit.pos)) return
      const r = hit.dom.getBoundingClientRect()
      const sub = hit.dom.querySelector(':scope > div > ul, :scope > div > ol, :scope > ul, :scope > ol')
      const ownBottom = sub ? sub.getBoundingClientRect().top : r.bottom
      const before = y < (r.top + ownBottom) / 2
      target = at(before ? hit.pos : hit.pos + hit.node.nodeSize, hit.dom, before, r.bottom)
    })
    return target
  }
  let target: DropTarget | null = null
  doc.forEach((block, offset) => {
    if (target || offset === from) return
    const dom = view.nodeDOM(offset) as HTMLElement | null
    if (!dom?.getBoundingClientRect) return
    const r = dom.getBoundingClientRect()
    if (y < r.top - 4 || y > r.bottom + 4) return
    const before = y < (r.top + r.bottom) / 2
    const pos = before ? offset : offset + block.nodeSize
    if (pos === from || pos === from + node.nodeSize) return
    target = at(pos, dom, before, r.bottom)
  })
  return target
}

/** Move o nó de `from` para `to` (posições de antes de mover). Uma lista que ficaria vazia sai junto. */
export function moveNodeTo(view: EditorView, from: number, to: number) {
  const { doc } = view.state
  const node = doc.nodeAt(from)
  if (!node || (to >= from && to <= from + node.nodeSize)) return false
  let cut = { from, to: from + node.nodeSize }
  // tirar o único item de uma lista deixaria a lista vazia (inválida): a lista sai inteira
  for (let $c = doc.resolve(cut.from); $c.depth > 0 && $c.parent.childCount === 1 && $c.parent.type.name.endsWith('List'); $c = doc.resolve($c.before())) {
    cut = { from: $c.before(), to: $c.after() }
  }
  const tr = view.state.tr.delete(cut.from, cut.to)
  const dest = tr.mapping.map(to)
  const $d = tr.doc.resolve(dest)
  if (!$d.parent.canReplaceWith($d.index(), $d.index(), node.type)) return false
  tr.insert(dest, node)
  tr.setSelection(NodeSelection.create(tr.doc, dest))
  view.dispatch(tr.scrollIntoView())
  return true
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

/** Checklist: marca ou desmarca todos os itens (subitens inclusive). */
export function checkAll(view: EditorView, pos: number, checked: boolean) {
  const list = view.state.doc.nodeAt(pos)
  if (!list) return
  const tr = view.state.tr
  list.descendants((item, offset) => {
    if (item.type.name === 'taskItem' && item.attrs.checked !== checked) tr.setNodeMarkup(pos + 1 + offset, undefined, { ...item.attrs, checked })
  })
  view.dispatch(tr)
}

/** Itens marcados e quantos são (subitens inclusive): (marcados, total). */
export function checkCount(list: PMNode): [number, number] {
  let done = 0
  let total = 0
  list.descendants((n) => {
    if (n.type.name !== 'taskItem') return
    total++
    if (n.attrs.checked) done++
  })
  return [done, total]
}

/** Checklist: apaga os itens marcados (com os subitens deles) e o checklist, se não sobrar nenhum. */
export function deleteChecked(view: EditorView, pos: number) {
  const list = view.state.doc.nodeAt(pos)
  if (!list) return
  const tr = view.state.tr
  const ranges: [number, number][] = []
  let kept = 0
  list.descendants((item, offset) => {
    if (item.type.name !== 'taskItem') return
    if (item.attrs.checked) {
      ranges.push([pos + 1 + offset, pos + 1 + offset + item.nodeSize])
      return false // os subitens saem junto
    }
    kept++
  })
  if (!kept) tr.delete(pos, pos + list.nodeSize)
  else for (const [a, b] of ranges.reverse()) tr.delete(a, b)
  view.dispatch(tr)
}

/** Recuo de um item de lista ou checklist: dá para recuar se há um item antes dele (vira subitem desse); dá para
 *  voltar se ele já é subitem. */
export function canIndent(view: EditorView, pos: number, dir: 1 | -1) {
  const $p = view.state.doc.resolve(pos)
  if (dir > 0) return $p.index() > 0
  return $p.depth >= 2 && ITEMS.has($p.node($p.depth - 1).type.name)
}

/** Formas que um bloco de texto pode tomar ("Transformar em"). */
export type Shape = 'paragraph' | 'heading' | 'bullet' | 'task' | 'code'

const LISTS: Record<'bullet' | 'task', [string, string]> = { bullet: ['bulletList', 'listItem'], task: ['taskList', 'taskItem'] }

export const shapeOf = (name: string): Shape | null =>
  (({ paragraph: 'paragraph', heading: 'heading', bulletList: 'bullet', orderedList: 'bullet', taskList: 'task', codeBlock: 'code' }) as Record<string, Shape>)[name] ??
  null

/** Linhas de texto de um bloco, na ordem: os parágrafos dos itens (subitens inclusive) ou as linhas do código. */
function lines(node: PMNode): PMNode[] {
  const schema = node.type.schema
  if (node.type.name === 'codeBlock') {
    return node.textContent.split('\n').map((l) => schema.nodes.paragraph.create(null, l ? schema.text(l) : null))
  }
  if (node.isTextblock) return [node]
  const out: PMNode[] = []
  node.forEach((child) => out.push(...lines(child)))
  return out
}

/** Lista na forma `to`, mantendo os níveis (subitens) e, entre checklists, o marcado. */
function relist(list: PMNode, to: 'bullet' | 'task'): PMNode {
  const schema = list.type.schema
  const [listType, itemType] = LISTS[to]
  const items: PMNode[] = []
  list.forEach((item) => {
    const content: PMNode[] = []
    item.forEach((c) => content.push(c.type.name in { bulletList: 1, orderedList: 1, taskList: 1 } ? relist(c, to) : c.isTextblock && c.type.name !== 'paragraph' ? schema.nodes.paragraph.create(null, c.content) : c))
    const attrs = to === 'task' ? { checked: item.type.name === 'taskItem' ? !!item.attrs.checked : false } : null
    items.push(schema.nodes[itemType].create(attrs, content))
  })
  return schema.nodes[listType].create(null, items)
}

/** "Transformar em": troca a forma do bloco em `pos` sem perder texto (nem os níveis, de lista para lista). */
export function convertBlock(view: EditorView, pos: number, to: Shape) {
  const node = view.state.doc.nodeAt(pos)
  if (!node) return false
  const schema = node.type.schema
  const isList = ['bulletList', 'orderedList', 'taskList'].includes(node.type.name)
  let out: PMNode[]
  if ((to === 'bullet' || to === 'task') && isList) out = [relist(node, to)]
  else {
    const ls = lines(node)
    if (to === 'paragraph') out = ls.map((l) => schema.nodes.paragraph.create(null, l.content))
    else if (to === 'heading') out = ls.map((l) => schema.nodes.heading.create({ level: 3 }, l.content))
    else if (to === 'code') out = [schema.nodes.codeBlock.create(null, ls.length && ls.some((l) => l.textContent) ? schema.text(ls.map((l) => l.textContent).join('\n')) : null)]
    else {
      const [listType, itemType] = LISTS[to]
      const items = (ls.length ? ls : [schema.nodes.paragraph.create()]).map((l) =>
        schema.nodes[itemType].create(to === 'task' ? { checked: false } : null, schema.nodes.paragraph.create(null, l.content)),
      )
      out = [schema.nodes[listType].create(null, items)]
    }
  }
  const tr = view.state.tr.replaceWith(pos, pos + node.nodeSize, out)
  view.dispatch(tr.scrollIntoView())
  view.focus()
  return true
}
