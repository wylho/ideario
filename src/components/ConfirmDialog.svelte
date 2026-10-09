<script lang="ts">
  import { AlertDialog } from 'bits-ui'

  // Confirmação só para o que não tem volta (o resto usa "Desfazer" no aviso).
  let { open = $bindable(false), title, text, confirm, onconfirm }: {
    open?: boolean
    title: string
    text: string
    confirm: string
    onconfirm: () => void
  } = $props()
</script>

<AlertDialog.Root bind:open>
  <AlertDialog.Portal>
    <AlertDialog.Overlay class="overlay" />
    <AlertDialog.Content class="confirm">
      <AlertDialog.Title class="confirm-title">{title}</AlertDialog.Title>
      <AlertDialog.Description class="confirm-text">{text}</AlertDialog.Description>
      <div class="confirm-actions">
        <AlertDialog.Cancel class="btn ghost">Cancelar</AlertDialog.Cancel>
        <AlertDialog.Action class="btn danger" onclick={() => { open = false; onconfirm() }}>{confirm}</AlertDialog.Action>
      </div>
    </AlertDialog.Content>
  </AlertDialog.Portal>
</AlertDialog.Root>
