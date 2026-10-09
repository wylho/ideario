<script lang="ts">
  import { Dialog } from 'bits-ui'
  import { app } from '../lib/app.svelte'
  import NavList from './NavList.svelte'
</script>

<Dialog.Root bind:open={app.drawerOpen}>
  <Dialog.Portal>
    <Dialog.Overlay class="overlay" />
    <Dialog.Content class="drawer" aria-describedby={undefined}>
      <div class="drawer-head">
        <Dialog.Title class="brand">Ideário</Dialog.Title>
        <span class="meta">Sincronizado · Drive</span>
      </div>
      <NavList />
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
