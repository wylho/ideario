<script lang="ts">
  import { CheckCheck, File as FileIcon, FileAudio, FileText, FileVideoCamera, Image, BrushCleaning } from '@lucide/svelte'
  import SortMenu from './SortMenu.svelte'
  import LayoutToggle from './LayoutToggle.svelte'
  import FilterGroup from './FilterGroup.svelte'
  import ConfirmDialog from './ConfirmDialog.svelte'
  import { api } from '../lib/api'
  import { app, live } from '../lib/app.svelte'
  import type { FileGroup, FileSort, NoteSort, Tone } from '../lib/types'

  // Menu dinâmico: as ações da visão atual, sempre no mesmo lugar e com os mesmos botões
  // (filtro da visão → ordenar → lista/grade). Nada disso fica no meio do conteúdo.
  const NOTE_SORTS: { id: NoteSort; label: string; hint?: string }[] = [
    { id: 'custom', label: 'Personalizada', hint: 'arraste os cards' },
    { id: 'updated', label: 'Última edição' },
    { id: 'created', label: 'Data de criação' },
    { id: 'category', label: 'Categoria' },
    { id: 'title', label: 'Título (A–Z)' },
  ]
  const FILE_SORTS: { id: FileSort; label: string }[] = [
    { id: 'recent', label: 'Mais recentes' },
    { id: 'name', label: 'Nome (A–Z)' },
    { id: 'size', label: 'Tamanho' },
    { id: 'kind', label: 'Tipo' },
  ]
  // Os ícones são os mesmos da lista de arquivos; planilhas e afins entram em "Outros documentos".
  const KINDS: { id: FileGroup; label: string; icon: typeof FileIcon }[] = [
    { id: 'pdf', label: 'PDFs', icon: FileText },
    { id: 'doc', label: 'Outros documentos', icon: FileIcon },
    { id: 'image', label: 'Imagens', icon: Image },
    { id: 'audio', label: 'Áudio', icon: FileAudio },
    { id: 'video', label: 'Vídeo', icon: FileVideoCamera },
  ]
  const TONES: { id: Tone; label: string; swatch: string }[] = [
    { id: 'quente', label: 'Quentes', swatch: '#D98E4A' },
    { id: 'frio', label: 'Frios', swatch: '#3D63D6' },
    { id: 'verde', label: 'Verdes', swatch: '#4F8A60' },
    { id: 'rosa', label: 'Rosas', swatch: '#E58FA6' },
    { id: 'neutro', label: 'Neutros', swatch: '#A39E92' },
  ]

  // Lixeira: "Esvaziar" só aparece quando há o que esvaziar.
  const trashed = live(() => (app.box === 'trash' ? api.trashCount() : Promise.resolve(0)), 0)
  let confirmEmpty = $state(false)
  async function emptyTrash() {
    const n = await api.emptyTrash()
    app.say(n === 1 ? '1 nota excluída para sempre' : `${n} notas excluídas para sempre`)
  }
</script>

{#if app.view === 'notes'}
  {#if app.box === 'trash' && trashed.current > 0}
    <button class="icon-btn" aria-label="Esvaziar lixeira" title="Esvaziar lixeira" onclick={() => (confirmEmpty = true)}><BrushCleaning size={19} /></button>
    <span class="top-gap" aria-hidden="true"></span>
  {/if}
  <SortMenu heading="Ordenar notas" options={NOTE_SORTS} value={app.sort} onchange={(v) => app.setSort(v)} />
  <LayoutToggle value={app.layout} onchange={(v) => (app.layout = v)} />
{:else if app.view === 'reminders'}
  <button
    class="icon-btn"
    class:on={app.showDone}
    aria-pressed={app.showDone}
    aria-label="Mostrar concluídos"
    title={app.showDone ? 'Ocultar concluídos' : 'Mostrar concluídos'}
    onclick={() => (app.showDone = !app.showDone)}
  >
    <CheckCheck size={19} />
  </button>
{:else if app.view === 'files'}
  <FilterGroup label="Tipo de arquivo" all="Todos os tipos" options={KINDS} value={app.filesKind} onchange={(v) => (app.filesKind = v)} />
  <SortMenu heading="Ordenar arquivos" options={FILE_SORTS} value={app.filesSort} onchange={(v) => (app.filesSort = v)} />
  <LayoutToggle value={app.filesLayout} onchange={(v) => (app.filesLayout = v)} />
{:else}
  <FilterGroup label="Tom das imagens" all="Todos os tons" options={TONES} value={app.moodTone} onchange={(v) => (app.moodTone = v)} />
{/if}

<ConfirmDialog
  bind:open={confirmEmpty}
  title="Esvaziar a lixeira?"
  text={trashed.current === 1 ? 'A nota da lixeira será excluída para sempre. Não dá para desfazer.' : `As ${trashed.current} notas da lixeira serão excluídas para sempre. Não dá para desfazer.`}
  confirm="Esvaziar"
  onconfirm={emptyTrash}
/>
