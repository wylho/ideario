# Ideario — app de notas local-first (Tauri 2 + Rust)

App estilo Google Keep, multiplataforma, rápido como um bloco de notas e com sync pelo Google Drive.
**Especificação completa: `docs/SPEC.md`. Leia antes de qualquer tarefa.** O protótipo de design está em `prototype/`.

## Regras do projeto
- **Local-first**: a UI lê e escreve só no SQLite local. Rede apenas em segundo plano. Nada de spinner para abrir nota ou lista.
- Notas, Lembretes, Arquivos e Moodboard são **visões do mesmo banco**. Não duplicar dados.
- Cada nota é um **Y.Doc** (Yjs/yrs). As colunas SQL são uma projeção derivada dele.
- Nunca sincronizar o arquivo SQLite. No Drive, um arquivo por nota e anexos endereçados por hash.
- Fotos sempre passam pelo pipeline: orientação EXIF, remoção de metadados, resize, WebP, miniatura, paleta e tom.
  Exceção: qualidade **Original** (escolha do usuário) fica intacta, inclusive com GPS e demais metadados (SPEC §7). Só fotos são comprimidas.
- Fidelidade visual ao protótipo (`prototype/index.css` tem os tokens), exceto a tipografia: fonte do sistema, nunca CDN.
- UI em **português do Brasil**. Código e identificadores em inglês.
- Trabalhar por fases (SPEC §10). Antes de começar uma fase, conferir as decisões pendentes (SPEC §11) e perguntar o que estiver em aberto.
- Ao fim de cada fase: compilar, rodar e verificar o critério "Pronto quando".

## Decisões tomadas
- **D1:** frontend em **Svelte 5 + Bits UI** (ícones `@lucide/svelte`, editor TipTap v3).
- **D2:** desktop primeiro (Windows, macOS, Linux); Android depois.
- **D4:** nome **Ideario** (sem acento).
- **Ícone oficial:** quadrado arredondado com degradê amarelo→laranja (`src-tauri/icons/source/ideario.svg`; também
  `BrandMark.svelte` e `public/favicon.svg`). Android: adaptativo (frente/fundo) e o quadrado sem arredondamento
  (`ideario-full-bleed.svg`), que o sistema corta no formato dele (o redondo é esse quadrado cortado em círculo, sem margem); macOS: versão com margem da grade da Apple (`macos.svg`).
  Bandeja/barra de menus: só o desenho de dentro, monocromático (`source/tray.svg` → `tray-dark.png`/`tray-light.png` por
  `source/tray-png.py`): template no macOS, branco ou preto no Linux conforme o painel, colorido no Windows.
  Para regenerar: `npx tauri icon src-tauri/icons/source/icon-manifest.json` (e o `.icns` a partir de `macos.svg`).
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
- **Backup local:** manual ("Fazer backup agora") + automático semanal numa pasta escolhida, guardando os 4 últimos.
  Restaurar **junta** com o que existe (como o sync), nada se perde.

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
  largura total; ≥ 960 px = como o Google Keep: barra superior fixa (☰ e marca à esquerda; ações e visões ancoradas à direita, visões no canto; nuvem e campo de busca só crescem na folga, sem mover nada) e, abaixo, lateral (`NavList`)
  que recolhe para um trilho de ícones (o topo não se move), editor e configurações como diálogo central.
  Masonry é JS (`Masonry.svelte` + `estimateCard`), porque a WebKitGTK não equilibra `columns:` do CSS. Cada card é
  posicionado por coordenadas numa lista só (nunca é recriado ao redimensionar ou reordenar; só desliza). O arraste
  (`drag.svelte.ts`) acha o card sob o ponteiro pela posição final (`data-x`/`data-y`), não pela animada, e só troca de
  novo depois que o ponteiro anda 12 px (senão os cards tremem). Sonda no app nativo: `tests/native/probe-grid.mjs`.
- Princípio de design: só mostrar o que tem motivo para aparecer (ex.: nuvem do sync só ao sincronizar, sem
  conexão ou com erro; nada de controles que ainda não funcionam).
- Navegação (proposta A): `app.view` (como ver) e `app.filter` (categoria + tags, o que ver) são independentes; `app.box`
  = active/archive/trash só na visão Notas. Seletor de visão: no desktop no canto direito da barra superior (busca é ícone ao lado), no celular barra flutuante (pílula) embaixo; número só em Lembretes (`app.counts`).
- Barra superior = ☰ + marca | **menu dinâmico** (`ViewActions.svelte`) | visões. O menu dinâmico tem tudo o que depende
  da visão ou do lugar, sempre na mesma ordem e com os mesmos componentes: filtro da visão (`FilterGroup`: ícones no
  desktop, um menu no celular) → ordenar (`SortMenu`) → lista/grade (`LayoutToggle`). Lembretes: mostrar concluídos;
  Lixeira: ícone de esvaziar (vassoura, neutro, com confirmação, só quando há notas). Nada de controles soltos no meio do conteúdo.
- Contorno: tudo o que é card ou miniatura (cards, listas de lembretes/arquivos, miniaturas, moodboard, fotos no
  editor, blocos das configurações) usa o mesmo `--card-edge` translúcido; `--line` fica para controles e separadores.
- Barra de título (macOS/Windows) e fundo da janela acompanham o claro/escuro do app (`theme.svelte.ts` → `setTheme`,
  `setBackgroundColor`); a escolha fica no núcleo (`set_window_look`) e a janela já nasce com ela (`lib.rs`).
- Temas (`src/lib/palettes.ts`, `theme.svelte.ts`): Sistema (padrão; o núcleo lê destaque/esquema do GNOME, KDE, Windows,
  macOS em `src-tauri/src/system_theme.rs`), Ideario, Papel, Grafite, Floresta; claro/escuro/automático à parte.
- Mídia no editor (`src/lib/editor/media.ts`): fotos lado a lado (`imageRow`, 2–4, arrastar como no Gutenberg + botões na foto
  selecionada), anexos inline (`noteFile`: vídeo, áudio com player, documentos), gravador e câmera (`capture.svelte.ts`).
  A capa do card é a primeira foto ou a primeira linha de fotos. Arquivos arrastados do computador (`FileDrop.svelte`; no app
  pelo evento nativo do Tauri, com o caminho, lido no núcleo por `import_path`; no navegador, drop do HTML): com nota
  aberta entram nela (no ponto do texto ou no fim); sem nota aberta viram nota nova.
- Linux: a WebKitGTK vem com microfone/câmera desligados; `lib.rs` (`linux_media`) liga e aceita os pedidos de áudio e
  vídeo. O AppImage leva o GStreamer (`bundleMediaFramework`), senão não há player nem gravador. "+" em leque (`FabMenu`) com atalhos.
- Blocos (`src/lib/editor/blocks.ts`): cada nó de primeiro nível é um bloco, como no Notion. Uma alça ⋮⋮ só, no hover,
  colada ao que está sob o ponteiro (`blockAt` usa x e y): arrasta e abre o menu (`MenuAt`). Em lista/checklist ela é do
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
- Release: `.github/workflows/release.yml` (Actions → Release → Run workflow; precisa estar no branch padrão).
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
- Pedidos do usuário para a fase certa: emoji grande de capa na nota; arrastar card até categoria da lateral; baixar em
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
- **Fase 5 (concluída no código): sync com o Google Drive** (`src-tauri/src/sync/`; detalhes em SPEC §6). Pasta oculta
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
  stdin/stdout sobre o mesmo `Core`/banco, com 32 ferramentas. O corpo entra e sai em Markdown (`markdown.rs`; ida e volta
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
- Filtro "Sem categoria"/"Sem tags": sentinelas `NO_CATEGORY`/`NO_TAGS` (`~none`) no `Filter` (TS e Rust).
- **Próximo passo: Fase 7 (Android).**
