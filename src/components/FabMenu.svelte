<script lang="ts">
  import { Camera, Image, Mic, Paperclip, PenLine, Plus } from '@lucide/svelte'
  import { app } from '../lib/app.svelte'
  import { canRecord, hasCamera } from '../lib/capture.svelte'

  // "+" em leque para cima: atalhos que já abrem a nota nova fazendo a coisa (gravando, com a foto, a câmera…).
  // Ctrl+N continua abrindo a nota direto. Câmera e gravador só aparecem se o aparelho tiver.
  let open = $state(false)
  let camera = $state(false)
  hasCamera().then((v) => (camera = v))
  let photoInput: HTMLInputElement | undefined = $state()
  let fileInput: HTMLInputElement | undefined = $state()
  let root: HTMLElement | undefined = $state()

  const items = $derived([
    { id: 'note', label: 'Nota', Icon: PenLine, run: () => app.openNew() },
    ...(canRecord() ? [{ id: 'record', label: 'Gravar áudio', Icon: Mic, run: () => app.openNew(undefined, { record: true }) }] : []),
    { id: 'photo', label: 'Foto', Icon: Image, run: () => pick(photoInput) },
    ...(camera ? [{ id: 'camera', label: 'Câmera', Icon: Camera, run: () => app.openNew(undefined, { camera: true }) }] : []),
    { id: 'file', label: 'Anexo', Icon: Paperclip, run: () => pick(fileInput) },
  ])

  function pick(input: HTMLInputElement | undefined) {
    if (!input) return
    input.value = ''
    input.click()
  }
  const withFiles = (e: Event & { currentTarget: HTMLInputElement }) => {
    const files = [...(e.currentTarget.files ?? [])]
    if (files.length) app.openNew(undefined, { files })
  }
</script>

<svelte:window
  onpointerdown={(e) => open && !root?.contains(e.target as Node) && (open = false)}
  onkeydown={(e) => open && e.key === 'Escape' && (open = false)}
/>

<div class="fab-wrap" class:open bind:this={root}>
  {#if open}
    <div class="fab-scrim" aria-hidden="true"></div>
    <ul class="fab-items" role="menu" aria-label="Criar">
      {#each items as it, i (it.id)}
        <li style:--i={items.length - 1 - i}>
          <button role="menuitem" onclick={() => { open = false; it.run() }}>
            <span class="fab-label">{it.label}</span>
            <span class="fab-mini"><it.Icon size={19} /></span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  <button class="fab" onclick={() => (open = !open)} aria-label={open ? 'Fechar' : 'Criar'} aria-expanded={open} aria-haspopup="menu" title="Criar (Ctrl+N: nota)">
    <Plus size={26} strokeWidth={2.2} />
  </button>
  <input bind:this={photoInput} type="file" accept="image/*" multiple hidden onchange={withFiles} />
  <input bind:this={fileInput} type="file" multiple hidden onchange={withFiles} />
</div>
