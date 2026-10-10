<script lang="ts">
  import { Dialog, Switch, ToggleGroup } from 'bits-ui'
  import { CloudAlert, CloudCheck, CloudOff, Monitor, Moon, Sun, X } from '@lucide/svelte'
  import { untrack } from 'svelte'
  import { api, coreVersion } from '../lib/api'
  import { app } from '../lib/app.svelte'
  import { ago, fmtBytes } from '../lib/format'
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

  const loadStatus = () => api.syncStatus().then((s) => (status = s))
  // As configurações são lidas uma vez, ao abrir (reler a cada mudança no núcleo poderia trazer de volta um valor
  // antigo por cima do que acabou de ser escolhido).
  let fresh = false
  $effect(() => {
    if (!app.settingsOpen) return
    untrack(() =>
      api.getSettings().then((s) => {
        fresh = true
        settings = s
      }),
    )
  })
  // O estado do sync acompanha enquanto estão abertas (última vez, pendências, erro).
  $effect(() => {
    void app.sync
    void app.revision
    if (app.settingsOpen) void loadStatus()
  })

  // ---------- Google Drive ----------
  let signingIn = $state(false)
  async function signIn() {
    signingIn = true
    try {
      status = await api.syncSignIn()
      app.say('Conectado ao Google Drive')
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e)
      if (!msg.includes('cancelado')) app.say(`Não foi possível entrar: ${msg}`)
    } finally {
      signingIn = false
    }
  }
  function signOut() {
    app.confirm({
      title: 'Sair da conta Google?',
      text: 'As notas continuam neste aparelho, mas param de sincronizar. Para voltar, é só entrar de novo.',
      confirm: 'Sair',
      onconfirm: async () => {
        await api.syncSignOut()
        await loadStatus()
      },
    })
  }
  async function syncNow() {
    await api.syncNow()
  }
  function syncLine(s: SyncStatus) {
    if (s.state === 'error' && s.error) return s.error
    if (app.sync === 'syncing') return 'Sincronizando…'
    if (app.sync === 'offline') return 'Sem conexão. As alterações sobem quando voltar.'
    const pending = s.pending > 0 ? ` · ${s.pending === 1 ? '1 nota a enviar' : `${s.pending} notas a enviar`}` : ''
    return `${s.lastSyncAt ? `Sincronizado ${ago(s.lastSyncAt)}` : 'Ainda não sincronizou'} · ${s.noteCount} notas${pending}`
  }

  // Grava a cada mudança (não há botão "salvar"); o que acabou de ser lido não é mudança.
  $effect(() => {
    if (!settings) return
    const snap = $state.snapshot(settings)
    if (fresh) {
      fresh = false
      return
    }
    void api.saveSettings(snap)
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
            {#if status && !status.configured}
              <div class="sync-card off">
                <CloudOff size={22} />
                <div>
                  <b>Só neste aparelho</b>
                  <span>Esta versão do app não tem a sincronização com o Google Drive ligada.</span>
                </div>
              </div>
            {:else if status?.connected}
              <div class="sync-card" class:bad={status.state === 'error'}>
                {#if status.state === 'error'}<CloudAlert size={22} />{:else}<CloudCheck size={22} />{/if}
                <div>
                  <b>{status.account}</b>
                  <span>{syncLine(status)}</span>
                </div>
                <button class="btn ghost sm" disabled={app.sync === 'syncing'} onclick={syncNow}>Sincronizar agora</button>
              </div>
              <div class="set-row">
                <span><b>Google Drive</b><small>As notas ficam numa pasta oculta do app no seu Drive: só o Ideario lê e escreve nela.</small></span>
                <button class="btn ghost" onclick={signOut}>Sair</button>
              </div>
            {:else if status?.account}
              <!-- o Google não aceita mais o login (revogado, senha trocada…): a conta e o que já sincronizou ficam -->
              <div class="sync-card bad">
                <CloudAlert size={22} />
                <div>
                  <b>{status.account}</b>
                  <span>{signingIn ? 'Continue no navegador. Volte aqui depois de permitir.' : 'O login do Google expirou. Entre de novo para voltar a sincronizar.'}</span>
                </div>
                {#if signingIn}
                  <button class="btn ghost sm" onclick={() => api.syncCancelSignIn()}>Cancelar</button>
                {:else}
                  <button class="btn primary sm" onclick={signIn}>Entrar de novo</button>
                {/if}
              </div>
            {:else if status}
              <div class="sync-card off">
                <CloudOff size={22} />
                <div>
                  <b>Só neste aparelho</b>
                  <span>{signingIn ? 'Continue no navegador. Volte aqui depois de permitir.' : 'Entre com a sua conta Google para ver as mesmas notas em todos os aparelhos.'}</span>
                </div>
                {#if signingIn}
                  <button class="btn ghost sm" onclick={() => api.syncCancelSignIn()}>Cancelar</button>
                {:else}
                  <button class="btn primary sm" onclick={signIn}>Entrar com Google</button>
                {/if}
              </div>
            {/if}
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
            <h3>Neste aparelho</h3>
            <div class="cache">
              <p><b>{fmtBytes(usedBytes)}</b> em fotos e anexos</p>
              <small>Texto e miniaturas ficam sempre aqui. Fotos e anexos grandes que vêm de outros aparelhos descem quando você abre.</small>
            </div>
          </section>
          <p class="footnote">{isTauri() ? `Ideario${version ? ` v${version}` : ''}` : 'Prévia no navegador · dados de exemplo'}</p>
        </div>
      {/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
