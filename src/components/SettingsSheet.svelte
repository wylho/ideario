<script lang="ts">
  import { Dialog, Slider, Switch, ToggleGroup } from 'bits-ui'
  import { CloudCheck, Monitor, Moon, StickyNote, Sun, X } from '@lucide/svelte'
  import { api, coreVersion } from '../lib/api'
  import { app } from '../lib/app.svelte'
  import { ago } from '../lib/format'
  import { paletteColors, theme, type ThemePref } from '../lib/theme.svelte'
  import { background } from '../lib/background.svelte'
  import { pickKeepTakeout } from '../lib/keep.svelte'
  import { isTauri } from '@tauri-apps/api/core'
  import { DESKTOPS, PALETTES, type DesktopId, type PaletteId } from '../lib/palettes'
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

  // Segundo plano: o mesmo recurso, com o nome que cada sistema usa para o lugar do ícone.
  const keepOpen = $derived.by(() => {
    switch (theme.system.desktop) {
      case 'macos':
        return { title: 'Continuar aberto na barra de menus', hint: 'O Ideario fica no alto da tela, na barra de menus, e volta na hora quando você precisar.' }
      case 'windows':
        return { title: 'Continuar aberto na bandeja', hint: 'O Ideario fica na bandeja do sistema, perto do relógio, e volta na hora quando você precisar.' }
      case 'kde':
        return { title: 'Continuar aberto na bandeja', hint: 'O Ideario fica na bandeja do sistema e volta na hora quando você precisar.' }
      default:
        return {
          title: 'Continuar aberto em segundo plano',
          hint: 'O Ideario fica na área de notificação e volta na hora. No GNOME, o ícone aparece com a extensão AppIndicator (já vem no Ubuntu).',
        }
    }
  })

  // Sistema primeiro: é o padrão e faz o app parecer nativo.
  const THEMES: { id: PaletteId; label: string; hint: string }[] = [
    { id: 'system', label: 'Sistema', hint: '' },
    ...Object.entries(PALETTES).map(([id, p]) => ({ id: id as PaletteId, label: p.label, hint: p.hint })),
  ]
  const systemName = $derived(`Cores do ${DESKTOPS[theme.system.desktop ?? 'gnome'].label}`)

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
            <div class="theme-grid" role="radiogroup" aria-label="Tema">
              {#each THEMES as t (t.id)}
                {@const c = paletteColors(t.id, theme.mode, theme.system)}
                <button
                  class="theme-tile"
                  role="radio"
                  aria-checked={theme.palette === t.id}
                  onclick={() => theme.setPalette(t.id)}
                >
                  <span class="theme-swatch" style:background={c.bg} aria-hidden="true">
                    <span class="theme-card" style:background={c.surface} style:border-color={c.line}>
                      <i style:background={c.fg}></i><i style:background={c.muted}></i>
                    </span>
                    <span class="theme-dots">
                      <i style:background={c.accent}></i>{#each c.notes.slice(0, 3) as n (n)}<i style:background={n}></i>{/each}
                    </span>
                  </span>
                  <span class="theme-name">{t.label}</span>
                  <small>{t.id === 'system' ? systemName : t.hint}</small>
                </button>
              {/each}
            </div>
            {#if theme.palette === 'system' && !theme.native}
              <div class="set-row">
                <span><b>Prévia do sistema</b><small>Só no navegador. No app, as cores vêm da área de trabalho.</small></span>
                <Picker
                  id="sistema"
                  bind:value={() => theme.simDesktop, (v) => theme.setSimDesktop(v)}
                  options={Object.entries(DESKTOPS).map(([id, d]) => [id, d.label]) as [DesktopId, string][]}
                />
              </div>
            {/if}
            <div class="set-row">
              <span><b>Claro ou escuro</b></span>
              <ToggleGroup.Root
                type="single"
                value={theme.pref}
                onValueChange={(v) => v && theme.set(v as ThemePref)}
                class="seg tight"
                aria-label="Claro ou escuro"
              >
                <ToggleGroup.Item value="light" class="seg-item"><Sun size={15} />Claro</ToggleGroup.Item>
                <ToggleGroup.Item value="dark" class="seg-item"><Moon size={15} />Escuro</ToggleGroup.Item>
                <ToggleGroup.Item value="system" class="seg-item"><Monitor size={15} />Automático</ToggleGroup.Item>
              </ToggleGroup.Root>
            </div>
          </section>

          <section class="set-group">
            <h3>Ao fechar a janela</h3>
            <label class="set-row" for="segundo-plano">
              <span><b>{keepOpen.title}</b><small>{keepOpen.hint}</small></span>
              <Switch.Root id="segundo-plano" class="switch" checked={background.enabled} onCheckedChange={(v) => background.set(v)}><Switch.Thumb class="thumb" /></Switch.Root>
            </label>
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

          {#if isTauri()}
            <section class="set-group">
              <h3>Importar</h3>
              <div class="set-row">
                <span><b>Google Keep</b><small>Escolha o zip do Google Takeout. Categorias, cores, checklists e fotos vêm junto; importar de novo não repete notas.</small></span>
                <button class="btn ghost" onclick={() => { app.settingsOpen = false; void pickKeepTakeout() }}>Importar…</button>
              </div>
            </section>
          {/if}

          <section class="set-group">
            <h3>Fotos</h3>
            <div class="set-row">
              <span><b>Qualidade</b><small>{settings.photoQuality === 'original'
                ? 'As fotos ficam exatamente como vieram, sem redimensionar nem comprimir, inclusive com a localização (GPS). Ocupam bem mais espaço no Drive.'
                : 'Aplicada ao importar.'} Só fotos são comprimidas: PDFs, documentos, áudio e vídeo ficam exatamente como foram anexados.</small></span>
              <Picker
                id="qualidade"
                bind:value={settings.photoQuality}
                options={[['economy', 'Econômica · 1280px'], ['balanced', 'Equilibrada · 2048px'], ['high', 'Alta · 3072px'], ['original', 'Original · sem compressão']] as [PhotoQuality, string][]}
              />
            </div>
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
