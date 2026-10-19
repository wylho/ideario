// Leitor de Markdown simples para a prévia no navegador e os testes da interface (no app quem lê é o núcleo,
// src-tauri/src/markdown.rs). Títulos, listas, checklist, citação, linha e tabela; o texto vai sem marcas.
type Node = { type: string; attrs?: Record<string, unknown>; content?: Node[]; text?: string }

const text = (t: string): Node[] => (t ? [{ type: 'text', text: t }] : [])
const para = (t: string): Node => ({ type: 'paragraph', ...(t ? { content: text(t) } : {}) })
const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())

export function mockMarkdown(md: string): { type: 'doc'; content: Node[] } {
  const out: Node[] = []
  const lines = md.replace(/\r/g, '').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (!l.trim()) continue
    let m: RegExpMatchArray | null
    if ((m = l.match(/^(#{1,3}) (.*)/))) out.push({ type: 'heading', attrs: { level: m[1].length }, content: text(m[2]) })
    else if (/^-{3,}\s*$/.test(l)) out.push({ type: 'horizontalRule' })
    else if (l.startsWith('> ')) out.push({ type: 'blockquote', content: [para(l.slice(2))] })
    else if (/^\|.*\|\s*$/.test(l) && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? '')) {
      const rows = [cells(l)]
      i += 2
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]))
      i--
      out.push({
        type: 'table',
        content: rows.map((r, ri) => ({
          type: 'tableRow',
          content: r.map((c) => ({ type: ri === 0 ? 'tableHeader' : 'tableCell', content: [para(c)] })),
        })),
      })
    } else if ((m = l.match(/^[-*] \[( |x)\] (.*)/))) {
      const items: Node[] = []
      while (i < lines.length && (m = lines[i].match(/^[-*] \[( |x)\] (.*)/))) {
        items.push({ type: 'taskItem', attrs: { checked: m[1] === 'x' }, content: [para(m[2])] })
        i++
      }
      i--
      out.push({ type: 'taskList', content: items })
    } else if (/^[-*] /.test(l)) {
      const items: Node[] = []
      while (i < lines.length && /^[-*] /.test(lines[i])) items.push({ type: 'listItem', content: [para(lines[i++].slice(2))] })
      i--
      out.push({ type: 'bulletList', content: items })
    } else out.push(para(l))
  }
  return { type: 'doc', content: out.length ? out : [para('')] }
}
