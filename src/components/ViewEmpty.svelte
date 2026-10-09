<script lang="ts">
  import { app } from '../lib/app.svelte'
  import { viewInfo } from '../lib/views'
  import type { View } from '../lib/types'

  // Estado vazio de uma visão. Com filtro ativo, diz onde não há nada e mantém o filtro;
  // oferece criar ali mesmo ou ver a mesma visão sem filtro.
  let { view, hint }: { view: View; hint?: string } = $props()

  const info = $derived(viewInfo(view))
  const where = $derived(app.filterLabel)
</script>

<div class="empty">
  <div class="empty-ico"><info.Icon /></div>
  {#if app.query}
    <h3>Nada encontrado</h3>
    <p>Nenhum resultado para “{app.query}”{where ? ` em ${where}` : ''}.</p>
  {:else}
    <h3>{info.none}{where ? ` em ${where}` : ''}</h3>
    <p>{hint ?? (where ? `O filtro continua ativo. Troque a visão para ver o que há em ${where}, ou veja ${info.many} de tudo.` : 'Nada por aqui ainda.')}</p>
    <div class="empty-acts">
      <button class="btn primary" onclick={() => app.openNew()}>{view === 'reminders' ? 'Nova nota' : info.add}{where ? ` em ${where}` : ''}</button>
      {#if where}<button class="btn ghost" onclick={() => app.clearFilter()}>Ver {info.many} de tudo</button>{/if}
    </div>
  {/if}
</div>
