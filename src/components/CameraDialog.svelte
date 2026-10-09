<script lang="ts">
  import { Dialog } from 'bits-ui'
  import { Camera, X } from '@lucide/svelte'
  import { app } from '../lib/app.svelte'

  // Tira uma foto com a câmera do aparelho e entrega como arquivo (depois passa pelo pipeline como qualquer foto).
  let { open = $bindable(false), oncapture }: { open?: boolean; oncapture: (photo: Blob) => void } = $props()

  let video: HTMLVideoElement | undefined = $state()
  let stream: MediaStream | null = null
  let ready = $state(false)

  $effect(() => {
    if (!open || !video) return
    let stopped = false
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 } } })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop())
        stream = s
        video!.srcObject = s
        ready = true
      })
      .catch(() => {
        app.say('Sem acesso à câmera')
        open = false
      })
    return () => {
      stopped = true
      stream?.getTracks().forEach((t) => t.stop())
      stream = null
      ready = false
    }
  })

  function shoot() {
    if (!video || !ready) return
    const c = document.createElement('canvas')
    c.width = video.videoWidth
    c.height = video.videoHeight
    c.getContext('2d')!.drawImage(video, 0, 0)
    c.toBlob((b) => b && oncapture(b), 'image/jpeg', 0.92)
    open = false
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Portal>
    <Dialog.Overlay class="overlay dark" />
    <Dialog.Content class="camera" aria-describedby={undefined}>
      <div class="lb-top">
        <Dialog.Close class="icon-btn on-dark" aria-label="Fechar"><X size={20} /></Dialog.Close>
        <Dialog.Title class="lb-title">Câmera</Dialog.Title>
      </div>
      <!-- svelte-ignore a11y_media_has_caption -->
      <video bind:this={video} autoplay playsinline muted></video>
      <div class="camera-actions">
        <button class="shutter" aria-label="Tirar foto" onclick={shoot} disabled={!ready}><Camera size={24} /></button>
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
