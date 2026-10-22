<script lang="ts">
  import { i18n, LOCALES, setLocale, t, tn, type LocalePref } from '@wylho/atrio'
  import { Dialog, Switch, ToggleGroup } from 'bits-ui'
  import { CloudAlert, CloudCheck, CloudOff, Copy, Monitor, Moon, Sun, X } from '@lucide/svelte'
  import { untrack } from 'svelte'
  import { api, coreVersion } from '../lib/api'
  import { app } from '../lib/app.svelte'
  import { ago, fmtBytes } from '../lib/format'
  import { paletteColors, theme, type ThemePref } from '../lib/theme.svelte'
  import { background } from '../lib/background.svelte'
  import { updates } from '../lib/updates.svelte'
  import { pickKeepTakeout } from '../lib/keep.svelte'
  import { backupNow, pickBackupDir, restoreBackup } from '../lib/backup.svelte'
  import { isTauri } from '@tauri-apps/api/core'
  import { DESKTOPS, PALETTES, type DesktopId, type PaletteId } from '../lib/palettes'
  import { Picker } from '@wylho/atrio'
  import type { BackupStatus, McpInfo, PhotoQuality, Settings, SyncStatus } from '../lib/types'

  let settings = $state<Settings | null>(null)
  let status = $state.raw<SyncStatus | null>(null)
  let version = $state<string | null>(null)
  coreVersion().then((v) => (version = v))
  // No celular quem atualiza é a loja (ou o APK novo): sem "Procurar atualizações".
  const android = document.documentElement.dataset.platform === 'android'
  const desktop = !android && !/Android|iPhone|iPad/i.test(navigator.userAgent)
  async function checkNow() {
    if (!(await updates.check())) app.say(t('Você já tem a versão mais recente.'))
  }

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

  // ---------- backup local ----------
  let backup = $state.raw<BackupStatus | null>(null)
  $effect(() => {
    void app.revision
    if (app.settingsOpen && isTauri()) untrack(() => api.backupStatus().then((b) => (backup = b)).catch(() => (backup = null)))
  })
  async function setAutoBackup(on: boolean) {
    backup = await api.backupSetAuto(on, null)
    if (on) app.say(t('Backup automático ligado: o primeiro sai agora, depois um por semana'))
  }
  async function changeBackupDir() {
    const dir = await pickBackupDir()
    if (dir) backup = await api.backupSetAuto(backup?.auto ?? true, dir)
  }
  const backupLine = $derived.by(() => {
    if (!backup?.auto) return t('Uma cópia de tudo por semana numa pasta deste computador (ou de um HD externo), guardando as 4 últimas.')
    const last = backup.last ? t('último {quando}', { quando: ago(backup.last) }) : t('o primeiro sai em instantes')
    return t('Guarda os 4 últimos · {ultimo}', { ultimo: last })
  })

  // ---------- Claude (MCP) ----------
  let mcp = $state.raw<McpInfo | null>(null)
  $effect(() => {
    if (app.settingsOpen) untrack(() => api.mcpInfo().then((m) => (mcp = m)).catch(() => (mcp = null)))
  })
  async function mcpToggle() {
    if (!mcp) return
    const on = !mcp.desktopInstalled
    try {
      mcp = await (on ? api.mcpInstall() : api.mcpUninstall())
      app.say(on ? t('Ligado no Claude Desktop. Se ele estiver aberto, feche e abra de novo.') : t('Desligado do Claude Desktop.'))
    } catch (e) {
      app.say(t('Não foi possível: {erro}', { erro: e instanceof Error ? e.message : String(e) }))
    }
  }
  async function copyCommand() {
    if (!mcp) return
    try {
      await navigator.clipboard.writeText(mcp.claudeCode)
      app.say(t('Comando copiado. Cole no terminal.'))
    } catch {
      app.say(mcp.claudeCode)
    }
  }

  // ---------- Google Drive ----------
  let signingIn = $state(false)
  async function signIn() {
    signingIn = true
    try {
      status = await api.syncSignIn()
      app.say(t('Conectado ao Google Drive'))
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e)
      if (!msg.includes('cancelado')) app.say(t('Não foi possível entrar: {erro}', { erro: msg }))
    } finally {
      signingIn = false
    }
  }
  function signOut() {
    app.confirm({
      title: t('Sair da conta Google?'),
      text: t('As notas continuam neste aparelho, mas param de sincronizar. Para voltar, é só entrar de novo.'),
      confirm: t('Sair'),
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
    if (app.sync === 'syncing') return t('Sincronizando…')
    if (app.sync === 'offline') return t('Sem conexão. As alterações sobem quando voltar.')
    const pending = s.pending > 0 ? ` · ${tn(s.pending, '{n} nota a enviar', '{n} notas a enviar')}` : ''
    return `${s.lastSyncAt ? t('Sincronizado {quando}', { quando: ago(s.lastSyncAt) }) : t('Ainda não sincronizou')} · ${tn(s.noteCount, '{n} nota', '{n} notas')}${pending}`
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
        return { title: t('Continuar aberto na barra de menus'), hint: t('O Ideario fica no alto da tela, na barra de menus, e volta na hora quando você precisar.') }
      case 'windows':
        return { title: t('Continuar aberto na bandeja'), hint: t('O Ideario fica na bandeja do sistema, perto do relógio, e volta na hora quando você precisar.') }
      case 'kde':
        return { title: t('Continuar aberto na bandeja'), hint: t('O Ideario fica na bandeja do sistema e volta na hora quando você precisar.') }
      default:
        return {
          title: t('Continuar aberto em segundo plano'),
          hint: t('O Ideario fica na área de notificação e volta na hora. No GNOME, o ícone aparece com a extensão AppIndicator (já vem no Ubuntu).'),
        }
    }
  })

  // Sistema primeiro: é o padrão e faz o app parecer nativo.
  // Os nomes das paletas vêm do Atrio (traduzidos lá); "Sistema" é daqui.
  const THEMES = $derived<{ id: PaletteId; label: string; hint: string }[]>([
    { id: 'system', label: t('Sistema'), hint: '' },
    ...Object.entries(PALETTES).map(([id, p]) => ({ id: id as PaletteId, label: p.label, hint: p.hint })),
  ])
  const systemName = $derived(t('Cores do {sistema}', { sistema: DESKTOPS[theme.system.desktop ?? 'gnome'].label }))
  // Idioma: "Automático" segue o do sistema (português para pt-*, inglês para o resto). Fica no aparelho.
  const LANGS = $derived(LOCALES.map((l) => [l.id, t(l.label)]) as [LocalePref, string][])

  const usedBytes = $derived(status?.cacheUsedBytes ?? 0)
</script>

<Dialog.Root bind:open={app.settingsOpen}>
  <Dialog.Portal>
    <Dialog.Overlay class="overlay" />
    <Dialog.Content class="sheet" aria-describedby={undefined}>
      <div class="sheet-head">
        <Dialog.Title class="sheet-title">{t('Configurações')}</Dialog.Title>
        <Dialog.Close class="icon-btn" aria-label={t('Fechar')}><X size={20} /></Dialog.Close>
      </div>
      {#if settings}
        <div class="sheet-scroll">
          <section class="set-group">
            <h3>{t('Aparência')}</h3>
            <div class="theme-grid" role="radiogroup" aria-label={t('Tema')}>
              {#each THEMES as th (th.id)}
                {@const c = paletteColors(th.id, theme.mode, theme.system)}
                <button
                  class="theme-tile"
                  role="radio"
                  aria-checked={theme.palette === th.id}
                  onclick={() => theme.setPalette(th.id)}
                >
                  <span class="theme-swatch" style:background={c.bg} aria-hidden="true">
                    <span class="theme-card" style:background={c.surface} style:border-color={c.line}>
                      <i style:background={c.fg}></i><i style:background={c.muted}></i>
                    </span>
                    <span class="theme-dots">
                      <i style:background={c.accent}></i>{#each c.notes.slice(0, 3) as n (n)}<i style:background={n}></i>{/each}
                    </span>
                  </span>
                  <span class="theme-name">{th.label}</span>
                  <small>{th.id === 'system' ? systemName : th.hint}</small>
                </button>
              {/each}
            </div>
            {#if theme.palette === 'system' && !theme.native}
              <div class="set-row">
                <span><b>{t('Prévia do sistema')}</b><small>{t('Só no navegador. No app, as cores vêm da área de trabalho.')}</small></span>
                <Picker
                  id="sistema"
                  bind:value={() => theme.simDesktop, (v) => theme.setSimDesktop(v)}
                  options={Object.entries(DESKTOPS).map(([id, d]) => [id, d.label]) as [DesktopId, string][]}
                />
              </div>
            {/if}
            <div class="set-row">
              <span><b>{t('Claro ou escuro')}</b></span>
              <ToggleGroup.Root
                type="single"
                value={theme.pref}
                onValueChange={(v) => v && theme.set(v as ThemePref)}
                class="seg tight"
                aria-label={t('Claro ou escuro')}
              >
                <ToggleGroup.Item value="light" class="seg-item"><Sun size={15} />{t('Claro')}</ToggleGroup.Item>
                <ToggleGroup.Item value="dark" class="seg-item"><Moon size={15} />{t('Escuro')}</ToggleGroup.Item>
                <ToggleGroup.Item value="system" class="seg-item"><Monitor size={15} />{t('Automático')}</ToggleGroup.Item>
              </ToggleGroup.Root>
            </div>
            <div class="set-row">
              <span><b>{t('Idioma')}</b><small>{t('Automático segue o idioma do sistema.')}</small></span>
              <Picker id="idioma" bind:value={() => i18n.pref, (v) => setLocale(v)} options={LANGS} />
            </div>
          </section>

          {#if !android}
          <section class="set-group">
            <h3>{t('Ao fechar a janela')}</h3>
            <label class="set-row" for="segundo-plano">
              <span><b>{keepOpen.title}</b><small>{keepOpen.hint}</small></span>
              <Switch.Root id="segundo-plano" class="switch" checked={background.enabled} onCheckedChange={(v) => background.set(v)}><Switch.Thumb class="thumb" /></Switch.Root>
            </label>
          </section>
          {/if}

          <section class="set-group">
            <h3>Google Drive</h3>
            {#if status && !status.configured}
              <div class="sync-card off">
                <CloudOff size={22} />
                <div>
                  <b>{t('Só neste aparelho')}</b>
                  <span>{t('Esta versão do app não tem a sincronização com o Google Drive ligada.')}</span>
                </div>
              </div>
            {:else if status?.connected}
              <div class="sync-card" class:bad={status.state === 'error'}>
                {#if status.state === 'error'}<CloudAlert size={22} />{:else}<CloudCheck size={22} />{/if}
                <div>
                  <b>{status.account}</b>
                  <span>{syncLine(status)}</span>
                </div>
                <button class="btn ghost sm" disabled={app.sync === 'syncing'} onclick={syncNow}>{t('Sincronizar agora')}</button>
              </div>
              <div class="set-row">
                <span><b>Google Drive</b><small>{t('As notas ficam numa pasta oculta do app no seu Drive: só o Ideario lê e escreve nela.')}</small></span>
                <button class="btn ghost" onclick={signOut}>{t('Sair')}</button>
              </div>
            {:else if status?.account}
              <!-- o Google não aceita mais o login (revogado, senha trocada…): a conta e o que já sincronizou ficam -->
              <div class="sync-card bad">
                <CloudAlert size={22} />
                <div>
                  <b>{status.account}</b>
                  <span>{signingIn ? t('Continue no navegador. Volte aqui depois de permitir.') : t('O login do Google expirou. Entre de novo para voltar a sincronizar.')}</span>
                </div>
                {#if signingIn}
                  <button class="btn ghost sm" onclick={() => api.syncCancelSignIn()}>{t('Cancelar')}</button>
                {:else}
                  <button class="btn primary sm" onclick={signIn}>{t('Entrar de novo')}</button>
                {/if}
              </div>
            {:else if status}
              <div class="sync-card off">
                <CloudOff size={22} />
                <div>
                  <b>{t('Só neste aparelho')}</b>
                  <span>{signingIn ? t('Continue no navegador. Volte aqui depois de permitir.') : t('Entre com a sua conta Google para ver as mesmas notas em todos os aparelhos.')}</span>
                </div>
                {#if signingIn}
                  <button class="btn ghost sm" onclick={() => api.syncCancelSignIn()}>{t('Cancelar')}</button>
                {:else}
                  <button class="btn primary sm" onclick={signIn}>{t('Entrar com Google')}</button>
                {/if}
              </div>
            {/if}
          </section>

          {#if mcp && !android}
            <section class="set-group">
              <h3>Claude</h3>
              <div class="set-row">
                <span>
                  <b>Claude Desktop</b>
                  <small>{mcp.desktopInstalled
                    ? t('Ligado: no Claude, peça para buscar, criar e organizar suas notas, checklists e lembretes. Tudo continua no seu computador.')
                    : mcp.desktopFound
                      ? t('Deixa o Claude ler, criar e organizar suas notas, checklists, lembretes e anexos. Tudo continua no seu computador.')
                      : t('O Claude Desktop não foi encontrado neste computador. Dá para ligar mesmo assim (vale quando ele for instalado).')}</small>
                </span>
                <button class="btn {mcp.desktopInstalled ? 'ghost' : 'primary'}" onclick={mcpToggle}>{mcp.desktopInstalled ? t('Desligar') : t('Ligar')}</button>
              </div>
              <div class="set-row mcp-code">
                <span>
                  <b>Claude Code</b>
                  <small>{t('Rode uma vez no terminal:')}</small>
                  <code>{mcp.claudeCode}</code>
                </span>
                <button class="icon-btn" aria-label={t('Copiar comando')} title={t('Copiar')} onclick={copyCommand}><Copy size={18} /></button>
              </div>
            </section>
          {/if}

          <!-- No Android: escolher pasta e abrir arquivo pelo caminho ainda não funcionam (o sync já guarda tudo). -->
          {#if isTauri() && !android}
            <section class="set-group">
              <h3>{t('Backup local')}</h3>
              <div class="set-row">
                <span><b>{t('Fazer backup agora')}</b><small>{t('Um arquivo .ideario com as notas, categorias e anexos, e uma cópia em Markdown para ler sem o app.')}</small></span>
                <button class="btn ghost" onclick={() => { app.settingsOpen = false; void backupNow() }}>{t('Fazer backup…')}</button>
              </div>
              <div class="set-row">
                <span><b>{t('Restaurar')}</b><small>{t('Junta o backup com o que está aqui: nada é apagado, e o que você escreveu depois continua.')}</small></span>
                <button class="btn ghost" onclick={() => { app.settingsOpen = false; void restoreBackup() }}>{t('Restaurar…')}</button>
              </div>
              {#if backup}
                <label class="set-row" for="backup-auto">
                  <span><b>{t('Backup automático toda semana')}</b><small>{backupLine}</small></span>
                  <Switch.Root id="backup-auto" class="switch" checked={backup.auto} onCheckedChange={(v) => void setAutoBackup(v)}><Switch.Thumb class="thumb" /></Switch.Root>
                </label>
                {#if backup.auto}
                  <div class="set-row">
                    <span><b>{t('Pasta dos backups')}</b><small>{backup.dir}</small></span>
                    <button class="btn ghost" onclick={() => void changeBackupDir()}>{t('Mudar…')}</button>
                  </div>
                {/if}
              {/if}
            </section>

            <section class="set-group">
              <h3>{t('Importar')}</h3>
              <div class="set-row">
                <span><b>Google Keep</b><small>{t('Escolha o zip do Google Takeout. Categorias, cores, checklists e fotos vêm junto; importar de novo não repete notas.')}</small></span>
                <button class="btn ghost" onclick={() => { app.settingsOpen = false; void pickKeepTakeout() }}>{t('Importar…')}</button>
              </div>
            </section>
          {/if}

          <section class="set-group">
            <h3>{t('Fotos')}</h3>
            <div class="set-row">
              <span><b>{t('Qualidade')}</b><small>{settings.photoQuality === 'original'
                ? t('As fotos ficam exatamente como vieram, sem redimensionar nem comprimir, inclusive com a localização (GPS). Ocupam bem mais espaço no Drive.')
                : t('Aplicada ao importar.')} {t('Só fotos são comprimidas: PDFs, documentos, áudio e vídeo ficam exatamente como foram anexados.')}</small></span>
              <Picker
                id="qualidade"
                bind:value={settings.photoQuality}
                options={[['economy', t('Econômica · 1280px')], ['balanced', t('Equilibrada · 2048px')], ['high', t('Alta · 3072px')], ['original', t('Original · sem compressão')]] as [PhotoQuality, string][]}
              />
            </div>
          </section>

          <section class="set-group">
            <h3>{t('Neste aparelho')}</h3>
            <div class="cache">
              <p><b>{fmtBytes(usedBytes)}</b> {t('em fotos e anexos')}</p>
              <small>{t('Texto e miniaturas ficam sempre aqui. Fotos e anexos grandes que vêm de outros aparelhos descem quando você abre.')}</small>
            </div>
          </section>
          <p class="footnote">
            {isTauri() ? `Ideario${version ? ` v${version}` : ''}` : t('Prévia no navegador · dados de exemplo')}
            {#if updates.info}
              · <button class="link" onclick={() => updates.install()} disabled={updates.phase === 'downloading'}>
                {updates.phase === 'downloading' ? t('Atualizando…') : t('Atualizar para a v{versao}', { versao: updates.info.version })}
              </button>
            {:else if isTauri() && desktop}
              · <button class="link" onclick={checkNow} disabled={updates.phase === 'checking'}>
                {updates.phase === 'checking' ? t('Procurando…') : t('Procurar atualizações')}
              </button>
            {/if}
          </p>
        </div>
      {/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
