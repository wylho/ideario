# Ideario — Especificação do projeto

> Documento de passagem. Reúne todas as decisões tomadas na fase de conceito e no protótipo de design.
> Leitor principal: Claude Code. Idioma do app e da UI: **português do Brasil**. Identificadores de código em inglês.
> Nome definitivo: "Ideario" (D4).

---

## 1. Visão

Um app de notas no estilo Google Keep, com duas metas simultâneas:

1. **Velocidade de bloco de notas.** Abrir e começar a digitar tem que ser imediato. O app nunca pode parecer um site carregando.
2. **Hub de ideias.** Notas, fotos, arquivos, lembretes, moodboards, categorias e tags num só lugar, com busca instantânea.

Usuário principal: o próprio autor (designer), uso pessoal em vários aparelhos. Não é um produto multiusuário e não tem servidor próprio.

### Princípios que decidem empates

- **Local-first.** O SQLite local é a fonte da verdade. A UI nunca espera a rede. O Google Drive é um espelho sincronizado em segundo plano.
- **Uma fonte de dados, várias visões.** Notas, Lembretes, Arquivos e Moodboard são consultas diferentes sobre o mesmo banco, nunca dados duplicados.
- **Design é requisito.** O protótipo (seção 9) é a referência visual. Fidelidade ao protótipo importa tanto quanto a funcionalidade.
- **Privacidade por padrão.** Remover EXIF e GPS das fotos e usar o escopo mínimo do Drive.

---

## 2. Stack decidida

| Camada | Escolha | Motivo |
|---|---|---|
| Shell multiplataforma | **Tauri 2** | Núcleo em Rust, UI web, roda em Windows, macOS, Linux, Android e iOS |
| Núcleo | **Rust** | Banco, sync, pipeline de imagem e agendamento |
| Banco local | **SQLite** (via `rusqlite` ou `sqlx`) + **FTS5** | Abertura instantânea, busca full-text offline |
| Frontend | **Svelte 5** *(ver decisão pendente D1)* | Leve, sintaxe próxima de HTML/CSS |
| Componentes headless | **Bits UI** (equivalente ao Radix para Svelte) ou **Radix**, se for React | O protótipo usa Radix |
| Editor rico | **TipTap** | Formatação, checklist, imagem inline |
| Conflitos/merge | **Yjs** no front + **yrs** no Rust | Integração pronta com o TipTap e merge de edições feitas em aparelhos diferentes |
| Sync | **Google Drive API v3** | Sem servidor próprio |
| Imagens | crates `image`, `fast_image_resize`, `webp`, `kamadak-exif` | Otimização na importação |

O Automerge foi considerado e **descartado** em favor do Yjs por causa do editor rico.

---

## 3. Funcionalidades

### 3.1 Notas
- Grade masonry com 2 colunas no celular e alternância para lista. Seção "Fixadas" no topo.
- Campos: título, corpo rico, cor (7 opções: padrão, areia, sálvia, céu, rosa, lilás, manteiga), fixada, categoria, tags, lembrete, anexos.
- Card mostra: primeira imagem como capa (com "+N" se houver mais), título, trecho, até 4 itens de checklist, e pílulas de lembrete, categoria, contagem de anexos e tags.
- **Arquivo** e **Lixeira** como no Keep. A lixeira apaga definitivamente após **30 dias**.
- Botão flutuante "+" cria nota já com a categoria ou tag do filtro ativo.

### 3.2 Editor
- Negrito, itálico, título (h3), lista, **checklist** clicável e **imagem no meio do texto**.
- Digitar `#palavra` no corpo cria a tag automaticamente. Tags também podem ser adicionadas num campo próprio.
- Barra superior: voltar (salva), fixar, lembrete (popover com atalhos "Hoje à noite", "Amanhã de manhã", "Segunda que vem" e campo de data e hora), menu com arquivar e mover para a lixeira.
- Barra inferior: ferramentas de formatação, inserir imagem e cor da nota.
- Salvamento contínuo, sem botão "salvar". Nota vazia ao sair não é criada.

### 3.2.1 Modo documento e exportar
- No editor, um botão (livro) abre a nota como **documento**: página inteira, coluna de leitura no meio, letra maior.
  Lembrado por nota (neste aparelho). O mesmo botão volta ao card.
- **Exportar** (menu ⋮ do editor e do card): Markdown e HTML; com fotos/anexos, um `.zip` com a pasta `anexos/` (no
  HTML, áudio e vídeo tocam com player; no Markdown viram link). **PDF**: impressão do sistema ("Salvar como PDF"),
  com só a nota no papel; áudio e vídeo saem como cartão com o nome e a duração.

### 3.3 Categorias e tags
- **Categorias** substituem os "marcadores" do Keep. Cada nota tem **no máximo uma**. Cada categoria tem nome, cor e (futuramente) ícone. Ficam listadas no menu lateral com contagem.
- **Tags** são livres e várias por nota. Cruzam categorias. Aparecem como nuvem no menu lateral.
- Todas as abas aceitam filtro por categoria ou tag. Quando há filtro ativo, ele aparece como pílula removível sob a busca.
- **Sem categoria** (último item das categorias) e **Sem tags** (último chip das tags) filtram o que está sem.
- **Ocultar** uma categoria (menu de contexto; ícone do olho cortado): as notas dela saem de Tudo, da busca, das tags e
  das outras visões; clicar na categoria mostra. **PIN** (4 a 8 números, o mesmo em todos os aparelhos): também some de
  tudo, e abrir pede o PIN (fica aberta até fechar o app ou "Bloquear agora"); o Claude (MCP) não acessa; o aviso do
  lembrete diz só "Nota protegida". Não é criptografia: protege de olhares (print, tela compartilhada).
- Ao pôr uma tag na nota, o campo sugere as que já existem (sem acento, por prefixo e por trecho).

### 3.4 Lembretes
- O lembrete é **um campo da nota** (`reminder_at`, `reminder_done`). A aba Lembretes é um **filtro salvo** com visual próprio.
- Grupos: **Atrasados**, Hoje, Amanhã, Próximos e Concluídos (os concluídos aparecem pelo switch "Concluídos").
- Concluir pela própria lista. A aba mostra um ponto vermelho quando há atrasados.
- Notificações precisam disparar com o app fechado. No celular, usar o agendador do sistema. No desktop, o app residente na bandeja agenda. Recorrência está fora do MVP.

### 3.5 Arquivos
- Lista **todos os anexos** (fotos e arquivos) das notas visíveis.
- Filtros por tipo: Tudo, Fotos, PDFs, Documentos, Planilhas, Áudio (com contagem). Também respeita categoria, tag e busca.
- Ordenação por mais recentes, nome ou tamanho. Visualização em lista ou grade.
- Resumo no topo: número de arquivos, total no Drive e **espaço economizado** pela otimização das fotos.
- Tocar numa foto abre o visualizador. Tocar num arquivo abre a nota de origem.

### 3.6 Moodboard
- Todas as imagens das notas visíveis numa grade masonry com miniaturas do cache.
- Cada imagem mostra sua **paleta extraída** (5 cores) como faixa sobre a miniatura.
- **Filtro por tom**: Quentes, Frios, Verdes, Rosas, Neutros. O tom é calculado na importação.
- Moodboard por projeto = filtro por categoria ou tag. Não existe entidade "moodboard" separada.
- O visualizador em tela cheia mostra a imagem, a paleta com códigos hex copiáveis, o tamanho original contra o otimizado e os botões "Original" e "Abrir nota".
- Futuro: ordem manual por arrastar, salva por escopo (`moodboard_order`).

### 3.7 Busca
- Barra de busca global no topo de todas as abas. O placeholder muda conforme a aba e o filtro.
- FTS5 sobre título, texto e tags. Precisa ignorar acentos (`tokenize = 'unicode61 remove_diacritics 2'`), porque o conteúdo é em português.

### 3.8 Captura rápida
- **Desktop**: app residente na bandeja e **atalho global** (sugestão: Ctrl/Cmd+Shift+N) que abre direto numa nota nova com o cursor no corpo.
- **Android**: receber conteúdo pelo "Compartilhar com" (texto, links, fotos) e, numa fase posterior, um widget de captura rápida (nativo, Kotlin).

### 3.9 Importação do Google Keep
- Lê o `.zip` do **Google Takeout** (pasta `Keep/`, um JSON por nota mais as mídias).
- Mapeamento: marcadores viram categorias (o primeiro marcador vira a categoria e os demais viram tags), `listContent` vira checklist, `color` vai para a paleta mais próxima, e `isPinned`, `isArchived`, `isTrashed` e os timestamps são preservados.
- As imagens passam pelo mesmo pipeline de otimização.
- **Validar os nomes de campos contra uma exportação real** antes de implementar. O usuário tem as categorias atuais: Arómate, Fluency, Gestão de Pessoas, Hospital, Linvo e MBA em Finanças e Análise de Dados.

### 3.10 Configurações
- Sincronização: status do Drive, última sincronização, "Sincronizar agora" e "Sincronizar só no Wi-Fi" (o texto sempre sincroniza; os anexos grandes esperam o Wi-Fi).
- Fotos: qualidade (Econômica 1280px, Equilibrada 2048px como padrão, Alta 3072px, Original sem compressão) — quem quer a foto intacta escolhe Original. Só fotos são comprimidas; PDFs, documentos, áudio e vídeo ficam como foram anexados.
- Cache: barra de uso e slider de limite (0,5 a 5 GB).
- Importar do Google Keep.
- **Backup local** (seção própria, entre Google Drive e Importar): "Fazer backup agora" grava um `.ideario` (zip com o
  Y.Doc de cada nota, categorias, anexos deste computador e uma cópia em Markdown em `leitura/`); "Restaurar" **junta**
  com o que existe (a mesma nota se junta pelo Y.Doc; apagada volta; nada some); automático semanal numa pasta
  escolhida, guardando os 4 últimos.
- Claude: ligar o Ideario no Claude Desktop (um botão) e o comando pronto para o Claude Code (ver §3.11).

### 3.11 Claude (MCP)
O próprio executável vira um servidor MCP (`ideario --mcp`, stdin/stdout) que o Claude Desktop e o Claude Code chamam.
Ele usa o mesmo núcleo e o mesmo banco local, com o app aberto ou fechado, e faz tudo o que o app faz:
- buscar e ler notas; criar, editar (o corpo inteiro ou só um trecho) e acrescentar;
- marcar, acrescentar e tirar itens de checklist;
- categorias, tags, cor e fixar; arquivo, Lixeira e restaurar;
- lembretes: pôr, repetir, adiar e concluir;
- anexos: listar, ver fotos e textos, anexar do computador e salvar uma cópia;
- importar do Keep.

O corpo entra e sai em Markdown. Os checklists são `- [ ]` com subitens recuados, e as fotos e anexos são links
`ideario://att/<hash>`. A ida e volta nota → Markdown → nota devolve a mesma nota (teste de propriedade), e a gravação no
Y.Doc mexe só no que mudou. Assim o Claude pode marcar um item com a nota aberta no editor sem atrapalhar quem digita.

Cada mudança fica anotada no banco (`external_changes`). O app aberto percebe pelo `PRAGMA data_version` e atualiza a
tela na hora; o sync do app leva as mudanças para o Drive. Apagar manda para a Lixeira; apagar para sempre só funciona
para o que já está nela (decisão do usuário). Guia: `docs/MCP.md`.

---

## 4. Arquitetura

```
┌──────────── Frontend (WebView) ────────────┐
│ Svelte/React · TipTap + Yjs · UI do protót.│
│ Lê/escreve só via comandos Tauri (invoke)  │
└───────────────┬────────────────────────────┘
                │ commands + events
┌───────────────▼────────────────────────────┐
│ Núcleo Rust                                │
│  db/        SQLite, migrações, FTS5        │
│  notes/     CRUD, Y.Doc por nota (yrs)     │
│  media/     pipeline de imagem, cache LRU  │
│  sync/      Drive API, outbox, changes     │
│  reminders/ agendamento + notificações     │
│  import/    Google Takeout (Keep)          │
└───────────────┬────────────────────────────┘
                │ HTTPS (em segundo plano)
         Google Drive (appDataFolder)
```

### 4.1 Regras de desempenho (metas)
- Inicialização a frio no desktop: lista visível em **< 300 ms**. No Android, uma primeira abertura a frio perto de ~0,5 s é aceitável; as seguintes devem ser imperceptíveis.
- Consulta da lista (5 mil notas): **< 16 ms**. Busca FTS: **< 30 ms**.
- Lista virtualizada. Miniaturas sempre locais. Nenhuma chamada de rede no caminho da renderização.
- ~~Fontes empacotadas no app~~ → **fonte do sistema** (decisão posterior ao protótipo, ver §9.2). Nada de Google Fonts em runtime.
- O frontend recebe dados prontos para exibir (trecho, capa, contagens), calculados no Rust ou em colunas derivadas, e não parseia HTML na lista. *(O protótipo faz parse no front; isso é aceitável só no protótipo.)*

---

## 5. Modelo de dados (SQLite)

Esboço inicial, a ajustar na implementação:

```sql
CREATE TABLE categories (
  id TEXT PRIMARY KEY,            -- UUID v7
  name TEXT NOT NULL,
  color TEXT NOT NULL,            -- hex
  icon TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE notes (
  id TEXT PRIMARY KEY,            -- UUID v7
  ydoc BLOB NOT NULL,             -- estado Yjs completo (fonte da verdade da nota)
  -- colunas derivadas do ydoc, para listar/filtrar rápido:
  title TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',   -- texto puro para FTS e trecho
  excerpt TEXT NOT NULL DEFAULT '',
  checklist_json TEXT,                  -- preview: [{text, done}] (até 4)
  cover_hash TEXT,                      -- 1ª imagem
  category_id TEXT REFERENCES categories(id),
  color TEXT NOT NULL DEFAULT 'none',
  pinned INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  trashed_at INTEGER,                   -- NULL = não está na lixeira
  reminder_at INTEGER,
  reminder_done INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  dirty INTEGER NOT NULL DEFAULT 1      -- precisa subir pro Drive
);

CREATE TABLE tags (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE note_tags (note_id TEXT, tag_id TEXT, PRIMARY KEY (note_id, tag_id));

CREATE TABLE attachments (
  hash TEXT PRIMARY KEY,          -- blake3/sha256 do arquivo otimizado (endereçamento por conteúdo)
  kind TEXT NOT NULL,             -- image | pdf | doc | sheet | audio | other
  mime TEXT NOT NULL,
  name TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  orig_bytes INTEGER,             -- tamanho antes da otimização
  width INTEGER, height INTEGER,
  palette TEXT,                   -- JSON: 5 hex
  tone TEXT,                      -- quente|frio|verde|rosa|neutro
  has_original INTEGER NOT NULL DEFAULT 0,
  local_state TEXT NOT NULL,      -- full | thumb_only | missing
  last_access INTEGER,
  drive_file_id TEXT,
  uploaded INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE note_attachments (note_id TEXT, hash TEXT, position INTEGER, PRIMARY KEY (note_id, hash));

CREATE TABLE moodboard_order (scope_key TEXT, hash TEXT, position INTEGER, PRIMARY KEY (scope_key, hash));
CREATE TABLE sync_state (key TEXT PRIMARY KEY, value TEXT);   -- ex.: drive_page_token

CREATE VIRTUAL TABLE notes_fts USING fts5(
  title, body_text, tags,
  content='', tokenize='unicode61 remove_diacritics 2'
);
```

**Fase 1 (implementado):** enquanto não há Y.Doc, o corpo fica em `notes.body_json` (JSON do TipTap) e as tags numa tabela `note_tags (note_id, tag, manual)` — manuais e `#tags` do texto. A busca usa `notes_fts (note_id UNINDEXED, title, body_text, tags)`. **Fase 2 (implementado):** `notes.ydoc` guarda o estado Yjs e é a fonte da verdade; `body_json` ficou como projeção (JSON do TipTap derivado do Y.Doc).

**Nota como Y.Doc:** cada nota é um documento Yjs com `Y.Map("meta")` (título, cor, categoria, pinned, archived, trashed_at, reminder, tags) e `Y.XmlFragment("body")` (conteúdo do TipTap). Assim, metadados **e** corpo fazem merge sem conflito. As colunas SQL são uma projeção atualizada a cada mudança.

Imagens no corpo referenciam o anexo por hash (`<img data-hash="…">`). O front resolve o caminho local via protocolo de assets do Tauri.

---

## 6. Sincronização com o Google Drive

- **Escopo**: `drive.appdata`, a pasta oculta do app. Evita a auditoria pesada de escopos restritos. *(D3 decidido: pasta oculta.)*
- **Layout no Drive**:
  ```
  appDataFolder/
    notes/<note_id>.ydoc        # estado Yjs binário
    categories.ydoc
    attachments/<hash>.<ext>    # arquivos otimizados
  ```
  Usar `appProperties` nos arquivos (ex.: `noteId`) para mapear sem baixar conteúdo. Miniaturas **não** sobem, porque são regeneradas localmente.
- **Nunca sincronizar o arquivo SQLite.** Ele é por aparelho.
- **Ciclo**:
  1. `changes.list` com o `pageToken` salvo traz só o que mudou.
  2. Para cada nota alterada: baixar, `apply_update` no Y.Doc local, reprojetar as colunas e manter `dirty=1` se o estado local tiver algo que o remoto não tem.
  3. Subir notas `dirty` (sempre baixar e mesclar antes de sobrescrever).
  4. Subir anexos pendentes (respeitando "só no Wi-Fi") e baixar sob demanda.
  - Mesmo que dois aparelhos sobrescrevam ao mesmo tempo, o CRDT garante convergência no ciclo seguinte, porque cada lado reenvia o que o outro não tem.
- **Frequência**: ao abrir, ao voltar ao primeiro plano, alguns segundos depois de uma edição (debounce) e por polling periódico. Não é tempo real, e não precisa ser.
- **Exclusão**: a nota vai para a lixeira (`trashed_at` no meta e sincroniza). Após 30 dias, o arquivo é apagado no Drive. Anexos sem referência são coletados depois.
- **OAuth**: no desktop, fluxo loopback com PKCE. No Android e no iOS, login Google nativo via plugin (provavelmente um plugin Tauri com código Kotlin/Swift). Guardar o refresh token no keystore do sistema.

**Fase 5 (implementado, `src-tauri/src/sync/`):**
- Arquivos soltos no `appDataFolder` (o Drive não precisa de pastas lá), reconhecidos pelo `appProperties`:
  `note-<id>.ydoc` (`kind=note`, `noteId`, `created`, `updated`: as datas da nota viajam junto), `categories.ydoc`
  (`kind=categories`, um Y.Doc com um `Y.Map` por categoria: nome, cor, ordem e "apagada" fazem merge campo a campo) e
  `att-<hash>` (`kind=attachment`, `hash`; os metadados do anexo, inclusive paleta e tom, vão na `description`).
- Cada nota guarda o arquivo e a `version` dele já juntada (`notes.drive_file_id`, `drive_rev`): o que este aparelho
  mesmo enviou não desce de novo. Excluídas de vez vão para `pending_deletes` e saem do Drive no próximo ciclo.
- Ciclo (`sync_once`): puxa (`changes.list`; na primeira vez, a marca e depois a lista inteira) → anexos, categorias e
  notas são juntados (`merge_remote_note`, que mantém `dirty` se o local tiver algo que o Drive não tem, inclusive só
  exclusões) → sobe anexos, notas `dirty`, categorias e exclusões. Não baixa a nota antes de sobrescrever: o passo de
  puxar do mesmo ciclo já trouxe o que havia; se outro aparelho escrever entre os dois, quem perdeu algo continua
  `dirty` depois de juntar e reenvia (teste `simultaneous_overwrite_converges_on_the_next_round`).
- Casos de borda: dois arquivos para a mesma nota (fica o de menor id, nos dois aparelhos); nota excluída em outro
  aparelho com edição local ainda não enviada volta (a edição não se perde); a mesma nota criada em dois aparelhos
  (o mesmo Takeout importado nos dois) dá o mesmo Y.Doc (o autor da criação sai do conteúdo) e categorias do Keep têm
  id derivado do nome; a nota de boas-vindas intocada sai quando o aparelho entra numa conta que já tem notas.
- Anexos: fotos e arquivos até 8 MB descem no sync (fotos ganham a miniatura aqui); os maiores descem ao abrir
  (`att://` busca no Drive). O hash é conferido. Envio multipart até 5 MB, "resumable" acima.
- Login: loopback + PKCE (`auth.rs`), cliente "App para computador" vindo da compilação
  (`IDEARIO_GOOGLE_CLIENT_ID`/`_SECRET`, passo a passo em `docs/GOOGLE_DRIVE.md`). Sem ele, o sync não aparece.
- Linha de fundo (`service.rs`): olha a cada 4 s; sobe quando a escrita para (duas olhadas iguais), pergunta ao Drive a
  cada minuto, ao voltar à janela e no "Sincronizar agora"; sem rede espera 30 s. Eventos `sync-state` (a nuvem),
  `core-changed` e `notes-synced` (o editor aberto junta a mudança na hora).
- Ainda não: cache com limite (LRU) dos anexos e "só no Wi-Fi" (fica para o Android).

---

## 7. Pipeline de mídia e cache

Na importação de uma imagem (Rust, fora da thread de UI):
1. Ler e aplicar a **orientação EXIF**, depois **remover todos os metadados** (inclusive GPS).
2. Redimensionar para o lado maior conforme a qualidade escolhida (padrão **2048 px**).
3. Codificar em **WebP** (padrão; AVIF é opcional, porque a codificação é lenta no celular). Meta: foto de 4 MB virar ~200–400 KB.
4. Gerar a **miniatura** (~400 px, WebP), que fica sempre no cache.
5. Extrair a **paleta** (5 cores dominantes, por k-means ou median-cut) e classificar o **tom**.
6. Calcular o hash e gravar em `attachments`. Não há cópia extra do original: quem quer a foto intacta escolhe a qualidade Original.
7. HEIC (iPhone) precisa de decodificador próprio. Tratar na fase mobile.

Na qualidade **Original** os passos 1 a 3 não acontecem: o arquivo fica exatamente como veio, inclusive com os metadados (localização/GPS, data, câmera), por escolha do usuário. Miniatura, paleta e tom são gerados normalmente.

**Cache**: texto e miniaturas ficam sempre locais. Arquivos grandes e fotos em tamanho cheio obedecem ao limite configurado com despejo **LRU** (`last_access`). Arquivos despejados viram `thumb_only` e são baixados de novo ao abrir.

---

## 8. Plataformas

- **Ordem sugerida** *(ver D2)*: Desktop primeiro para desenvolver rápido, Android logo depois (é o aparelho principal do usuário, que hoje usa o Keep no Android), iOS e Linux por último.
- Recursos específicos por plataforma:
  - Desktop: bandeja, atalho global e notificações agendadas pelo processo residente.
  - Android: compartilhar com o app (intent filter), notificações agendadas (cuidado com a permissão de alarmes exatos no Android 12+), widget nativo numa fase posterior.

---

## 9. Protótipo de design (referência visual)

O protótipo foi feito em **React + Radix UI** só para validar o design. O código-fonte está em `prototype/` (`App.tsx`, `data.ts`, `index.css`). O HTML exportado é o mesmo protótipo empacotado.

**O que vale do protótipo:** layout, hierarquia, tokens, textos da UI, comportamento das telas e as interações listadas na seção 3.
**O que não vale:** dados de exemplo, imagens SVG geradas, `contentEditable` com `execCommand` (substituir por TipTap) e parse de HTML no front.

### 9.1 Estrutura de navegação

> **Revisado após o protótipo (proposta A, escolhida pelo usuário).** Visão (como ver: Notas, Lembretes, Arquivos, Moodboard)
> e filtro (o que ver: uma categoria + várias tags) são eixos independentes: trocar um nunca desfaz o outro, e todas as visões,
> inclusive Lembretes, respeitam o filtro. A visão fica embaixo (barra centralizada no desktop, abas no celular), com a contagem
> de cada visão para o filtro atual. A lateral/gaveta e os chips de categoria só filtram. Visão vazia no filtro mostra
> "Nenhum lembrete em X" com "Nova nota em X" e "Ver lembretes de tudo". Arquivo e Lixeira são caixas da visão Notas.
> O texto abaixo descreve o protótipo original.

- **Topo**: menu (gaveta), busca em pílula, alternar grade/lista (só em Notas), ícone de status do sync.
- **Barra de abas inferior** com 4 abas: Notas, Lembretes, Arquivos, Moodboard. A aba ativa tem o ícone dentro de uma pílula de destaque.
- **Gaveta lateral**: marca "Ideario" e status do sync. Contém as 4 seções, **Categorias** (bolinha de cor, nome, contagem, "Editar", "Nova categoria"), **Tags** (nuvem de chips com contagem), Arquivo, Lixeira e Configurações.
- **Editor** em tela cheia sobre a lista, com fundo da cor da nota.
- **Configurações** em bottom sheet.

### 9.2 Tokens (claro / escuro)
```
Layout: coluna de celular (máx. 440px) com busca no topo, conteúdo em masonry e abas embaixo.

--bg        #eef1ef / #101513     --fg       #16201c / #e5ebe8
--surface   #ffffff / #19211e     --muted    #5d6a65 / #93a19b
--raised    #f7f9f8 / #1f2825     --line     #d6ddd9 / #2b3632
--accent    #2547c9 / #8ea4ff     --accent-soft #e2e8fb / #232c4d
--late      #c03b2b / #ff8a78     --good     #217a4b / #6fd09a

Cores de nota (claro / escuro):
sand #f6e9d6/#3a3125  sage #e1eedd/#26352a  sky #dde8f8/#22304a
rose #f8e0e4/#3d262c  lilac #e9e2f6/#2f2842 butter #f8f0c8/#39351e

Cores das categorias atuais:
Arómate #C26A3D · Fluency #3E8E7E · Gestão de Pessoas #8A6BC4
Hospital #C25478 · Linvo #3D63D6 · MBA #B08A1E
```
- **Tipografia**: **fonte do sistema** em toda a UI, para o app parecer nativo (Segoe UI no Windows, San Francisco no macOS, a fonte do GNOME/KDE no Linux, Roboto ou a do fabricante no Android). Pesos 500–700 em títulos e marca; corpo 15–16 px; monoespaçada do sistema para números, tamanhos, horários e hex, com `tabular-nums`. *(O protótipo usava Bricolage Grotesque, Figtree e JetBrains Mono; trocado por decisão do usuário.)*
- Raios: cards 16 px, pílulas 999 px, FAB 20 px, sheets 24 px. Rótulos de seção em caixa alta 11 px com espaçamento 0,09em.
- Tema segue o sistema (claro/escuro). Respeitar `prefers-reduced-motion`.

---

## 10. Fases de implementação

Cada fase termina com o app rodando e algo verificável.

| Fase | Entrega | Pronto quando |
|---|---|---|
| **0. Esqueleto** | Projeto Tauri 2 + frontend + porte visual do protótipo com dados falsos | O app no desktop reproduz as 4 abas, a gaveta, o editor e as configurações com fidelidade ao protótipo |
| **1. Núcleo local** | SQLite, migrações, comandos de CRUD, categorias, tags, arquivo/lixeira, FTS | Criar, editar, filtrar e buscar notas reais. Reabrir o app mostra tudo instantaneamente |
| **2. Editor** | TipTap + Yjs (Y.Doc por nota, persistido via yrs), checklist, `#tag` automática | Formatação e checklist persistem. A projeção (título, trecho, checklist) se atualiza na lista |
| **3. Mídia** | Pipeline de imagem, anexos, imagem inline, abas Arquivos e Moodboard, paleta e tom | Foto grande entra reduzida, sem EXIF. O Moodboard filtra por tom. Os números de economia são reais |
| **4. Lembretes e captura** | Agendamento, notificações, bandeja e atalho global (desktop) | O lembrete dispara com a janela fechada. O atalho abre uma nota nova em < 300 ms |
| **5. Sync Drive** | OAuth, layout no appDataFolder, changes + outbox, merge Yjs, anexos sob demanda | Editar a mesma nota offline em dois aparelhos e sincronizar resulta nas duas edições preservadas |
| **6. Importar Keep** | Leitor do Takeout | Uma exportação real entra com categorias, cores, checklists e fotos otimizadas |
| **7. Android** | Build, OAuth nativo, compartilhar com o app, notificações | Uso diário no celular. O widget fica para depois |

---

## 11. Decisões pendentes (perguntar ao usuário antes da fase correspondente)

- **D1 — Frontend: Svelte ou React?** A recomendação original foi Svelte. Porém o protótipo está em React + Radix, e manter React permite reaproveitar componentes e estilos quase diretamente. A diferença de desempenho na prática é imperceptível. *Decidir antes da Fase 0.*
- **D2 — Ordem das plataformas.** Confirmar desktop → Android.
- **D3 — Notas visíveis no Drive?** ✅ Decidido: **pasta oculta** (`appDataFolder`). A opção `appDataFolder` (oculta) é a recomendada. A alternativa é uma pasta visível com Markdown legível sem o app, que exige o escopo `drive.file` e uma conversão Yjs↔Markdown. Uma opção intermediária é exportar Markdown sob demanda.
- **D4 — Nome definitivo do app.** ✅ Decidido: **Ideario** (sem acento).
- **D5 — Ícones das categorias.** ✅ Decidido: **só cor**, sem ícone.

---

## 12. Fora do escopo (por enquanto)
Colaboração em tempo real com outras pessoas, compartilhamento de notas, IA dentro do app (a IA entra de fora, pelo MCP: §3.11), criptografia ponta a ponta e versão web pública.
