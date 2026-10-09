import * as Y from 'yjs'
import { BODY, readMeta, writeMeta } from '../../ydoc'
import type { NoteInput, RichDoc, RichNode } from '../../types'

// O mock guarda as notas em JSON; para o editor, monta o Y.Doc no mesmo formato do núcleo (src-tauri/src/ydoc.rs) e
// do y-prosemirror: nó = XmlElement com os atributos não nulos; textos seguidos = um XmlText com as marcas.

export function noteToState(n: NoteInput): Uint8Array {
  const doc = new Y.Doc()
  writeMeta(doc, n)
  doc.transact(() => writeChildren(doc.getXmlFragment(BODY), n.body.content ?? []))
  return Y.encodeStateAsUpdate(doc)
}

export function stateToNote(id: string, state: Uint8Array): NoteInput {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, state)
  const content = readChildren(doc.getXmlFragment(BODY))
  return { id, ...readMeta(doc), body: { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] } }
}

function writeChildren(parent: Y.XmlFragment | Y.XmlElement, nodes: RichNode[]) {
  const out: (Y.XmlElement | Y.XmlText)[] = []
  for (let i = 0; i < nodes.length; ) {
    if (nodes[i].type === 'text') {
      const delta: { insert: string; attributes: Record<string, unknown> }[] = []
      while (i < nodes.length && nodes[i].type === 'text') {
        const t = nodes[i++]
        delta.push({ insert: t.text ?? '', attributes: Object.fromEntries((t.marks ?? []).map((m) => [m.type, m.attrs ?? {}])) })
      }
      const text = new Y.XmlText()
      text.applyDelta(delta)
      out.push(text)
      continue
    }
    const n = nodes[i++]
    const el = new Y.XmlElement(n.type)
    for (const [k, v] of Object.entries(n.attrs ?? {})) if (v != null) el.setAttribute(k, v as string)
    writeChildren(el, n.content ?? [])
    out.push(el)
  }
  parent.insert(0, out)
}

function readChildren(parent: Y.XmlFragment | Y.XmlElement): RichNode[] {
  const out: RichNode[] = []
  for (const child of parent.toArray()) {
    if (child instanceof Y.XmlText) {
      for (const d of child.toDelta() as { insert: unknown; attributes?: Record<string, unknown> }[]) {
        if (typeof d.insert !== 'string' || !d.insert) continue
        const marks = Object.entries(d.attributes ?? {})
          .filter(([, v]) => v != null)
          .map(([k, v]) => {
            const type = k.replace(/--[a-zA-Z0-9+/=]{8}$/, '')
            return v && typeof v === 'object' && Object.keys(v).length ? { type, attrs: v as Record<string, unknown> } : { type }
          })
        out.push(marks.length ? { type: 'text', text: d.insert, marks } : { type: 'text', text: d.insert })
      }
    } else if (child instanceof Y.XmlElement) {
      const attrs = child.getAttributes()
      const content = readChildren(child)
      const node: RichNode = { type: child.nodeName }
      if (Object.keys(attrs).length) node.attrs = attrs
      if (content.length) node.content = content
      out.push(node)
    }
  }
  return out
}

export type { RichDoc }
