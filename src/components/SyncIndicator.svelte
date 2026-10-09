<script lang="ts">
  import { CloudAlert, CloudOff, CloudSync } from '@lucide/svelte'
  import { app } from '../lib/app.svelte'

  // Só aparece quando há algo a dizer: sincronizando (some sozinho), sem conexão ou erro.
  // Com tudo certo, não ocupa espaço nenhum. Tocar leva às configurações do Drive.
  const info = $derived(
    app.sync === 'syncing' ? { Icon: CloudSync, label: 'Sincronizando com o Drive…' }
    : app.sync === 'offline' ? { Icon: CloudOff, label: 'Sem conexão. As alterações ficam salvas aqui e sobem quando voltar.' }
    : app.sync === 'error' ? { Icon: CloudAlert, label: 'Não foi possível sincronizar com o Drive. Ver detalhes' }
    : null,
  )
</script>

{#if info}
  <button class="sync-ind {app.sync}" aria-label={info.label} title={info.label} onclick={() => (app.settingsOpen = true)}>
    <info.Icon size={18} />
  </button>
{/if}
