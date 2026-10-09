# Ideario — app de notas local-first (Tauri 2 + Rust)

App estilo Google Keep, multiplataforma, rápido como um bloco de notas e com sync pelo Google Drive.
**Especificação completa: `docs/SPEC.md`. Leia antes de qualquer tarefa.** O protótipo de design está em `prototype/`.

## Regras do projeto
- **Local-first**: a UI lê e escreve só no SQLite local. Rede apenas em segundo plano. Nada de spinner para abrir nota ou lista.
- Notas, Lembretes, Arquivos e Moodboard são **visões do mesmo banco**. Não duplicar dados.
- Cada nota é um **Y.Doc** (Yjs/yrs). As colunas SQL são uma projeção derivada dele.
- Nunca sincronizar o arquivo SQLite. No Drive, um arquivo por nota e anexos endereçados por hash.
- Fotos sempre passam pelo pipeline: orientação EXIF, remoção de metadados, resize, WebP, miniatura, paleta e tom.
  Exceção: qualidade **Original** (escolha do usuário) não redimensiona nem recomprime (SPEC §7). Só fotos são comprimidas.
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
  Para regenerar: `npx tauri icon src-tauri/icons/source/icon-manifest.json` (e o `.icns` a partir de `macos.svg`).
- **Tipografia:** fonte do sistema em toda a UI, para parecer nativo (substitui Bricolage/Figtree/JetBrains Mono do protótipo).
  No Linux o núcleo lê a fonte do GNOME/KDE (`src-tauri/src/system_fonts.rs`); nos demais, `system-ui`.
- D3 e D5 continuam em aberto (SPEC §11).

## Estado atual
- **Fase 0 concluída.** Tauri 2 + Svelte 5 com porte visual do protótipo e dados de exemplo em memória.
- A UI só fala com `src/lib/api` (interface `Api`). Hoje ela é atendida por `src/lib/api/mock`, que faz o papel do núcleo
  Rust (projeção de trecho/checklist/capa, busca sem acento, escopos). Na Fase 1 a interface passa a chamar `invoke`,
  e o mock continua servindo o modo navegador (`npm run dev`) e os testes e2e.
- Layout responsivo (pedido do usuário: desktop primeiro): < 640 px = protótipo de celular; 640–959 px = gaveta + abas,
  largura total; ≥ 960 px = como o Google Keep: barra superior fixa (☰ e marca à esquerda; ações e visões ancoradas à direita, visões no canto; nuvem e campo de busca só crescem na folga, sem mover nada) e, abaixo, lateral (`NavList`)
  que recolhe para um trilho de ícones (o topo não se move), editor e configurações como diálogo central.
  Masonry é JS (`Masonry.svelte` + `estimateCard`), porque a WebKitGTK não equilibra `columns:` do CSS.
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
- Temas (`src/lib/palettes.ts`, `theme.svelte.ts`): Sistema (padrão; o núcleo lê destaque/esquema do GNOME, KDE, Windows,
  macOS em `src-tauri/src/system_theme.rs`), Ideario, Papel, Grafite, Floresta; claro/escuro/automático à parte.
- Mídia no editor (`src/lib/editor/media.ts`): fotos lado a lado (`imageRow`, 2–4, arrastar como no Gutenberg + botões na foto
  selecionada), anexos inline (`noteFile`: vídeo, áudio com player, documentos), gravador e câmera (`capture.svelte.ts`).
  A capa do card é a primeira foto ou a primeira linha de fotos. "+" em leque (`FabMenu`) com atalhos.
- Blocos (`src/lib/editor/blocks.ts`): cada nó de primeiro nível é um bloco, como no Notion. Alça ⋮⋮ no hover arrasta
  e abre o menu do bloco (`MenuAt`); itens de lista/checklist têm alça própria (reordenar como no Keep). Clique direito
  em foto/anexo abre o mesmo menu. Copiar/colar entre notas leva fotos e anexos. Anexos são sempre blocos do texto.
- Seleção múltipla (Notas): check no canto (hover), Ctrl/Shift+clique, retângulo com o mouse (`marquee.ts`), Ctrl+A, Esc;
  a barra superior vira `SelectionBar` com ações em lote e Desfazer.
- CI (`.github/workflows/build.yml`): verificação + instaladores de macOS (universal), Windows e Linux nos Artifacts.
- Menus de contexto: `ContextMenu.svelte` (clique direito, Shift+F10, toque longo) + itens em `src/lib/menus.ts`.
  O menu do navegador é bloqueado fora de campos de texto (`main.ts`). Ações com "Desfazer" no toast.
- Prévia dos cards: a projeção entrega `preview` (blocos na ordem do documento) e `label`; a UI não parseia o corpo.
- Tags: `tags` na nota guarda só as manuais; as `#tags` do corpo são derivadas na projeção (evita gravar tags pela metade
  durante o salvamento contínuo).
- Verificação: `npm run check`, `npm run test:e2e`, `npm run tauri build`.
- **Próximo passo: Fase 1 (núcleo local: SQLite, migrações, CRUD, FTS5).**
