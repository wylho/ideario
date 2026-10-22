<script lang="ts">
  import { t, tn } from '@wylho/atrio'
  import { Archive, CheckCheck, ChevronLeft, ChevronRight, File as FileIcon, FileAudio, FileText, FileVideoCamera, Image, BrushCleaning } from '@lucide/svelte'
  import SortMenu from './SortMenu.svelte'
  import LayoutToggle from './LayoutToggle.svelte'
  import FilterGroup from './FilterGroup.svelte'
  import ConfirmDialog from './ConfirmDialog.svelte'
  import { api } from '../lib/api'
  import { app, live } from '../lib/app.svelte'
  import { dayKey, shift } from '../lib/calendar'
  import type { FileGroup, FileSort, NoteSort, Tone } from '../lib/types'

  // Menu dinâmico: as ações da visão atual, sempre no mesmo lugar e com os mesmos botões
  // (filtro da visão → ordenar → lista/grade). Nada disso fica no meio do conteúdo.
  const NOTE_SORTS: { id: NoteSort; label: string; hint?: string }[] = [
    { id: 'custom', get label() { return t('Personalizada') }, get hint() { return t('arraste os cards') } },
    { id: 'updated', get label() { return t('Última edição') } },
    { id: 'created', get label() { return t('Data de criação') } },
    { id: 'category', get label() { return t('Categoria') } },
    { id: 'title', get label() { return t('Título (A–Z)') } },
  ]
  const FILE_SORTS: { id: FileSort; label: string }[] = [
    { id: 'recent', get label() { return t('Mais recentes') } },
    { id: 'name', get label() { return t('Nome (A–Z)') } },
    { id: 'size', get label() { return t('Tamanho') } },
    { id: 'kind', get label() { return t('Tipo') } },
  ]
  // Os ícones são os mesmos da lista de arquivos; planilhas e afins entram em "Outros documentos".
  const KINDS: { id: FileGroup; label: string; icon: typeof FileIcon }[] = [
    { id: 'pdf', get label() { return t('PDFs') }, icon: FileText },
    { id: 'doc', get label() { return t('Outros documentos') }, icon: FileIcon },
    { id: 'image', get label() { return t('Imagens') }, icon: Image },
    { id: 'audio', get label() { return t('Áudio') }, icon: FileAudio },
    { id: 'video', get label() { return t('Vídeo') }, icon: FileVideoCamera },
  ]
  const TONES: { id: Tone; label: string; swatch: string }[] = [
    { id: 'quente', get label() { return t('Quentes') }, swatch: '#D98E4A' },
    { id: 'frio', get label() { return t('Frios') }, swatch: '#3D63D6' },
    { id: 'verde', get label() { return t('Verdes') }, swatch: '#4F8A60' },
    { id: 'rosa', get label() { return t('Rosas') }, swatch: '#E58FA6' },
    { id: 'neutro', get label() { return t('Neutros') }, swatch: '#A39E92' },
  ]

  // Lixeira: "Esvaziar" só aparece quando há o que esvaziar.
  const trashed = live(() => (app.box === 'trash' ? api.trashCount() : Promise.resolve(0)), 0)
  let confirmEmpty = $state(false)
  async function emptyTrash() {
    const n = await api.emptyTrash()
    app.say(tn(n, '{n} nota excluída para sempre', '{n} notas excluídas para sempre'))
  }
</script>

{#if app.view === 'notes'}
  {#if app.box === 'trash' && trashed.current > 0}
    <button class="icon-btn" aria-label={t('Esvaziar lixeira')} title={t('Esvaziar lixeira')} onclick={() => (confirmEmpty = true)}><BrushCleaning size={19} /></button>
    <span class="top-gap" aria-hidden="true"></span>
  {/if}
  <SortMenu heading={t('Ordenar notas')} options={NOTE_SORTS} value={app.sort} onchange={(v) => app.setSort(v)} />
  <LayoutToggle value={app.layout} onchange={(v) => (app.layout = v)} />
{:else if app.view === 'reminders'}
  <button
    class="icon-btn"
    class:on={app.showDone}
    aria-pressed={app.showDone}
    aria-label={t('Mostrar concluídos')}
    title={app.showDone ? t('Ocultar concluídos') : t('Mostrar concluídos')}
    onclick={() => (app.showDone = !app.showDone)}
  >
    <CheckCheck size={19} />
  </button>
{:else if app.view === 'calendar'}
  <button
    class="icon-btn"
    class:on={app.showDone}
    aria-pressed={app.showDone}
    aria-label={t('Mostrar concluídos')}
    title={app.showDone ? t('Ocultar concluídos') : t('Mostrar concluídos')}
    onclick={() => (app.showDone = !app.showDone)}
  >
    <CheckCheck size={19} />
  </button>
  <button class="chip cal-today" onclick={() => (app.calDay = dayKey(Date.now()))}>{t('Hoje')}</button>
  <button class="icon-btn" aria-label={app.calMode === 'month' ? t('Mês anterior') : t('Semana anterior')} title={app.calMode === 'month' ? t('Mês anterior') : t('Semana anterior')} onclick={() => (app.calDay = shift(app.calDay, app.calMode, -1))}><ChevronLeft size={19} /></button>
  <button class="icon-btn" aria-label={app.calMode === 'month' ? t('Próximo mês') : t('Próxima semana')} title={app.calMode === 'month' ? t('Próximo mês') : t('Próxima semana')} onclick={() => (app.calDay = shift(app.calDay, app.calMode, 1))}><ChevronRight size={19} /></button>
  <div class="cal-mode" role="radiogroup" aria-label={t('Mostrar')}>
    {#each [['month', 'Mês'], ['week', 'Semana']] as const as [m, label] (m)}
      <button role="radio" aria-checked={app.calMode === m} class:on={app.calMode === m} onclick={() => (app.calMode = m)}>{t(label)}</button>
    {/each}
  </div>
{:else if app.view === 'files'}
  <FilterGroup label={t('Tipo de arquivo')} all={t('Todos os tipos')} options={KINDS} value={app.filesKind} onchange={(v) => (app.filesKind = v)} />
  <SortMenu heading={t('Ordenar arquivos')} options={FILE_SORTS} value={app.filesSort} onchange={(v) => (app.filesSort = v)} />
  <LayoutToggle value={app.filesLayout} onchange={(v) => (app.filesLayout = v)} />
{:else if app.view === 'moodboard'}
  <FilterGroup label={t('Tom das imagens')} all={t('Todos os tons')} options={TONES} value={app.moodTone} onchange={(v) => (app.moodTone = v)} />
  <button
    class="icon-btn"
    class:on={app.moodArchived}
    aria-pressed={app.moodArchived}
    aria-label={t('Mostrar arquivados')}
    title={app.moodArchived ? t('Ocultar fotos das notas arquivadas') : t('Mostrar também as fotos das notas arquivadas')}
    onclick={() => (app.moodArchived = !app.moodArchived)}
  >
    <Archive size={19} />
  </button>
{/if}

<ConfirmDialog
  bind:open={confirmEmpty}
  title={t('Esvaziar a lixeira?')}
  text={tn(trashed.current, 'A nota da lixeira será excluída para sempre. Não dá para desfazer.', 'As {n} notas da lixeira serão excluídas para sempre. Não dá para desfazer.')}
  confirm={t('Esvaziar')}
  onconfirm={emptyTrash}
/>
