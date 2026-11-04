<script lang="ts">
  // Visão Links: os links das notas num lugar só, como num gerenciador de favoritos. Um endereço por linha (cartões de
  // link e links na palavra), com as notas onde ele está. Categorias e tags são o filtro de sempre; tipo, site,
  // status, origem, agrupar, ordem e o jeito de ver ficam na barra de cima (ViewActions + LinksMenu).
  // O status é o da nota, no mesmo seletor de três cores do card. O clique abre o site; o olho (ou Espaço), a prévia.
  import { hasStatus, STATUS, statusOf, StatusToggle, t, tn } from '@wylho/atrio'
  import { Copy, Eye, ExternalLink, Link2, StickyNote, X } from '@lucide/svelte'
  import { api } from '../lib/api'
  import { app, live } from '../lib/app.svelte'
  import { daysAgo } from '../lib/format'
  import { changeStatus } from '../lib/status'
  import type { LinkList, LinkRow, NoteSummary } from '../lib/types'
  import Empty from './Empty.svelte'
  import ViewEmpty from './ViewEmpty.svelte'
  import NoteCard from './NoteCard.svelte'

  const data = live(() => api.listLinks({ filter: $state.snapshot(app.filter), query: app.query }), { links: [], notes: [] } as LinkList)
  const notes = $derived(new Map(data.current.notes.map((n) => [n.id, n])))
  const notesOf = (r: LinkRow) => r.noteIds.map((id) => notes.get(id)).filter((n): n is NoteSummary => !!n)
  const withStatus = (r: LinkRow, s: string) => notesOf(r).some((n) => hasStatus(n) && statusOf(n) === s)

  const base = $derived(data.current.links)
  const list = $derived(
    base
      .filter((r) => !app.linksKind || r.kind === app.linksKind)
      .filter((r) => !app.linksSite || r.site === app.linksSite)
      .filter((r) => !app.linksStatus || withStatus(r, app.linksStatus))
      .filter((r) => !app.linksOrigin || (app.linksOrigin === 'word') === r.word)
      .sort((a, b) =>
        app.linksSort === 'title' ? a.title.localeCompare(b.title)
        : app.linksSort === 'site' ? a.site.localeCompare(b.site) || b.updatedAt - a.updatedAt
        : b.updatedAt - a.updatedAt),
  )

  // Os sites dos links desta tela, para o menu Site (o mais frequente primeiro).
  $effect(() => {
    const m = new Map<string, number>()
    for (const r of base) m.set(r.site, (m.get(r.site) ?? 0) + 1)
    app.linkSites = [...m].map(([site, count]) => ({ site, count })).sort((a, b) => b.count - a.count || a.site.localeCompare(b.site))
  })
  const toDo = $derived(base.filter((r) => withStatus(r, 'todo')).length)
  const sites = $derived(new Set(base.map((r) => r.site)).size)

  // Grupos: Títulos agrupa por data mesmo sem escolher (é uma lista longa).
  const DAY = 86_400_000
  function groups(rows: LinkRow[]): [string | null, LinkRow[]][] {
    const g = app.linksGroup === 'none' && app.linksLayout === 'heads' ? 'date' : app.linksGroup
    if (g === 'none') return [[null, rows]]
    const out = new Map<string, LinkRow[]>()
    const add = (k: string, r: LinkRow) => out.set(k, [...(out.get(k) ?? []), r])
    const now = Date.now()
    for (const r of rows) {
      if (g === 'tag') {
        // As tags do filtro já valem para todos: não viram grupo.
        const own = r.tags.filter((x) => !app.filter.tags.includes(x))
        if (own.length) own.forEach((x) => add('#' + x, r))
        else add(app.filter.tags.length ? t('Sem outra tag') : t('Sem tag'), r)
      } else if (g === 'site') add(r.site, r)
      else if (g === 'category') add(app.category(notesOf(r)[0]?.categoryId ?? null)?.name ?? t('Sem categoria'), r)
      else {
        const age = (now - r.updatedAt) / DAY
        add(age < 1 ? t('Hoje') : age < 7 ? t('Esta semana') : age < 30 ? t('Este mês') : t('Antes'), r)
      }
    }
    const rest = [t('Sem tag'), t('Sem outra tag'), t('Sem categoria')]
    const all = [...out]
    if (g === 'tag' || g === 'site') all.sort((a, b) => Number(rest.includes(a[0])) - Number(rest.includes(b[0])) || b[1].length - a[1].length)
    return all
  }

  // Ícone do site: a letra no tom do endereço (o Ideario não guarda o ícone de cada site).
  const TONES = ['#C26A3D', '#3D63D6', '#B08A1E', '#3E8E7E', '#C25478', '#8A6BC4', '#0F7C8A', '#5D6A65']
  const tone = (s: string) => TONES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % TONES.length]
  const letter = (s: string) => (s.replace(/^(www|open|m)\./, '')[0] ?? '?').toUpperCase()

  // A prévia guarda só o endereço e segue a lista: se o link mudou (status, prévia da página), mostra o novo; se sumiu
  // (filtro, nota apagada), fecha.
  let openUrl = $state<string | null>(null)
  const open = $derived(openUrl ? (data.current.links.find((r) => r.url === openUrl) ?? null) : null)

  const visit = (r: LinkRow) => void api.openUrl(r.url)
  function copy(r: LinkRow) {
    navigator.clipboard?.writeText(r.url).then(() => app.say(t('Link copiado')), () => app.say(r.url))
  }
  function key(e: KeyboardEvent, r: LinkRow) {
    if (e.key === ' ') {
      e.preventDefault()
      openUrl = r.url
    }
  }
  const kinds: Record<string, string> = {
    article: 'Artigos', video: 'Vídeos', audio: 'Áudio', image: 'Imagens', doc: 'Documentos', code: 'Código',
  }
  const chips = $derived([
    ...(app.linksKind ? [{ label: t(kinds[app.linksKind]), clear: () => (app.linksKind = null) }] : []),
    ...(app.linksSite ? [{ label: app.linksSite, clear: () => (app.linksSite = null) }] : []),
    ...(app.linksStatus ? [{ label: t(STATUS[app.linksStatus].label), clear: () => (app.linksStatus = null) }] : []),
    ...(app.linksOrigin ? [{ label: app.linksOrigin === 'word' ? t('Link na palavra') : t('Cartão de link'), clear: () => (app.linksOrigin = null) }] : []),
  ])
</script>

{#snippet fav(r: LinkRow, big = false)}
  <span class="lk-fav" class:big style:background={tone(r.site)} aria-hidden="true">{letter(r.site)}</span>
{/snippet}

{#snippet cover(r: LinkRow)}
  {#if r.image}<img class="lk-img" src={r.image} alt="" loading="lazy" />{:else}<span class="lk-noimg">{@render fav(r, true)}</span>{/if}
{/snippet}

{#snippet status(r: LinkRow)}
  {@const ns = notesOf(r)}
  {#if ns.length > 1}
    <span class="lk-many">{tn(ns.length, 'em {n} nota', 'em {n} notas')}</span>
  {:else if ns[0] && hasStatus(ns[0])}
    {@const n = ns[0]}
    <StatusToggle value={statusOf(n)} onchange={(s) => void changeStatus(n, s)} label={t('Status')} />
  {/if}
{/snippet}

{#snippet tags(r: LinkRow)}
  {#each r.tags as x (x)}
    <button class="pill tag" class:on={app.filter.tags.includes(x)} title={t('Filtrar por {nome}', { nome: '#' + x })} onclick={(e) => { e.stopPropagation(); app.toggleTag(x) }}>#{x}</button>
  {/each}
{/snippet}

{#snippet acts(r: LinkRow)}
  <span class="lk-acts">
    <button class="icon-btn sm" aria-label={t('Prévia')} title={t('Prévia (Espaço)')} onclick={(e) => { e.stopPropagation(); openUrl = r.url }}><Eye size={16} /></button>
    <button class="icon-btn sm" aria-label={t('Abrir nota')} title={t('Abrir nota')} onclick={(e) => { e.stopPropagation(); app.openNote(r.noteIds[0]) }}><StickyNote size={16} /></button>
    <button class="icon-btn sm" aria-label={t('Copiar link')} title={t('Copiar link')} onclick={(e) => { e.stopPropagation(); copy(r) }}><Copy size={16} /></button>
  </span>
{/snippet}

{#snippet meta(r: LinkRow)}
  {@const n = notesOf(r)[0]}
  {@const cat = n ? app.category(n.categoryId) : null}
  <span class="lk-meta">
    {@render fav(r)}<span class="lk-site">{r.site}</span>
    <!-- O nome da nota só quando diz algo a mais (num link salvo, a nota tem o título do próprio link). -->
    {#if n && n.label !== r.title}<span aria-hidden="true">·</span><span class="lk-note">{#if cat}<i class="dot" style:background={cat.color}></i>{/if}{n.label}{#if r.noteIds.length > 1}<b> +{r.noteIds.length - 1}</b>{/if}</span>{/if}
    <span aria-hidden="true">·</span><span>{daysAgo(r.updatedAt)}</span>
  </span>
{/snippet}

{#snippet item(r: LinkRow)}
  {#if app.linksLayout === 'list'}
    <div class="lk-row" role="link" tabindex="0" title={r.url} onclick={() => visit(r)} onkeydown={(e) => (e.key === 'Enter' ? visit(r) : key(e, r))}>
      <span class="lk-thumb">{@render cover(r)}</span>
      <span class="lk-txt">
        <span class="lk-title">{r.title}</span>
        {#if r.description}<span class="lk-desc">{r.description}</span>{/if}
        {@render meta(r)}
      </span>
      <span class="lk-right">
        {@render acts(r)}
        <span class="lk-pills">{#if r.word}<span class="pill word">{t('na palavra')}</span>{/if}{@render tags(r)}{@render status(r)}</span>
      </span>
    </div>
  {:else if app.linksLayout === 'cards'}
    <div class="lk-card" role="link" tabindex="0" title={r.url} onclick={() => visit(r)} onkeydown={(e) => (e.key === 'Enter' ? visit(r) : key(e, r))}>
      <span class="lk-cover">{@render cover(r)}</span>
      {@render acts(r)}
      <span class="lk-body">
        <span class="lk-title two">{r.title}</span>
        {#if r.description}<span class="lk-desc two">{r.description}</span>{/if}
        {#if r.tags.length}<span class="lk-pills start">{@render tags(r)}</span>{/if}
        <span class="lk-foot">{@render fav(r)}<span class="lk-site">{r.site}</span>{#if r.word}<span class="pill word">{t('na palavra')}</span>{/if}<span class="grow"></span>{@render status(r)}</span>
      </span>
    </div>
  {:else if app.linksLayout === 'heads'}
    <div class="lk-head" role="link" tabindex="0" title={r.url} onclick={() => visit(r)} onkeydown={(e) => (e.key === 'Enter' ? visit(r) : key(e, r))}>
      {@render fav(r)}
      <span class="lk-title">{r.title}{#if notesOf(r)[0] && notesOf(r)[0].label !== r.title}<small>{notesOf(r)[0].label}</small>{/if}</span>
      {@render acts(r)}
      <span class="lk-site wide-only">{r.site}</span>
      {@render status(r)}
      <span class="lk-when">{daysAgo(r.updatedAt)}</span>
    </div>
  {:else}
    <div class="lk-tile" class:text={!r.image} role="link" tabindex="0" title={r.url} onclick={() => visit(r)} onkeydown={(e) => (e.key === 'Enter' ? visit(r) : key(e, r))}>
      {#if r.image}
        <img src={r.image} alt="" loading="lazy" />
        <span class="lk-cap">{r.title}</span>
      {:else}
        {@render fav(r, true)}<span class="lk-title">{r.title}</span><span class="lk-site">{r.site}</span>
      {/if}
      {@render acts(r)}
    </div>
  {/if}
{/snippet}

<div class="stats">
  <div><b>{base.length}</b><span>{tn(base.length, 'link', 'links')}</span></div>
  <div><b>{sites}</b><span>{tn(sites, 'site', 'sites')}</span></div>
  <div><b>{toDo}</b><span>{t('a fazer')}</span></div>
</div>

{#if chips.length}
  <div class="lk-chips">
    {#each chips as c (c.label)}
      <span class="lk-chip">{c.label}<button aria-label={t('Tirar o filtro {nome}', { nome: c.label })} onclick={c.clear}><X size={13} /></button></span>
    {/each}
  </div>
{/if}

{#if data.ready && !base.length}
  <ViewEmpty view="links" hint={app.filterLabel ? undefined : t('Cole um endereço numa nota, marque uma palavra com Ctrl+K ou salve um link no +.')} />
{:else if data.ready && !list.length}
  <Empty icon={Link2} title={t('Nenhum link com estes filtros')} text={t('Tire um filtro no alto da tela.')} />
{:else}
  {#each groups(list) as [name, rows] (name ?? '')}
    {#if name}<h4 class="lk-group">{name}<span>{rows.length}</span></h4>{/if}
    <div class="lk-{app.linksLayout}">
      {#each rows as r (r.url)}{@render item(r)}{/each}
    </div>
  {/each}
{/if}

{#if open}
  {@const r = open}
  <aside class="lk-panel" aria-label={t('Prévia do link')}>
    <div class="lk-panel-top">{@render fav(r)}<span class="lk-site">{r.site}</span><span class="grow"></span><button class="icon-btn" aria-label={t('Fechar')} onclick={() => (openUrl = null)}><X size={18} /></button></div>
    <div class="lk-panel-body">
      {#if r.image}<img class="lk-panel-img" src={r.image} alt="" />{/if}
      <h3>{r.title}</h3>
      <span class="lk-url">{r.url}</span>
      {#if r.description}<p>{r.description}</p>{:else if r.word}<p class="muted">{t('Link na palavra: sem imagem nem descrição da página.')}</p>{/if}
      {#if r.tags.length}<h5>{t('Tags')}</h5><span class="lk-pills start">{@render tags(r)}</span>{/if}
      <h5>{r.noteIds.length > 1 ? tn(r.noteIds.length, 'Em {n} nota', 'Em {n} notas') : t('Na nota')}</h5>
      <div class="lk-panel-notes">
        {#each notesOf(r) as n (n.id)}<NoteCard {n} />{/each}
      </div>
    </div>
    <div class="lk-panel-acts">
      <button class="btn primary" onclick={() => visit(r)}><ExternalLink size={16} />{t('Abrir site')}</button>
      <button class="btn ghost" onclick={() => copy(r)}><Copy size={16} />{t('Copiar link')}</button>
    </div>
  </aside>
{/if}

<svelte:window onkeydown={(e) => openUrl && e.key === 'Escape' && !app.editor && (openUrl = null)} />

<style>
  .stats { margin-bottom: 14px; }
  .lk-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: -4px 0 14px; }
  .lk-chip { display: inline-flex; align-items: center; gap: 6px; background: var(--accent-soft); color: var(--accent); border-radius: 999px; padding: 4px 6px 4px 10px; font-size: 12.5px; font-weight: 600; }
  .lk-chip button { display: grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; color: inherit; }
  .lk-chip button:hover { background: color-mix(in oklab, var(--accent) 14%, transparent); }
  .lk-group { font-size: 11px; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); font-weight: 600; margin: 18px 4px 8px; display: flex; gap: 8px; }
  .lk-group span { font-weight: 400; letter-spacing: 0; }
  .grow { flex: 1; }

  .lk-fav { width: 18px; height: 18px; border-radius: 5px; display: inline-grid; place-items: center; font-size: 10.5px; font-weight: 700; color: #fff; flex: none; }
  .lk-fav.big { width: 40px; height: 40px; border-radius: 10px; font-size: 19px; }
  .lk-img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .lk-noimg { display: grid; place-items: center; width: 100%; height: 100%; background: var(--raised); }
  .lk-title { font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lk-desc { color: var(--muted); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .two { white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; }
  .lk-meta, .lk-foot { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 12.5px; min-width: 0; }
  .lk-site, .lk-note { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .lk-note { display: inline-flex; align-items: center; gap: 4px; }
  .lk-pills { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; justify-content: flex-end; }
  .lk-pills.start { justify-content: flex-start; }
  .lk-many { font-size: 11.5px; color: var(--muted); white-space: nowrap; }
  :global(.pill.tag.on) { background: var(--accent-soft); }
  .pill.word { color: var(--prompt); background: var(--prompt-soft); }
  .lk-acts { display: flex; gap: 2px; opacity: 0; transition: opacity .12s; }
  [role='link']:hover .lk-acts, [role='link']:focus-within .lk-acts { opacity: 1; }
  @media (hover: none) { .lk-acts { opacity: 1; } }
  [role='link'] { cursor: pointer; }

  .lk-list { display: grid; gap: 8px; }
  .lk-row { display: grid; grid-template-columns: 112px minmax(0, 1fr) auto; gap: 14px; align-items: center; background: var(--surface); border: 1px solid var(--card-edge); border-radius: 14px; padding: 10px; }
  .lk-row:hover, .lk-card:hover { box-shadow: var(--shadow); }
  .lk-thumb { width: 112px; height: 72px; border-radius: 9px; overflow: hidden; }
  .lk-txt { display: grid; gap: 3px; min-width: 0; }
  .lk-right { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; max-width: 280px; }

  .lk-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; }
  .lk-card { position: relative; background: var(--surface); border: 1px solid var(--card-edge); border-radius: 16px; overflow: hidden; display: flex; flex-direction: column; }
  .lk-cover { aspect-ratio: 16 / 9; max-width: 100%; overflow: hidden; }
  .lk-card .lk-acts { position: absolute; top: 8px; right: 8px; background: var(--surface); border-radius: 10px; padding: 2px; box-shadow: var(--shadow); }
  .lk-body { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 6px; flex: 1; }
  .lk-body .lk-title { font-size: 14px; line-height: 1.35; }
  .lk-body .lk-desc { font-size: 12.5px; line-height: 1.45; }
  .lk-foot { margin-top: auto; padding-top: 2px; }

  .lk-heads { background: var(--surface); border: 1px solid var(--card-edge); border-radius: 14px; overflow: hidden; }
  .lk-head { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto auto auto auto; gap: 12px; align-items: center; padding: 0 12px; min-height: 42px; border-top: 1px solid var(--line); }
  .lk-head:first-child { border-top: 0; }
  .lk-head:hover { background: var(--raised); }
  .lk-head .lk-title { font-weight: 500; }
  .lk-head .lk-title small { color: var(--muted); font-weight: 400; margin-left: 8px; }
  .lk-head .lk-site { color: var(--muted); font-size: 12.5px; max-width: 180px; }
  .lk-when { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; min-width: 60px; text-align: right; }

  .lk-mural { columns: 4 200px; column-gap: 12px; }
  .lk-tile { position: relative; break-inside: avoid; margin-bottom: 12px; border-radius: 14px; overflow: hidden; border: 1px solid var(--card-edge); display: block; }
  .lk-tile img { width: 100%; height: auto; display: block; }
  .lk-tile.text { background: var(--surface); padding: 14px; display: flex; flex-direction: column; gap: 8px; }
  .lk-tile.text .lk-title { white-space: normal; font-size: 15px; line-height: 1.35; }
  .lk-tile.text .lk-site { color: var(--muted); font-size: 12.5px; }
  .lk-cap { position: absolute; inset: auto 0 0 0; padding: 22px 10px 8px; color: #fff; font-size: 12.5px; font-weight: 600; background: linear-gradient(transparent, rgb(0 0 0 / .55)); opacity: 0; transition: opacity .15s; }
  .lk-tile:hover .lk-cap, .lk-tile:focus-visible .lk-cap { opacity: 1; }
  .lk-tile .lk-acts { position: absolute; top: 8px; right: 8px; background: var(--surface); border-radius: 10px; padding: 2px; box-shadow: var(--shadow); }

  .lk-panel { position: fixed; top: 0; right: 0; bottom: 0; width: min(400px, 100vw); z-index: 25; background: var(--surface); border-left: 1px solid var(--line); box-shadow: var(--float-shadow); display: flex; flex-direction: column; padding-top: env(safe-area-inset-top, 0px); }
  .lk-panel-top { display: flex; align-items: center; gap: 8px; padding: 10px 10px 6px 16px; color: var(--muted); font-size: 12.5px; }
  .lk-panel-body { flex: 1; overflow: auto; padding: 0 16px 16px; display: flex; flex-direction: column; gap: 12px; }
  .lk-panel-body > * { flex: none; }
  .lk-panel-img { border-radius: 12px; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; }
  .lk-panel h3 { font-size: 18px; line-height: 1.3; text-wrap: balance; }
  .lk-url { color: var(--accent); font-size: 12.5px; word-break: break-all; user-select: text; }
  .lk-panel p { color: var(--muted); line-height: 1.5; }
  .lk-panel h5 { font-size: 11px; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); font-weight: 600; }
  .lk-panel-notes { display: flex; flex-direction: column; gap: 10px; }
  .lk-panel-acts { display: flex; gap: 8px; padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 0px)); border-top: 1px solid var(--line); }

  @media (max-width: 639px) {
    .lk-row { grid-template-columns: 72px minmax(0, 1fr); }
    .lk-thumb { width: 72px; height: 72px; }
    .lk-right { display: none; }
    .lk-cards { grid-template-columns: 1fr 1fr; gap: 10px; }
    .lk-body .lk-desc { display: none; }
    .lk-mural { columns: 2; }
    .lk-head { grid-template-columns: 18px minmax(0, 1fr) auto auto; }
    .lk-head .lk-acts, .wide-only { display: none; }
  }
</style>
