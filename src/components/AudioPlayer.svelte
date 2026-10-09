<script lang="ts">
  import { Pause, Play } from '@lucide/svelte'

  // Player compacto, igual em todos os sistemas (o <audio controls> nativo muda muito de um para outro).
  let { src, label }: { src: string; label: string } = $props()

  let audio: HTMLAudioElement | undefined = $state()
  let playing = $state(false)
  let time = $state(0)
  let duration = $state(0)

  const fmt = (s: number) => {
    if (!Number.isFinite(s)) return '0:00'
    const m = Math.floor(s / 60)
    return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  }
  const toggle = () => (audio?.paused ? audio.play() : audio?.pause())
</script>

<div class="player">
  <button class="player-btn" onclick={toggle} aria-label={playing ? `Pausar ${label}` : `Tocar ${label}`} disabled={!src}>
    {#if playing}<Pause size={16} fill="currentColor" />{:else}<Play size={16} fill="currentColor" />{/if}
  </button>
  <input
    class="player-bar"
    type="range"
    min="0"
    max={duration || 0}
    step="0.01"
    value={time}
    style:--p="{duration ? (time / duration) * 100 : 0}%"
    aria-label="Posição em {label}"
    oninput={(e) => audio && (audio.currentTime = Number(e.currentTarget.value))}
    disabled={!src}
  />
  <span class="player-time">{fmt(time)} / {fmt(duration)}</span>
  <audio
    bind:this={audio}
    {src}
    preload="metadata"
    onplay={() => (playing = true)}
    onpause={() => (playing = false)}
    onended={() => (playing = false)}
    ontimeupdate={(e) => (time = e.currentTarget.currentTime)}
    onloadedmetadata={(e) => (duration = e.currentTarget.duration)}
    ondurationchange={(e) => (duration = e.currentTarget.duration)}
  ></audio>
</div>
