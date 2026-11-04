<script lang="ts">
  import { DropdownMenu } from 'bits-ui'
  import { Check, Globe, LayoutGrid, LayoutList, Rows3, LayoutDashboard, SlidersHorizontal } from '@lucide/svelte'
  import { t, STATUS } from '@wylho/atrio'
  import { app } from '../lib/app.svelte'
  import type { LinkGroup, LinkLayout, ReminderStatus } from '../lib/types'

  // As ações da visão Links que não cabem no filtro de tipo nem no ordenar: o site, o status (o da nota), a origem
  // (cartão ou palavra), agrupar e o jeito de ver. Mesmo desenho dos outros menus da barra.
  const LAYOUTS: { id: LinkLayout; label: string; icon: typeof LayoutGrid }[] = [
    { id: 'cards', get label() { return t('Cards') }, icon: LayoutGrid },
    { id: 'list', get label() { return t('Lista') }, icon: LayoutList },
    { id: 'heads', get label() { return t('Títulos') }, icon: Rows3 },
    { id: 'mural', get label() { return t('Mural') }, icon: LayoutDashboard },
  ]
  const GROUPS: { id: LinkGroup; label: string }[] = [
    { id: 'none', get label() { return t('Sem grupos') } },
    { id: 'date', get label() { return t('Por data') } },
    { id: 'tag', get label() { return t('Por tag') } },
    { id: 'site', get label() { return t('Por site') } },
    { id: 'category', get label() { return t('Por categoria') } },
  ]
  const STATES: ReminderStatus[] = ['todo', 'doing', 'done']
  const layout = $derived(LAYOUTS.find((l) => l.id === app.linksLayout) ?? LAYOUTS[0])
  const more = $derived(!!app.linksStatus || !!app.linksOrigin || app.linksGroup !== 'none')
  const siteLabel = $derived(app.linksSite ? `${t('Site')}: ${app.linksSite}` : t('Site'))
</script>

{#snippet check(on: boolean)}<span class="menu-check" class:hidden={!on}><Check size={15} /></span>{/snippet}

{#snippet sitesGroup()}
  <div class="menu-heading" aria-hidden="true">{t('Site')}</div>
  <DropdownMenu.RadioGroup value={app.linksSite ?? ''} onValueChange={(v) => (app.linksSite = v || null)}>
    <DropdownMenu.RadioItem value="" class="menu-item">
      {#snippet children({ checked })}<span class="grow">{t('Todos os sites')}</span>{@render check(checked)}{/snippet}
    </DropdownMenu.RadioItem>
    {#each app.linkSites as s (s.site)}
      <DropdownMenu.RadioItem value={s.site} class="menu-item">
        {#snippet children({ checked })}<span class="grow">{s.site}</span><small class="menu-hint">{s.count}</small>{@render check(checked)}{/snippet}
      </DropdownMenu.RadioItem>
    {/each}
  </DropdownMenu.RadioGroup>
{/snippet}

{#snippet layoutGroup()}
  <div class="menu-heading" aria-hidden="true">{t('Ver como')}</div>
  <DropdownMenu.RadioGroup value={app.linksLayout} onValueChange={(v) => app.setLinksLayout(v as LinkLayout)}>
    {#each LAYOUTS as l (l.id)}
      <DropdownMenu.RadioItem value={l.id} class="menu-item">
        {#snippet children({ checked })}<l.icon size={16} /><span class="grow">{l.label}</span>{@render check(checked)}{/snippet}
      </DropdownMenu.RadioItem>
    {/each}
  </DropdownMenu.RadioGroup>
{/snippet}

<!-- No celular a barra é curta: Site e Ver como entram no menu de filtros. -->
{#if app.wide}
<DropdownMenu.Root>
  <DropdownMenu.Trigger class="icon-btn {app.linksSite ? 'on' : ''}" aria-label={siteLabel} title={siteLabel}><Globe size={18} /></DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content class="menu" align="end" sideOffset={6}>{@render sitesGroup()}</DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>
{/if}

<DropdownMenu.Root>
  <DropdownMenu.Trigger class="icon-btn {more || (!app.wide && app.linksSite) ? 'on' : ''}" aria-label={t('Mais filtros')} title={t('Status, origem e grupos')}><SlidersHorizontal size={18} /></DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content class="menu links-more" align="end" sideOffset={6}>
      {#if !app.wide}{@render layoutGroup()}<DropdownMenu.Separator class="menu-sep" />{@render sitesGroup()}<DropdownMenu.Separator class="menu-sep" />{/if}
      <div class="menu-heading" aria-hidden="true">{t('Status')}</div>
      <DropdownMenu.RadioGroup value={app.linksStatus ?? ''} onValueChange={(v) => (app.linksStatus = (v || null) as ReminderStatus | null)}>
        <DropdownMenu.RadioItem value="" class="menu-item">
          {#snippet children({ checked })}<span class="grow">{t('Todos')}</span>{@render check(checked)}{/snippet}
        </DropdownMenu.RadioItem>
        {#each STATES as s (s)}
          <DropdownMenu.RadioItem value={s} class="menu-item">
            {#snippet children({ checked })}<i class="dot" style:background={STATUS[s].color}></i><span class="grow">{t(STATUS[s].label)}</span>{@render check(checked)}{/snippet}
          </DropdownMenu.RadioItem>
        {/each}
      </DropdownMenu.RadioGroup>
      <DropdownMenu.Separator class="menu-sep" />
      <div class="menu-heading" aria-hidden="true">{t('Origem')}</div>
      <DropdownMenu.RadioGroup value={app.linksOrigin ?? ''} onValueChange={(v) => (app.linksOrigin = (v || null) as 'card' | 'word' | null)}>
        {#each [['', t('Todas')], ['card', t('Cartão de link')], ['word', t('Link na palavra')]] as [v, label] (v)}
          <DropdownMenu.RadioItem value={v} class="menu-item">
            {#snippet children({ checked })}<span class="grow">{label}</span>{@render check(checked)}{/snippet}
          </DropdownMenu.RadioItem>
        {/each}
      </DropdownMenu.RadioGroup>
      <DropdownMenu.Separator class="menu-sep" />
      <div class="menu-heading" aria-hidden="true">{t('Agrupar')}</div>
      <DropdownMenu.RadioGroup value={app.linksGroup} onValueChange={(v) => (app.linksGroup = v as LinkGroup)}>
        {#each GROUPS as g (g.id)}
          <DropdownMenu.RadioItem value={g.id} class="menu-item">
            {#snippet children({ checked })}<span class="grow">{g.label}</span>{@render check(checked)}{/snippet}
          </DropdownMenu.RadioItem>
        {/each}
      </DropdownMenu.RadioGroup>
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>

{#if app.wide}
<DropdownMenu.Root>
  <DropdownMenu.Trigger class="icon-btn" aria-label="{t('Ver como')}: {layout.label}" title="{t('Ver como')}: {layout.label}"><layout.icon size={19} /></DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content class="menu" align="end" sideOffset={6}>{@render layoutGroup()}</DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>
{/if}

<style>
  /* No celular o menu leva também Site e Ver como: rola se não couber. */
  :global(.menu.links-more) { max-height: min(70vh, 560px); overflow: auto; }
</style>
