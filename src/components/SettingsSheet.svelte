<script lang="ts">
  import { Dialog, Slider, Switch, ToggleGroup } from 'bits-ui'
  import { CloudCheck, Monitor, Moon, StickyNote, Sun, X } from '@lucide/svelte'
  import { api, coreVersion } from '../lib/api'
  import { app } from '../lib/app.svelte'
  import { ago } from '../lib/format'
  import { theme, type ThemePref } from '../lib/theme.svelte'
  import Picker from './Picker.svelte'
  import type { PhotoQuality, Settings, SyncStatus } from '../lib/types'

  let settings = $state<Settings | null>(null)
  let status = $state.raw<SyncStatus | null>(null)
  let version = $state<string | null>(null)
  coreVersion().then((v) => (version = v))

  $effect(() => {
    if (!app.settingsOpen) return
    api.getSettings().then((s) => (settings = s))
    api.syncStatus().then((s) => (status = s))
  })

  // Grava a cada mudança (não há botão "salvar").
  let runs = 0
  $effect(() => {
    if (!settings) return
    const snap = $state.snapshot(settings)
    if (runs++ > 0) void api.saveSettings(snap)
  })

  const usedBytes = $derived(status?.cacheUsedBytes ?? 0)
  const gb = (n: number) => n.toString().replace('.', ',')
</script>

<Dialog.Root bind:open={app.settingsOpen}>
  <Dialog.Portal>
    <Dialog.Overlay class="overlay" />
    <Dialog.Content class="sheet" aria-describedby={undefined}>
      <div class="sheet-head">
        <Dialog.Title class="sheet-title">Configurações</Dialog.Title>
        <Dialog.Close class="icon-btn" aria-label="Fechar"><X size={20} /></Dialog.Close>
      </div>
      {#if settings}
        <div class="sheet-scroll">
          <section class="set-group">
            <h3>Aparência</h3>
            <div class="set-row">
              <span><b>Tema</b></span>
              <ToggleGroup.Root
                type="single"
                value={theme.pref}
                onValueChange={(v) => v && theme.set(v as ThemePref)}
                class="seg tight"
                aria-label="Tema"
              >
                <ToggleGroup.Item value="light" class="seg-item"><Sun size={15} />Claro</ToggleGroup.Item>
                <ToggleGroup.Item value="dark" class="seg-item"><Moon size={15} />Escuro</ToggleGroup.Item>
                <ToggleGroup.Item value="system" class="seg-item"><Monitor size={15} />Sistema</ToggleGroup.Item>
              </ToggleGroup.Root>
            </div>
          </section>

          <section class="set-group">
            <h3>Sincronização</h3>
            <div class="sync-card">
              <CloudCheck size={22} />
              <div>
                <b>{status?.connected ? 'Google Drive conectado' : 'Google Drive desconectado'}</b>
                {#if status}
                  <span>Última sincronização {status.lastSyncAt ? ago(status.lastSyncAt) : 'nunca'} · {status.noteCount} notas</span>
                {/if}
              </div>
              <button class="btn ghost sm" onclick={() => app.say('Sincronizando…')}>Agora</button>
            </div>
            <label class="set-row" for="so-wifi">
              <span><b>Sincronizar só no Wi-Fi</b><small>Anexos grandes esperam o Wi-Fi. Texto sincroniza sempre.</small></span>
              <Switch.Root id="so-wifi" class="switch" bind:checked={settings.wifiOnly}><Switch.Thumb class="thumb" /></Switch.Root>
            </label>
          </section>

          <section class="set-group">
            <h3>Fotos</h3>
            <div class="set-row">
              <span><b>Qualidade</b><small>{settings.photoQuality === 'original'
                ? 'As fotos ficam como vieram, sem redimensionar nem comprimir. Ocupam bem mais espaço no Drive.'
                : 'Aplicada ao importar.'} Só fotos são comprimidas: PDFs, documentos, áudio e vídeo ficam exatamente como foram anexados.</small></span>
              <Picker
                id="qualidade"
                bind:value={settings.photoQuality}
                options={[['economy', 'Econômica · 1280px'], ['balanced', 'Equilibrada · 2048px'], ['high', 'Alta · 3072px'], ['original', 'Original · sem compressão']] as [PhotoQuality, string][]}
              />
            </div>
            <!-- Com a qualidade Original não há versão otimizada, então guardar o original à parte não faz sentido. -->
            {#if settings.photoQuality !== 'original'}
              <label class="set-row" for="originais">
                <span><b>Manter originais</b><small>Guarda a foto sem compressão no Drive, além da versão otimizada.</small></span>
                <Switch.Root id="originais" class="switch" bind:checked={settings.keepOriginals}><Switch.Thumb class="thumb" /></Switch.Root>
              </label>
            {/if}
          </section>

          <section class="set-group">
            <h3>Cache neste aparelho</h3>
            <div class="cache">
              <div class="cache-bar"><i style:width="{Math.min(100, (usedBytes / 1024 ** 3 / settings.cacheLimitGb) * 100)}%"></i></div>
              <p><b>{Math.round(usedBytes / 1024 ** 2)} MB</b> usados de {gb(settings.cacheLimitGb)} GB</p>
              <Slider.Root type="single" class="slider" min={0.5} max={5} step={0.5} bind:value={settings.cacheLimitGb} aria-label="Limite do cache">
                <span class="track"><Slider.Range class="range" /></span>
                <Slider.Thumb index={0} class="s-thumb" aria-label="Limite do cache" />
              </Slider.Root>
              <small>Texto e miniaturas ficam sempre aqui. Anexos pouco usados saem primeiro quando o limite enche.</small>
            </div>
          </section>

          <section class="set-group">
            <h3>Importar</h3>
            <button class="import" onclick={() => app.say('Escolha o .zip do Google Takeout')}>
              <span class="import-ico"><StickyNote size={20} /></span>
              <span><b>Trazer notas do Google Keep</b><small>Marcadores viram categorias. Fotos são otimizadas no caminho.</small></span>
            </button>
          </section>
          <p class="footnote">Fase 0 · dados de exemplo{version ? ` · núcleo v${version}` : ''}</p>
        </div>
      {/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
