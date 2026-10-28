# Ideario — app de notas local-first (Tauri 2 + Rust)

App estilo Google Keep, multiplataforma, rápido como um bloco de notas e com sync pelo Google Drive.
**Especificação completa: `docs/SPEC.md`. Leia antes de qualquer tarefa.** O protótipo de design está em `prototype/`.

## Regras do projeto
- **O Atrio é o hub (regra do usuário, vale para toda tarefa):** tudo o que o Ideario e o Nodo têm em comum mora
  **só** no Atrio (`wylho/atrio`: componentes, CSS, regras do card, formatos, e no Rust a crate `atrio`), e os apps
  só usam. O card é **um só**: não parecido, **exatamente o mesmo** nos dois programas (mesma prévia, mesmas regras,
  mesmo visual). Antes de criar ou corrigir algo num app, perguntar: isto existe ou deveria existir no outro? Se sim,
  a mudança se faz no Atrio, sobe a tag e os **dois** apps sobem juntos (nunca deixar um app numa tag velha). Mesmo
  quando o usuário fala de um app só, se o assunto é peça do Atrio, o caminho é o Atrio. Plano em
  `atrio/docs/UNIFICACAO.md`.
- **Skills do Matt Pocock (pedido do usuário, 28/10/2026): nos três projetos e em todo app novo.** As skills ficam **copiadas no próprio repositório**, em `.claude/skills/` (do plugin
  `mattpocock-skills` 1.3.1, licença MIT em `.claude/skills/LICENSE-mattpocock-skills.txt`): assim toda sessão, local ou
  na nuvem, já as tem, sem depender de instalar plugin (na nuvem a instalação falhava e elas nunca apareciam). A cópia
  principal mora no Atrio; `scripts/sync-skills.sh` leva para os apps. Usar as skills dele no trabalho: `tdd`, `diagnosing-bugs`, `code-review`, `to-spec`/`to-tickets`/`triage`,
  `implement`, `prototype`, `improve-codebase-architecture`, `domain-modeling`, `grill-me`. Elas convivem com as skills
  do usuário (`rust-testing`, `rust-patterns`, `sync-site`, `atrio-hub`), que valem quando falam de algo mais
  específico. App novo: copiar o `.claude/skills/` e o `docs/agents/` do Atrio e pôr aqui o bloco "Agent skills".
- **Local-first**: a UI lê e escreve só no SQLite local. Rede apenas em segundo plano. Nada de spinner para abrir nota ou lista.
- Notas, Lembretes, Arquivos e Moodboard são **visões do mesmo banco**. Não duplicar dados.
- Cada nota é um **Y.Doc** (Yjs/yrs). As colunas SQL são uma projeção derivada dele.
- Nunca sincronizar o arquivo SQLite. No Drive, um arquivo por nota e anexos endereçados por hash.
- Fotos sempre passam pelo pipeline: orientação EXIF, remoção de metadados, resize, WebP, miniatura, paleta e tom.
  Exceção: qualidade **Original** (escolha do usuário) fica intacta, inclusive com GPS e demais metadados (SPEC §7). Só fotos são comprimidas.
- Fidelidade visual ao protótipo (`prototype/index.css` tem os tokens), exceto a tipografia: fonte do sistema, nunca CDN.
- UI em **português do Brasil**. Código e identificadores em inglês.
- **Dados de exemplo sempre fictícios** (mock, testes, protótipo, docs, prints do site/README): nunca nomes de clientes,
  empresas, cursos, saúde ou qualquer coisa da vida do usuário, nem tirados do Takeout dele. O repositório é público.
  Antes de publicar um print, olhar o print inteiro.
- **Git (combinado com o usuário):** commit e push ao terminar cada tarefa (o ambiente é temporário: o que não subiu pode
  se perder). O push não chega a quem usa o app: só o workflow Release lança versão, e só quando o usuário pedir.
  Lembrar que o push com mudança em `site/` publica o site.
- Trabalhar por fases (SPEC §10). Antes de começar uma fase, conferir as decisões pendentes (SPEC §11) e perguntar o que estiver em aberto.
- Ao fim de cada fase: compilar, rodar e verificar o critério "Pronto quando".

## Decisões tomadas
- **D1:** frontend em **Svelte 5 + Bits UI** (ícones `@lucide/svelte`, editor TipTap v3).
- **D2:** desktop primeiro (Windows, macOS, Linux); Android depois.
- **D4:** nome **Ideario** (sem acento).
- **Ícone oficial (desde a 0.4; desenho atual depois da 0.4.2):** três quadrados translúcidos sobrepostos sobre branco, desenho do
  usuário: azul no alto à direita, roxo (maior) no meio, amarelo embaixo à esquerda, na frente.
  `source/ideario.svg` (quadrado arredondado: Windows, Linux, favicon, `BrandMark.svelte`, `public/favicon.svg`,
  `site/favicon.svg`); `ideario-full-bleed.svg` (quadrado inteiro); `macos.svg` (margem da grade da Apple);
  `linux.svg` = sem o fundo branco, desenho a 1,12× (pedido do usuário: no GNOME fica melhor sem placa), só nos PNG
  `32x32`/`64x64`/`128x128`/`128x128@2x` (.deb, .rpm, AppImage, ícone da janela); Windows (.ico) e Mac (.icns) mantêm o fundo.
  Android adaptativo: fundo branco e, na frente (`android-foreground.svg`), o desenho da versão redonda do usuário
  reduzido a 72/108, ou seja, o círculo do launcher mostra exatamente a versão redonda e nada é cortado.
  Bandeja/barra de menus e notificação do Android: os três quadrados numa cor só, separados por um vão
  (`source/tray.svg`; `source/tray-png.py` gera `tray-dark.png`/`tray-light.png` e `drawable-*/ic_stat_ideario.png`):
  template no macOS, branco ou preto no Linux conforme o painel, colorido no Windows.
  Para regenerar: `npx tauri icon src-tauri/icons/source/icon-manifest.json` (e o `.icns` a partir de `macos.svg`),
  depois os quatro PNG do Linux (`npx tauri icon src-tauri/icons/source/linux.svg -o <pasta>` e copiar `32x32`, `64x64`,
  `128x128`, `128x128@2x`), `python3 src-tauri/icons/source/android-legacy.py` (os ícones antigos do Android; o do Tauri sai cortado) e,
  dentro de `src-tauri/icons`, `python3 source/tray-png.py`.
- **Tipografia:** fonte do sistema em toda a UI, para parecer nativo (substitui Bricolage/Figtree/JetBrains Mono do protótipo).
  No Linux o núcleo lê a fonte do GNOME/KDE (`src-tauri/src/system_fonts.rs`); nos demais, `system-ui`.
- **D5:** categorias só com cor (sem ícone).
- **D3:** notas na **pasta oculta do app** no Drive (`appDataFolder`, escopo `drive.appdata`). Sem pasta visível em Markdown.
- **MCP (pedido do usuário: "funcione completamente"):** o executável com `--mcp` é o servidor (stdio). Funciona com o
  app aberto ou fechado. Faz tudo o que o app faz; apagar vai para a Lixeira e apagar para sempre só vale para o que já
  está nela. Ligar pelas Configurações (botão do Claude Desktop + comando do Claude Code).
- **Privacidade de categoria:** ocultar (menu de contexto, ícone do olho cortado) tira as notas dela de Tudo, busca e
  demais visões (abrir a categoria mostra). PIN: esconde do mesmo jeito e pede o PIN para abrir; vale em todos os
  aparelhos e esconde também do MCP. Não é criptografia (decisão do usuário, ciente disso).
- **Exportar nota:** Markdown/HTML num `.zip` com a pasta de anexos (no HTML áudio/vídeo tocam; no Markdown, link);
  PDF com áudio/vídeo como cartão (nome e duração). Nota sem anexo sai num arquivo só.
- **Atrio** (`wylho/atrio`, pacote `@wylho/atrio`, nome do usuário): biblioteca de código compartilhado com o Nodo,
  por dependência git numa tag (`github:wylho/atrio#vX.Y.Z`). Não é só estilo: o objetivo é o card inteiro (editor,
  etiquetas, data, status, anexos, gravações) virar componente lá, com chaves por app (no Nodo a categoria fica
  desligada). Hoje tem o `atrio.css` (era o `src/app.css`, que saiu daqui: mudança de visual se faz no Atrio e aqui
  sobe a tag), o `CardBody` (miolo do `NoteCard`) e o card na área de transferência. Desde a 0.3.0, também as
  extensões do editor (`@wylho/atrio/editor`: blocos, link, mídia, gravador), o seletor de emoji
  (`@wylho/atrio/emoji`), menus (`MenuAt`, `MenuList`, `ContextMenu`), `Picker`, `StatusToggle`, `ReminderPopover`,
  `TagInput` (recebe `known={app.tags}`), `MediaBlock` (recebe `src` e `ondownload`), `AudioPlayer` e `CameraDialog`.
  `lib/format.ts`, `lib/reminders.ts`, `lib/menu.ts` e `lib/emoji.ts` só reexportam do Atrio; o toast do Atrio é o
  `app.say` (`setNotifier` em `main.ts`). Repetir todo mês a partir de 31/jan agora cai em 28/fev também na interface.
  Desde a 0.5.0, **o card inteiro** vem do Atrio (`NoteEditor`): `components/Editor.svelte` é só a casca (janela,
  Y.Doc e salvamento contínuo, sync, fixar, arquivar, lixeira, exportar, modo documento, barra do topo no snippet
  `top`), com `features()` (tudo ligado) e um `CardHost` sobre o `api`. Mudança no card (blocos, anexos, gravador,
  lembrete, status, etiquetas, cor, barra de formatação) se faz no Atrio.
  **Núcleo também pelo Atrio** (unificação, fase 1; Atrio 0.12.0): `src-tauri` depende da crate `atrio` na mesma tag
  do Nodo; saíram as cópias `markdown.rs`, `text.rs` e `testdoc.rs` e a forma canônica de `ydoc.rs` (`lib.rs` faz
  `use atrio::{markdown, text}`; `store.rs` reexporta `REPEATS`/`clean_emoji`; `clean_tags` do MCP e do card colado
  são os do Atrio). Plano em `atrio/docs/UNIFICACAO.md`.
  **Fase 2 (Atrio 0.13.0):** anexos (`atrio::attach`: tipo, MIME, hash, nomes, Range, `prepare`), o pipeline das
  fotos (`atrio::media`, feature `media`), status e repetição (`atrio::card`) e a prévia do card
  (`atrio::projection`) vêm da crate; saíram `media.rs` e `projection.rs`; `attachments.rs` e `reminders.rs` ficaram
  só com o que é do Ideario (banco, pasta, miniaturas de PDF, adiar, avisar). `store::Attachment` é o do Atrio.
  **Fase 3 (Atrio 0.15.1):** o card da lista é o `NoteCard` do Atrio, o mesmo do Nodo; `components/NoteCard.svelte`
  só liga o que é do Ideario (menu, seleção com `onmark`, fixar, filtros, arrastar). Atenção: o npm não troca a
  dependência git só porque a tag mudou no `package.json` (segue o `package-lock`); a interface estava no Atrio 0.9.0
  até aqui. O `scripts/apps-up.sh` do Atrio agora instala a tag pelo nome e confere a versão.
  **Atrio 0.16.0:** a barra do topo do card aberto é a `CardTopBar` do Atrio (a mesma do Nodo); o `Editor.svelte`
  só passa o rótulo (editada há…, ID curto), fixar e os itens do Ideario no menu (Exportar, Arquivar, Lixeira; na
  lixeira, o snippet `trashMenu` troca o menu).
  **Atrio 0.17.1:** o visualizador de anexos é o `AttachmentViewer` de `@wylho/atrio/viewer` (o mesmo do Nodo);
  `Lightbox.svelte` só liga baixar e "Abrir nota"; `PdfViewer.svelte` saiu e `lib/pdf.ts` reexporta o `openPdf` de lá.
  Antes no Atrio **0.11.0** (capa e anexos na prévia em Markdown; foto com o cursor numa lista entra depois dela).
  Desde a 0.9.0, as pílulas do card da lista são o `CardPills` do Atrio; com `onstatus`, a nota que tem status (ou
  lembrete) mostra o seletor de três cores no card e muda ali mesmo, sem abrir (pedido do usuário). O `vite.config.ts`
  deixa o Atrio fora do pré-empacotamento (senão o `npm run dev` quebra nos `.svelte.ts`).
- **Backup local:** manual ("Fazer backup agora") + automático semanal numa pasta escolhida, guardando os 4 últimos.
  Restaurar **junta** com o que existe (como o sync), nada se perde.
- **Licença:** **GPL-3.0-or-later**, a mesma do Nodo e do Atrio (escolha do usuário, 22/10/2026), no arquivo
  `LICENSE` (e no `license` do `package.json` e do `src-tauri/Cargo.toml`). O site e o README chamam o Ideario de
  grátis e de código aberto; a licença aparece no rodapé do site, nos termos e no fim do README.


## Agent skills

### Issue tracker

Tarefas e especificações em arquivos Markdown dentro do repositório, em `.scratch/<assunto>/` (escolha do usuário),
e sobem no commit como o resto. See `docs/agents/issue-tracker.md`.

### Triage labels

Os cinco estados padrão (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), numa linha
`Status:` no topo de cada arquivo. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` na raiz (quando houver); as decisões são as do `CLAUDE.md` ("Decisões tomadas"). See
`docs/agents/domain.md`.

## Estado atual
- **Fases 0 a 5 concluídas (e a importação do Keep).** No app, a UI fala com o núcleo Rust (`src/lib/api/tauri.ts` → `src-tauri/src/commands.rs`):
  SQLite com FTS5 (`store.rs`: migrações por `user_version`; antes de migrar guarda `ideario.db.vN.bak`).
  **Cada nota é um Y.Doc** (`ydoc.rs` com yrs; `src/lib/ydoc.ts` no front): `meta` (Y.Map) + `body` (Y.XmlFragment no formato
  do y-prosemirror). A coluna `notes.ydoc` é a fonte da verdade; `body_json` e as demais colunas são projeção dela.
  O editor usa o TipTap Collaboration sobre o Y.Doc (desfazer do Yjs) e manda atualizações binárias
  (`get_note_state` / `apply_note_update`, sem JSON); menus que mudam metadados passam pelo `meta` no núcleo.
  O mock monta o Y.Doc a partir do JSON (`src/lib/api/mock/ydoc.ts`, mesmo formato do núcleo). Projeção no núcleo (`projection.rs`), anexos por hash com protocolo `att://` (`attachments.rs`),
  categorias e tags gerenciáveis, nota de boas-vindas no primeiro uso. Medido (release, 5 mil notas): consulta 12–15 ms,
  busca 7 ms, reabrir com a lista na tela em ~0,5 s (lista virtualizada a partir de 200 itens, `Masonry.svelte`).
- A UI só fala com `src/lib/api` (interface `Api`). No navegador (`npm run dev`, prévia) e nos testes e2e ela é atendida
  pelo mock (`src/lib/api/mock`, dados de exemplo), que precisa acompanhar o núcleo método a método.
- Layout responsivo (pedido do usuário: desktop primeiro): < 640 px = protótipo de celular; 640–959 px = gaveta + abas,
  largura total; ≥ 960 px = como o Google Keep: barra superior fixa (☰ e visões à esquerda, sem logo nem nome; ações ancoradas à direita; nuvem e campo de busca só crescem na folga, sem mover nada) e, abaixo, lateral (`NavList`)
  que fecha de todo (ícone PanelLeft; o topo não se move) e aí as categorias viram pílulas acima das notas, como na janela média; editor e configurações como diálogo central.
  Masonry é JS (`Masonry.svelte` + `estimateCard`), porque a WebKitGTK não equilibra `columns:` do CSS. Cada card é
  posicionado por coordenadas numa lista só (nunca é recriado ao redimensionar ou reordenar; só desliza). O arraste
  (`drag.svelte.ts`) acha o card sob o ponteiro pela posição final (`data-x`/`data-y`), não pela animada, e só troca de
  novo depois que o ponteiro anda 12 px (senão os cards tremem). Sonda no app nativo: `tests/native/probe-grid.mjs`.
- Princípio de design: só mostrar o que tem motivo para aparecer (ex.: nuvem do sync só ao sincronizar, sem
  conexão ou com erro; nada de controles que ainda não funcionam).
- Navegação (proposta A): `app.view` (como ver) e `app.filter` (categoria + tags, o que ver) são independentes; `app.box`
  = active/archive/trash só na visão Notas. Seletor de visão: no desktop logo depois do ☰ (busca é ícone à direita), no celular barra flutuante (pílula) embaixo; número só em Lembretes (`app.counts`).
- Barra superior = ☰ + visões | folga | **menu dinâmico** (`ViewActions.svelte`) | busca. Da direita para a esquerda (pedido
  do usuário): o que é fixo (a busca) fica na ponta, sempre no mesmo lugar; as ações da visão ficam à esquerda dele. O menu dinâmico tem tudo o que depende
  da visão ou do lugar, sempre na mesma ordem e com os mesmos componentes: filtro da visão (`FilterGroup`: ícones no
  desktop, um menu no celular) → ordenar (`SortMenu`) → lista/grade (`LayoutToggle`). Lembretes: mostrar concluídos;
  Lixeira: ícone de esvaziar (vassoura, neutro, com confirmação, só quando há notas). Nada de controles soltos no meio do conteúdo.
- Contorno: tudo o que é card ou miniatura (cards, listas de lembretes/arquivos, miniaturas, moodboard, fotos no
  editor, blocos das configurações) usa o mesmo `--card-edge` translúcido; `--line` fica para controles e separadores.
- macOS: barra de título transparente (`TitleBarStyle::Overlay` em `lib.rs`; botões em x 18, y 33 = centro a 32 px,
  medido num print). Com a janela larga, **lateral até o topo** (como Notas/Finder): grade de duas colunas só no Mac
  (`data-titlebar="overlay"` no `<html>`), lateral com fundo próprio e os botões no canto dela (`.mac-corner` arrasta a
  janela); fechada, a barra abre espaço para os botões (`--rail-w`: `mac_lights_width` mede no AppKit; 96 px no macOS 26). Estreita: os botões ficam na barra, que abre espaço (e fecha em tela cheia,
  `data-fullscreen` em `main.ts`). Barra do app arrasta a janela (`data-tauri-drag-region="deep"` no `TopBar`).
  Motivo: o `setTheme` não escurecia a barra de título no Mac.
- Barra de título (macOS/Windows) e fundo da janela acompanham o claro/escuro do app (`theme.svelte.ts` → `setTheme`,
  `setBackgroundColor`); a escolha fica no núcleo (`set_window_look`) e a janela já nasce com ela (`lib.rs`).
- Temas (do Atrio desde a 0.4.0: `src/lib/palettes.ts` só reexporta; estado em `theme.svelte.ts`): Sistema (padrão; o
  núcleo lê destaque/esquema do GNOME, KDE, Windows, macOS em `src-tauri/src/system_theme.rs`), **Atrio** (a paleta-base,
  que se chamava Ideario; a escolha gravada `ideario` vira `atrio` por `normalizePaletteId`), Papel, Grafite, Floresta;
  claro/escuro/automático à parte. Os mesmos do Nodo.
- Mídia no editor (`src/lib/editor/media.ts`): fotos lado a lado (`imageRow`, 2–4, arrastar como no Gutenberg + botões na foto
  selecionada), anexos inline (`noteFile`: vídeo, áudio com player, documentos), gravador e câmera (`capture.svelte.ts`).
  A capa do card é a primeira foto ou a primeira linha de fotos. Arquivos arrastados do computador (`FileDrop.svelte`; no app
  pelo evento nativo do Tauri, com o caminho, lido no núcleo por `import_path`; no navegador, drop do HTML): com nota
  aberta entram nela (no ponto do texto ou no fim); sem nota aberta viram nota nova.
- Linux: a WebKitGTK vem com microfone/câmera desligados; `lib.rs` (`linux_media`) liga e aceita os pedidos de áudio e
  vídeo. O AppImage leva o GStreamer (`bundleMediaFramework`), senão não há player nem gravador. "+" em leque (`FabMenu`) com atalhos.
- Blocos (`src/lib/editor/blocks.ts`): cada nó de primeiro nível é um bloco, como no Notion. Uma alça ⋮⋮ só, no hover,
  colada ao que está sob o ponteiro (`blockAt`; em lista, o item é o da linha, `itemAtRow`): arrasta e abre o menu (`MenuAt`).
  No toque (sem hover) a alça fica no bloco onde está o cursor. Modo documento só com a janela larga.
  **Arrastar no editor é sempre pelo ponteiro, nunca pelo arrastar do HTML** (`dropTargetAt`/`moveNodeTo`; fotos em
  `photoDrag`): no macOS e no Windows o Tauri fica com todo arraste para receber arquivos e a página nunca recebe o soltar. Em lista/checklist ela é do
  item (reordenar como no Keep; menu com Aumentar/Diminuir recuo e o submenu "Checklist inteira"/"Lista inteira").
  Checklist com subitens em vários níveis (Tab/Shift+Tab; marcar o item marca os subitens, `CheckCascade`).
  "Transformar em" passa por `convertBlock` (lista↔checklist mantém níveis e marcados). Ctrl/⌘+A: `SelectAllDom`
  ancora a seleção do DOM no texto (senão, nota que começa/termina com checklist ou anexo não mostra a seleção). Clique direito
  em foto/anexo abre o mesmo menu. Copiar/colar entre notas leva fotos e anexos. Anexos são sempre blocos do texto.
- Seleção múltipla (Notas): check no canto (hover), Ctrl/Shift+clique, retângulo com o mouse (`marquee.ts`), Ctrl+A, Esc;
  a barra superior vira `SelectionBar` com ações em lote e Desfazer.
- Segundo plano (opção do aparelho, `background.svelte.ts` + `src-tauri/src/background.rs`): ao fechar a janela, fica com
  ícone na bandeja (barra de menus no Mac; no GNOME precisa do AppIndicator). Desligado por padrão. Sem atalho global por ora.
  `core:window:allow-close` = o mesmo que o X (os testes nativos fecham a janela assim).
- CI (`.github/workflows/build.yml`): verificação + instaladores de macOS (universal), Windows e Linux nos Artifacts.
- Menus de contexto: `ContextMenu.svelte` (clique direito, Shift+F10, toque longo) + itens em `src/lib/menus.ts`.
  O menu do navegador é bloqueado fora de campos de texto (`main.ts`). Ações com "Desfazer" no toast.
- Leitor de PDF próprio (`PdfViewer.svelte`, pdf.js de `src/lib/pdf.ts`), igual nos três sistemas (a WebKitGTK não
  mostra PDF em iframe): páginas desenhadas perto da tela e liberadas longe dela.
- Prévia dos cards: a projeção entrega `preview` (blocos na ordem do documento) e `label`; a UI não parseia o corpo.
- Tags: `tags` na nota guarda só as manuais; as `#tags` do corpo são derivadas na projeção (evita gravar tags pela metade
  durante o salvamento contínuo).
- Verificação: `npm run check`, `npm run test:e2e` (relógio fixo às 10h), `cargo test` em `src-tauri`, testes no app
  nativo (`npx tauri build --debug --no-bundle && xvfb-run -a node tests/native/run.mjs`; precisa de webkit2gtk-driver e
  tauri-driver), desempenho (`tests/native/perf.mjs`, build de release) e `npm run tauri build`.
- Site (`site/`, Cloudflare Pages em ideario.pages.dev) e `README.md` têm o mesmo conteúdo: ao mudar um, mudar o outro
  (skill `sync-site`; prints por `scripts/site-shots.mjs`).
- **Atrio 0.23.0** (tarefa 02 do roteiro em `atrio/.scratch/roteiro/`): o card aberto usa o `CardDialog` do Atrio (o
  mesmo do Nodo; antes o `Editor.svelte` montava o próprio `Dialog` do bits-ui, igual por fora). O fechar do Ideario
  já esperava o `settle` e já parava os atalhos (`app.editor`); a `CardSession`/`cardOpen()` do Atrio levaram a
  mesma regra ao Nodo.
- **Versão 0.6.5 lançada** (28/10/2026, Release `v0.6.5`, pedido do usuário: "depois que tiver tudo certinho, você pode fazer o release"): o PDF
  da nota com o card no topo (abaixo).
- **PDF da nota com o card no topo (Atrio 0.22.0)** (escolha do usuário, opção C; o título longo saía cortado no
  PDF porque no papel era o campo de texto): o topo do papel é o card da nota (cor, emoji, título inteiro, pílulas de
  categoria, lembrete, status e etiquetas), o texto embaixo, e o papel é sempre claro mesmo com o app no escuro. Tudo
  no Atrio (`NoteEditor` `.ed-print-card` e o `@media print` do `atrio.css`); aqui só a tag e o e2e "modo documento"
  conferindo o card no papel.
- **Versão 0.6.4 lançada** (24/10/2026, Release `v0.6.4`, pedido do usuário: "lança o ideário com o update de arrastar para baixo"): **puxar para
  baixo sincroniza** (pedido do usuário: no celular, ter que ir às Configurações para sincronizar era ruim): no topo de qualquer visão, puxar a lista com o dedo mostra o círculo com
  as setas e, ao soltar depois do limite, sincroniza e gira até terminar (`components/PullRefresh.svelte` em
  `main.content`, `app.pullRefresh`: `syncNow` e espera sair de "sincronizando"; sem Drive conectado ou sem internet,
  avisa por quê). Só com toque; mouse e trackpad não mudam. Teste e2e com eventos de toque.
- **Versão 0.6.3 lançada** (22/10/2026, Release `v0.6.3`, pedido do usuário: "lança tudo"): **Atrio 0.21.0** (escolha do usuário, opção D): a tabela no card fechado é só o
  resumo, "Tabela · N colunas × N linhas" e os nomes das colunas (no card estreito as colunas viravam fiapos). A tabela
  inteira continua no card aberto. `src/lib/layout.ts` estima a altura do resumo; o teste de colar Markdown confere o
  `.pv-tsum`. O MCP diz que o título é texto simples (Markdown não é reconhecido nele).
- **Versão 0.6.2 lançada** (22/10/2026, Release `v0.6.2`, pedido do usuário: "lança tudo"): a correção do `export_note` do MCP (abaixo).
- **MCP conferido de ponta a ponta depois da 0.6.1** (pergunta do usuário): as 36 ferramentas rodando no `ideario --mcp`
  de verdade, com dados de teste numa pasta à parte (`XDG_DATA_HOME`). Corrigido: `export_note` gravava por cima de
  uma exportação anterior com o mesmo nome; agora usa `atrio::attach::unique_path` ("Receita (1).zip"), teste
  `exporting_twice_to_the_same_folder_keeps_both_files`.
- **Versão 0.6.1 lançada** (22/10/2026, Release `v0.6.1`, pedido do usuário): Atrio 0.20.0, a tabela aparece como tabela no card fechado (antes
  "a · b · c"; `PROJECTION_VERSION` 3 reprojeta as notas ao abrir; `PreviewBlock` agora é o tipo do Atrio, sem cópia
  em `types.ts`; mock e `layout.ts` contam a tabela) e copiar vários cards (Atrio 0.19.0).
- **Versão 0.6.0 lançada** (22/10/2026, Release `v0.6.0`; pedido do usuário: lançar tudo): o app em inglês e português (Configurações →
  Idioma), o card do Atrio 0.18.2 nos dois idiomas, notas de exemplo em inglês na prévia, licença GPL-3.0-or-later,
  site e README em inglês com o português em `/pt/` e `README.pt-BR.md`.
- **Versão 0.5.1 lançada** (22/10/2026): no Android, notificação com o ícone monocromático e tocar abre a nota.
- **Versão 0.5.0 lançada** (22/10/2026, Release `v0.5.0` com APK do Android): o card inteiro do Atrio e o status no
  card da lista.
- Release: `.github/workflows/release.yml` (subir a versão no `tauri.conf.json`; Actions → Release → Run workflow, no
  branch padrão). Nasce rascunho; o job "Publicar" monta os repositórios apt/dnf e só então publica. Guia e segredos:
  `docs/RELEASE.md`. Atualização: Windows, macOS e AppImage pelo próprio app (`updates.rs` + `tauri-plugin-updater`,
  `latest.json` do último Release, assinatura com a chave de `plugins.updater.pubkey`; procura só ao abrir, pedido do
  usuário; aviso `UpdateNotice.svelte`); `.deb`/`.rpm` pelo repositório (`scripts/linux-repos.sh`: índices assinados
  com GPG sobem para o Release, `site/_redirects` aponta `/apt` e `/rpm` para lá; chave pública em `site/linux/`).
- Graphify (mapa do código, local, sem chave; o usuário pediu para usar sempre que ajudar a achar código): `pip3 install --user graphifyy` e
  `graphify extract . --code-only --out <pasta fora do repo>`; consultas com `graphify explain "X" --graph <…>/graph.json`.
- Ordem combinada com o usuário (plano em https://claude.ai/code/artifact/45aafe33-c71a-4b29-abb6-4caf94af6817):
  Fase 3 (Mídia) → Importar Keep (Fase 6, antecipada; precisa de um Takeout real) → Fase 4 → Fase 5 → Fase 7.
- **Fase 3 (concluída).** Pipeline de fotos no núcleo (`media.rs`): orientação EXIF, sem metadados, redução pela
  qualidade (1280/2048/3072), WebP (com perda; sem perda se ficar menor), miniatura de 400 px em `<dados>/thumbs/<hash>.webp`
  (servida por `att://…/<hash>?thumb`), paleta de 5 cores (corte da mediana) e tom. Original e GIF ficam como vieram.
  Importação assíncrona (`attachments::prepare` fora da trava do banco; `save` grava). Fotos da Fase 1 ganham
  miniatura/paleta/tom em segundo plano ao abrir (`Core::backfill_media`). 12 MP: ~0,7 s, 6,2 MB → 630 KB.
  Prévias de PDF (pdf.js embutido, primeira página) e vídeo (um quadro) feitas na interface (`previews.svelte.ts`) e
  guardadas pelo núcleo como miniatura (`set_preview`; arquivo vazio = sem prévia possível); `FilePreview.svelte` mostra
  por cima do ícone. Projeção versionada (`PROJECTION_VERSION`): mudou o formato, as notas são reprojetadas ao abrir.
  Fica para a Fase 5: cache com limite (LRU) dos anexos, que depende do Drive.
- Skills do usuário para todas as fases: testes em Rust (TDD, proptest, provar que o teste pega erro quebrando o
  código de propósito, clippy sem avisos no CI) e padrões idiomáticos de Rust (sem `unwrap` em produção, `pub` mínimo).
- Pedidos do usuário para a fase certa: arrastar card até categoria da lateral; baixar em
  Downloads ou escolher a pasta (diálogo nativo); prévia de PDFs e documentos; bug: card tremendo ao arrastar e cards
  quebrados ao redimensionar a janela (Masonry) — feito.
- **Importar do Keep (Fase 6, antecipada): concluída.** `keep.rs` lê o zip do Takeout (nomes em UTF-8 sem a marca, como o
  Finder grava; ignora `__MACOSX`, `._*`, `.DS_Store`) e converte cada nota: HTML do texto (parágrafos, h1/h2 → título,
  negrito/itálico pelo `<span style>`), checklist, fotos pelo pipeline, links (anotações) como texto, 1º marcador →
  categoria e os demais → tags, cor mais próxima, fixada/arquivada/lixeira (lixeira conta 30 dias a partir da
  importação) e as datas originais. Id estável (UUID v5): importar de novo pula as que já entraram. Mídia ausente do zip
  é contada no resumo. `Core::import_keep` (fotos fora da trava, evento `keep-progress`); entrada pela janela (soltar o
  zip, `FileDrop`) ou Configurações → Importar (diálogo nativo, `tauri-plugin-dialog`). Validado no Takeout real do
  usuário (447 notas, 1,2 s); teste `real_takeout` (ignorado, `IDEARIO_TAKEOUT=…`) mostra só contagens.
  Os dados do usuário não vão para o repositório: os testes usam um Takeout inventado no mesmo formato.
- **Fase 4 (concluída): lembretes que avisam.** `reminders.rs` (regra pura): a cada 10 s o núcleo pega o que venceu e
  ainda não avisou neste aparelho (`notes.notified_at`, local, não sincroniza), marca, e reagenda os que se repetem
  (`reminderRepeat` no meta do Y.Doc: day/week/month/year; mês e ano contam da data original, mesmo horário local,
  horário de verão certo via chrono). Atrasados (app fechado ou computador desligado) avisam ao abrir, marcados
  "atrasado"; mais de 3 de uma vez viram um resumo. `notify.rs`: notificação do sistema pelo notify-rust (macOS,
  Windows, Linux) com Abrir / Adiar 10 min / Concluir (lembrete que se repete não tem Concluir); evento `reminders`
  para o aviso dentro do app (`ReminderAlerts.svelte`, `notify.svelte.ts`) e `core-changed` para a UI recarregar.
  Com a janela fechada avisa se o segundo plano estiver ligado; ao marcar o primeiro lembrete o app sugere ligar
  (uma vez). Atalho global continua fora (decisão do usuário).
- **Fase 5 (concluída no código): sync com o Google Drive** (`src-tauri/src/sync/`; detalhes em SPEC §6). Downloads em lotes paralelos (`download_many`), a lista atualiza a cada lote; a ordem personalizada vai no meta do Y.Doc (`position`). Pasta oculta
  (`appDataFolder`): um arquivo por nota (Y.Doc), `categories.ydoc` e anexos por hash, reconhecidos pelo
  `appProperties`. `mod.rs` = motor (`sync_once`: puxar mudanças e juntar, depois subir anexos, notas `dirty`,
  categorias e exclusões) sobre o trait `Remote`; `memory.rs` = Drive em memória dos testes (dois/três aparelhos,
  falhas de rede, corridas, proptest de convergência); `drive.rs` = API v3 por HTTP (ureq; multipart/resumable,
  renova o token no 401, espera no 429/5xx); `auth.rs` = login loopback + PKCE, token de renovação no chaveiro
  (Mac/Windows) ou arquivo 0600 (Linux); `service.rs` = linha de fundo, comandos `sync_*` e eventos.
  O cliente OAuth entra na compilação (`IDEARIO_GOOGLE_CLIENT_ID`/`_SECRET`, segredos do GitHub; passo a passo em
  `docs/GOOGLE_DRIVE.md`); sem ele as Configurações dizem que o sync não está ligado nesta versão.
  Falta validar com uma conta Google real (precisa do cliente OAuth do usuário). Ficam para depois: cache LRU dos
  anexos e "só no Wi-Fi" (Android).
- **MCP (concluído; guia em `docs/MCP.md`, SPEC §3.11).** `ideario --mcp` (`src-tauri/src/mcp/`) fala JSON-RPC por
  stdin/stdout sobre o mesmo `Core`/banco, com 34 ferramentas. O corpo entra e sai em Markdown (`markdown.rs`; ida e volta
  sem perda, proptest), com fotos e anexos como `ideario://att/<hash>`. A gravação no Y.Doc mexe só no que mudou
  (`ydoc::patch_children`), então o Claude marca um item com a nota aberta e as edições se juntam. Cada mudança vai para
  `external_changes` (migração 6); o app aberto olha o `PRAGMA data_version` (`mcp/watch.rs`) e emite os eventos do sync.
  Configurações → Claude: `mcp/setup.rs` grava `mcpServers.ideario` no `claude_desktop_config.json` (AppImage: usa
  `$APPIMAGE`). Teste nativo "MCP:" roda o processo de verdade com o app aberto.
- Privacidade de categoria (`store.rs`): colunas `hidden`/`pin_hash` (migração 7, vão no `categories.ydoc`), desbloqueio
  na tabela temporária `temp.unlocked` (por conexão: fechar o app bloqueia; o MCP nunca vê desbloqueada). `private_clause`
  no `where_clause` tira as notas delas de todas as listas, exceto a categoria escolhida (com PIN, só desbloqueada).
  UI: `app.openCategory` / `askUnlock` / `askPin` (`AppDialogs.svelte`), menu em `menus.ts` (`privacyEntries`).
- Backup local (`src-tauri/src/backup.rs`, `src/lib/backup.svelte.ts`): `.ideario` = zip (manifest, `notes/<id>.ydoc`,
  `notes.json` com as datas, `categories.json`, `attachments/` + `thumbs/`, `leitura/*.md`). Restaurar = `apply_update` por
  nota (merge Yjs) + categorias que faltam; tira a boas-vindas intocada de um app novo. Automático: linha de fundo de hora
  em hora (`backup_auto`/`backup_dir`/`backup_last` no `sync_state`, local), poda os 4 mais novos pelo nome.
  MCP: `create_backup`.
- Modo documento (`data-doc` no `.editor`, lembrado por nota em `docmode.ts`) e exportar (`src-tauri/src/export.rs`:
  HTML/Markdown, `.zip` com `anexos/` quando há anexo; `src/lib/exporting.ts`). PDF = `print_window` (Tauri
  `WebviewWindow::print`; no navegador `window.print`) com `body.print-note` e o CSS `@media print` do fim do app.css.
  MCP: `export_note`.
- Bloco de link (`linkCard`, `src/lib/editor/link.ts`): colar URL sozinha numa linha vazia ou "+ Link…"; o cursor vai
  para a linha de baixo (`insertLinkCard`). Prévia pelo núcleo (`src-tauri/src/link.rs`: ureq, Open Graph/`<title>`,
  imagem → `media::thumbnail` → `data:image/webp` nos atributos; só http/https); `open_url` abre no navegador.
  Projeção `Block::Link` (título/descrição entram na busca); Markdown `[🔗 título](url)` e `keep_link_meta` no MCP.
- Emoji de capa: `emoji` no meta do Y.Doc → coluna `notes.emoji` (migração 8), `clean_emoji` no núcleo e `cleanEmoji`
  no front (`src/lib/emoji.ts`, mesma regra). Seletor `EmojiPicker.svelte` (lista do `emojibase-data` em português,
  carregada só ao abrir; nome antes das palavras-chave na busca). Sem emoji, não ocupa espaço (abre pelo ⋮).
- Ordem das categorias (`app.categorySort`, escolha do aparelho): Nome (padrão), Mais notas ou Manual (arrastar na
  lateral com o mouse ou "Mover para cima/baixo" no menu; `reorder_categories` grava `sort`, que vai no `categories.ydoc`).
  Lateral, pílulas e seletores usam a mesma lista (`app.categories`).
- Editor Markdown: títulos # ## ### (botão H escolhe o tamanho), citação, linha (---), `código`, ~~tachado~~ e tabela
  (`TableKit`; primeira linha = cabeçalho; linha/coluna pelo menu da alça). Colar Markdown (`MarkdownPaste` em
  `extensions.ts`) converte pelo núcleo (`markdown_to_doc` = o mesmo `markdown.rs` do MCP; no mock, `mock/markdown.ts`).
  Colar imagem: arquivos do clipboard, HTML só com imagem e, sem nada, `clipboard_image` (núcleo, PNG).
  ID curto da nota (`#` + 8 últimos caracteres, `noteid.ts`) no topo do editor e em "Copiar ID"; o MCP aceita (`full_id`).
- Menus de contexto na tela estreita: submenu toma o lugar do menu, com linha de voltar (`MenuList.svelte`).
- **Calendário e Kanban (0.4):** duas visões a mais dos lembretes (a mesma lista de Lembretes, `list_reminders`).
  Status do lembrete num seletor de três cores (`StatusToggle.svelte`; pedido do usuário: minimalista): vermelho = a fazer,
  amarelo = em andamento (`reminderDoing` no meta do Y.Doc → `notes.reminder_doing`, migração 9; só entra num estado novo
  se ligado, para `from_note` continuar determinístico), verde = concluído (`reminderDone`). Regra em `reminders::set_status`
  (verde num que se repete pula para a próxima e volta ao vermelho); UI em `src/lib/status.ts`. Calendário
  (`CalendarView.svelte`, `src/lib/calendar.ts`): mês/semana, próximas vezes dos que se repetem, arrastar muda o dia, "+" do
  dia (ou dois cliques, ou Enter) cria lembrete nele (`app.calDay` = dia escolhido; `app.newReminderAt`); setas mudam o dia,
  PageUp/PageDown o período, T volta a hoje; concluídos só com "Mostrar concluídos" (`app.showDone`, o mesmo de Lembretes);
  no celular, pontinhos, a lista do dia e arrastar o dedo para o lado muda o mês. Kanban (`KanbanView.svelte`): três
  colunas pelo status; o "+" de A fazer/Em andamento cria o lembrete já nesse status (`app.openNewInColumn`). Arrastar pelo ponteiro (`boarddrag.ts`, `data-drop`; toque: segurar 350 ms; perto da borda a área rola sozinha). MCP:
  `set_reminder_status`, `list_reminders` com `status`/`from`/`to`.
- **Status em qualquer nota (pedido do usuário):** nota com lembrete sempre tem status; sem lembrete, ganha pelo menu
  "Status" (card e ⋮ do editor) = `statusOn` no meta do Y.Doc → `notes.status_on` (migração 10; só entra num estado novo
  se ligado). Cores nas mesmas colunas `reminder_done`/`reminder_doing`. "Sem status" (`reminders::clear_status`, só
  para nota sem lembrete). Tirar o lembrete leva o status junto, a não ser que `statusOn` (`keepStatus`). Kanban =
  `list_board` (lembrete OU `status_on`); o "+" dele cria nota com status, sem lembrete (`app.openNewInColumn`). Card
  sem lembrete mostra a pílula do status. MCP: `set_reminder_status` vale para qualquer nota (+ `none`), `list_board`.
- Sync (0.4): notas e anexos sobem em paralelo (`Remote::upload_many`; no Drive, lote em paralelo e o que falha tenta de
  novo um por um), como já desciam. `adopt_order` só reposiciona as notas fora do lugar (`keep_most_positions`, maior
  subsequência crescente): antes, começar a arrastar numa ordem por data subia todas as notas.
- Título da nota é `textarea` que cresce (`autosize` no Editor): título longo quebra linha.
- Filtro "Sem categoria"/"Sem tags": sentinelas `NO_CATEGORY`/`NO_TAGS` (`~none`) no `Filter` (TS e Rust).
- **Card do Atrio (copiar e colar com o Nodo):** "Copiar como card" no menu da nota e ⌘C com uma nota marcada
  (`copyCard` em `menus.ts`); colar um card fora de campo de texto cria a nota (`App.svelte`). Núcleo:
  `Store::note_card` (corpo pelo mesmo `markdown.rs` do MCP) e `Store::create_from_card` (comandos `note_card` e
  `create_from_card`; cor desconhecida vira a padrão; etiquetas normalizadas). O `NoteCard` usa o `CardBody` do Atrio.
- **Fase 7 (Android, em andamento; prévia).** Projeto em `src-tauri/gen/android` (pacote `app.ideario`, via
  `tauri.android.conf.json`), compilado só no CI (job "APK (Android)"; aqui o SDK não baixa). APK assinado pela chave dos
  segredos (`ANDROID_KEYSTORE`, alias `ideario`; o SHA-1 vai no cliente OAuth "Android"). Login: a conta do aparelho pelo
  Google Play Services (`GoogleAuthPlugin.kt` + `sync/android.rs`), sem token de renovação; o sync vê os dois logins
  pelo trait `Login` (`service.rs`). Lembretes: `reminders::plan` agenda no sistema (plugin de notificação, alarme
  exato) o que está por vir; o app aberto refaz a agenda quando ela muda. Compartilhar → nota nova (`SharePlugin.kt`,
  `share.rs`, `share.svelte.ts`). Voltar = Esc (`backbutton.svelte.ts`). Ponte do Android é o `postMessage` (tudo em
  JSON): comandos binários aceitam o corpo cru ou lista de bytes (`body_bytes` em `commands.rs`). `data-platform="android"` no `<html>` esconde
  o que só existe no desktop (bandeja, Claude, backup em pasta, importar por arquivo). Arquivos (`FilesPlugin.kt` +
  `device.rs`): baixar vai para Downloads (MediaStore), exportar abre o Compartilhar do sistema, PDF pela impressão do
  sistema. Notificação com `ic_stat_ideario` (em cada aviso, `notify.rs`; `res/raw/keep.xml` impede o R8 de jogar o
  ícone fora, senão sai um genérico); tocar abre a nota: o plugin 2.7 não devolve o `extra`, só o número da
  notificação, que o núcleo troca pela nota (`reminders::remember_keys`/`note_for_key`, guardado em `sync_state`,
  30 dias; `SharePlugin.kt` manda `notification`, `share.rs` resolve). Ainda não: backup e importar do Keep no celular, widget.
- **Inglês e português (pedido do usuário: o app usado no mundo).** O idioma vem do Atrio (`t`, `tn`, `addMessages`,
  `setLocale`, `intlLocale`, 0.18.0): o texto em português do código é a chave; o inglês do Ideario está em
  `src/lib/i18n/en.ts` (registrado em `main.ts` antes de montar); o que vem das peças do Atrio é traduzido lá.
  Configurações → Aparência → **Idioma** (Automático segue o sistema: português para pt-*, inglês para o resto; fica no
  aparelho em `atrio.locale`). Textos em listas constantes são getters (`views.ts`, `NOTE_COLORS`, `STATUS`, ordens),
  nunca congelados no import; datas e ordem alfabética pelo `intlLocale()` (no inglês, a semana do Calendário usa o
  intervalo do `Intl`). Não traduzidos: mensagens do núcleo Rust e do mock, nomes de marca, conteúdo de exemplo.
  e2e: o navegador dos testes fica em `pt-BR`; `idioma` testa a troca para inglês.
