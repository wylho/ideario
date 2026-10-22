<script lang="ts">
  // Puxar para baixo no topo da lista sincroniza (pedido do usuário: no celular, ter que ir às Configurações e tocar em
  // "Sincronizar agora" era ruim). Só com o dedo: mouse e trackpad não fazem nada aqui. Vale para todas as visões, que
  // rolam no mesmo `main.content`.
  import { RefreshCw } from '@lucide/svelte'
  import { t } from '@wylho/atrio'
  import { app } from '../lib/app.svelte'

  let { target }: { target: HTMLElement | undefined } = $props()

  /** Quanto precisa puxar (já com a resistência) para valer. */
  const THRESHOLD = 64
  const MAX = 110

  let pull = $state(0)
  let refreshing = $state(false)
  let settling = $state(false)

  $effect(() => {
    const el = target
    if (!el) return
    // Sem o "elástico" do sistema no topo: o puxão é nosso.
    el.style.overscrollBehaviorY = 'contain'
    let start: { x: number; y: number } | null = null
    let pulling = false

    const onStart = (e: TouchEvent) => {
      if (refreshing || e.touches.length !== 1 || el.scrollTop > 0) return (start = null)
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY }
      pulling = false
      settling = false
    }
    const onMove = (e: TouchEvent) => {
      if (!start || refreshing) return
      // Outro gesto já tomou conta (arrastar um card no quadro, por exemplo).
      if (e.defaultPrevented && !pulling) return (start = null)
      const dx = e.touches[0].clientX - start.x
      const dy = e.touches[0].clientY - start.y
      if (!pulling) {
        if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return
        // Só para baixo e mais na vertical que na horizontal; qualquer outra coisa é rolagem comum.
        if (dy <= 0 || Math.abs(dx) > dy || el.scrollTop > 0) return (start = null)
        pulling = true
      }
      e.preventDefault()
      pull = Math.min(MAX, Math.max(0, dy) * 0.5)
    }
    const onEnd = async () => {
      if (!start) return
      start = null
      if (!pulling) return
      pulling = false
      settling = true
      if (pull < THRESHOLD) return (pull = 0)
      pull = THRESHOLD
      refreshing = true
      try {
        await app.pullRefresh()
      } finally {
        refreshing = false
        pull = 0
      }
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onEnd)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  })

  const progress = $derived(Math.min(1, pull / THRESHOLD))
</script>

{#if pull > 0 || refreshing}
  <div
    class="pull"
    class:settling
    class:ready={progress >= 1}
    style:top="{target?.offsetTop ?? 0}px"
    style:transform="translate(-50%, {pull - 44}px)"
    style:opacity={refreshing ? 1 : Math.min(1, progress * 1.4)}
    role="status"
    aria-label={refreshing ? t('Sincronizando…') : t('Solte para sincronizar')}
  >
    <span class="pull-icon" class:spin={refreshing} style:transform={refreshing ? undefined : `rotate(${progress * 270}deg)`}>
      <RefreshCw size={18} strokeWidth={2.2} />
    </span>
  </div>
{/if}

<style>
  .pull {
    position: absolute; left: 50%; top: 0; z-index: 4; width: 40px; height: 40px; border-radius: 999px;
    display: grid; place-items: center; pointer-events: none;
    background: var(--surface); color: var(--muted); border: 1px solid var(--line); box-shadow: var(--float-shadow);
  }
  .pull.settling { transition: transform .2s ease, opacity .2s ease; }
  .pull.ready { color: var(--accent); }
  .pull-icon { display: grid; place-items: center; }
  .pull-icon.spin { animation: pull-spin .8s linear infinite; color: var(--accent); }
  @keyframes pull-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .pull-icon.spin { animation-duration: 2.4s; } .pull.settling { transition: none; } }
</style>
