// A visão Links no mock: a mesma regra do núcleo (`src-tauri/src/links.rs`), para a prévia e os testes e2e.
import type { LinkKind, LinkRow, Millis } from '../../types'

type Node = { type?: string; text?: string; attrs?: Record<string, unknown>; marks?: { type: string; attrs?: Record<string, unknown> }[]; content?: Node[] }
export type Found = { url: string; title: string; description: string | null; site: string; image: string | null; word: boolean }

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

export function host(url: string): string {
  try {
    return new URL(url.trim()).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** Mesmo endereço: sem o "#trecho" e sem a barra do fim. */
export function key(url: string): string {
  try {
    const u = new URL(url.trim())
    u.hash = ''
    return u.toString().replace(/\/$/, '')
  } catch {
    return url.trim()
  }
}

export function kindOf(url: string): LinkKind {
  let u: URL
  try {
    u = new URL(url.trim())
  } catch {
    return 'article'
  }
  const h = u.hostname.replace(/^www\./, '').toLowerCase()
  const last = u.pathname.toLowerCase().split('/').pop() ?? ''
  const ext = last.includes('.') ? last.split('.').pop()! : ''
  const on = (sites: string[]) => sites.some((s) => h === s || h.endsWith('.' + s))
  if (['mp4', 'webm', 'mov', 'mkv', 'avi'].includes(ext) || on(['youtube.com', 'youtu.be', 'vimeo.com', 'twitch.tv', 'tiktok.com', 'dailymotion.com', 'loom.com'])) return 'video'
  if (['mp3', 'm4a', 'ogg', 'oga', 'wav', 'flac', 'opus'].includes(ext) || on(['spotify.com', 'soundcloud.com', 'podcasts.apple.com', 'music.apple.com', 'bandcamp.com', 'deezer.com'])) return 'audio'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'heic'].includes(ext) || on(['unsplash.com', 'imgur.com', 'flickr.com', 'dribbble.com', 'behance.net', 'pinterest.com'])) return 'image'
  if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'csv', 'epub'].includes(ext) || h === 'docs.google.com' || h === 'drive.google.com') return 'doc'
  if (on(['github.com', 'gitlab.com', 'codeberg.org', 'bitbucket.org', 'npmjs.com', 'crates.io', 'pypi.org', 'stackoverflow.com', 'developer.mozilla.org', 'docs.rs', 'huggingface.co'])) return 'code'
  return 'article'
}

/** Cartões de link e links na palavra, na ordem do texto. */
export function extract(body: Node): Found[] {
  const out: Found[] = []
  const walk = (n: Node) => {
    if (n.type === 'linkCard') {
      const url = str(n.attrs?.url)
      if (url) out.push({ url, title: str(n.attrs?.title) ?? url, description: str(n.attrs?.description), site: str(n.attrs?.site) ?? host(url), image: str(n.attrs?.image), word: false })
      return
    }
    let run: { url: string; text: string } | null = null
    const flush = () => {
      if (run) out.push({ url: run.url, title: run.text.trim() || run.url, description: null, site: host(run.url), image: null, word: true })
      run = null
    }
    for (const c of n.content ?? []) {
      const href = c.type === 'text' ? str(c.marks?.find((m) => m.type === 'link')?.attrs?.href) : null
      if (href) {
        if (run && run.url === href) run.text += c.text ?? ''
        else {
          flush()
          run = { url: href, text: c.text ?? '' }
        }
      } else {
        flush()
        walk(c)
      }
    }
    flush()
  }
  walk(body)
  return out
}

/** Uma linha por endereço; um cartão vale mais que a palavra para título, descrição e imagem. */
export function group(notes: { id: string; tags: string[]; updatedAt: Millis; found: Found[] }[]): LinkRow[] {
  const rows: LinkRow[] = []
  const at = new Map<string, LinkRow>()
  for (const n of notes) {
    for (const f of n.found) {
      const k = key(f.url)
      let r = at.get(k)
      if (!r) {
        r = { url: f.url, title: f.title, description: null, site: f.site, image: null, word: true, kind: kindOf(f.url), noteIds: [], tags: [], updatedAt: n.updatedAt }
        at.set(k, r)
        rows.push(r)
      }
      if (!f.word && r.word) Object.assign(r, { word: false, title: f.title, site: f.site })
      if (!f.word) {
        r.description ??= f.description
        r.image ??= f.image
      }
      if (!r.noteIds.includes(n.id)) r.noteIds.push(n.id)
      for (const t of n.tags) if (!r.tags.includes(t)) r.tags.push(t)
      r.updatedAt = Math.max(r.updatedAt, n.updatedAt)
    }
  }
  return rows
}

/** Corpo da nota de um link salvo: o cartão e uma linha vazia. */
export const cardBody = (url: string) => ({ type: 'doc', content: [{ type: 'linkCard', attrs: { url, title: null, description: null, site: host(url), image: null } }, { type: 'paragraph' }] })

/** Põe a prévia nos cartões deste endereço que ainda não têm o campo. */
export function fill(body: Node, p: { url: string; title: string | null; description: string | null; site: string | null; image: string | null }): boolean {
  const k = key(p.url)
  let changed = false
  const walk = (n: Node) => {
    if (n.type === 'linkCard' && n.attrs && key(String(n.attrs.url ?? '')) === k) {
      for (const f of ['title', 'description', 'site', 'image'] as const) {
        const v = str(p[f])
        if (!v) continue
        if (!str(n.attrs[f]) || (f === 'site' && n.attrs.site === host(k))) {
          n.attrs[f] = v
          changed = true
        }
      }
      return
    }
    n.content?.forEach(walk)
  }
  walk(body)
  return changed
}
