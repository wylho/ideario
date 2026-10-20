<!-- Mesmo conteúdo da página inicial do site (site/index.html). Ao mudar um, mude o outro: skill /sync-site. -->

<p align="center">
  <img src="public/favicon.svg" width="88" height="88" alt="Ícone do Ideario">
</p>

<h1 align="center">Ideario</h1>

<p align="center"><b>Organize sua vida em notas.</b><br>
Notas, lembretes, calendário e kanban num lugar só: você escreve uma vez e vê do jeito que precisar. Abre num instante,
funciona sem internet e guarda tudo no seu computador. Se quiser, sincroniza pelo seu próprio Google Drive.</p>

<p align="center"><a href="#novidades-da-versão-04"><b>Novo na versão 0.4: calendário, kanban e um ícone novo →</b></a></p>

<p align="center">
  <b>Windows · macOS · Linux · Android</b><br>
  <a href="#baixar"><b>Baixar</b></a> ·
  <a href="https://ideario.pages.dev">ideario.pages.dev</a> ·
  <a href="https://ideario.pages.dev/privacidade/">Privacidade</a> ·
  <a href="#english">English</a> ·
  <a href="https://github.com/sponsors/wylho">♥ Apoiar</a>
</p>

<picture>
  <source srcset="site/img/notas-escuro.webp" media="(prefers-color-scheme: dark)">
  <img src="site/img/notas.webp" alt="Tela principal do Ideario: notas coloridas em cards, com checklists, fotos, lembretes e categorias na lateral">
</picture>

## Uma nota, seis jeitos de ver

Tudo começa numa nota. O resto são visões dela, e nada é copiado: mudou num lugar, mudou em todos. Categorias e tags
filtram qualquer visão.

| | |
|---|---|
| **Notas** | Cards coloridos, fixados no topo, na ordem que você arrastar. |
| **Lembretes** | O que vence hoje, amanhã e depois, com o que ficou atrasado em cima. |
| **Calendário** | Cada lembrete no seu dia, por mês ou por semana. |
| **Kanban** | A fazer, em andamento e concluído, em três colunas. |
| **Arquivos** | PDFs, áudios, vídeos e documentos de todas as notas, com leitor de PDF. |
| **Moodboard** | Todas as fotos num mural, com a paleta de cores de cada uma. |

## Novidades da versão 0.4

- **Calendário:** os lembretes no dia de cada um, por mês ou semana; arraste para mudar o dia.
- **Kanban:** a fazer, em andamento e concluído; arraste o card entre as colunas.
- **Status em três cores** em todo lembrete: vermelho, amarelo e verde, também pelo Claude.
- **Ícone novo.**
- **Sincronização mais rápida:** as notas sobem para o Drive em paralelo, e mudar a ordem só envia o que mudou.
- Títulos longos quebram linha, e a busca fica sempre no mesmo lugar da barra.

Na 0.4.1: o ícone novo com as cores limpas (sem a borda azul que aparecia no macOS).

<details>
<summary>Versões anteriores</summary>

**0.3:** editor com títulos, citações, código e tabelas; colar Markdown e prints direto na nota; um ID curto em cada nota
para falar dela com o Claude.

**0.2:** Android (prévia); categorias em ordem de nome, de número de notas ou do seu jeito; lateral que vira pílulas; a
janela lembra o tamanho; sincronização em lotes, com a ordem dos cards indo junto.
</details>

Quem já usa recebe sozinho: o app avisa ao abrir. Todas as versões estão em
[Releases](https://github.com/wylho/ideario/releases).

## Tudo numa nota só

Texto, checklist, fotos lado a lado, PDFs, áudio e vídeo convivem na mesma nota, cada um como um bloco que você
arrasta para onde quiser.

- Checklists com subitens em vários níveis; marcar um item marca os de dentro
- Grave áudio ou tire foto sem sair da nota
- Títulos, citações e tabelas; cole Markdown e ele já vira formatação
- Cole um print direto na nota
- Cole um link e ele vira um cartão com título e imagem
- Um emoji grande de capa para achar a nota de longe

<img src="site/img/nota.webp" alt="Nota aberta com três fotos lado a lado, um checklist e um PDF anexado">

## Lembretes que avisam de verdade

Notificação do sistema na hora certa, com Adiar e Concluir. Lembretes que se repetem todo dia, semana, mês ou ano.
Se o computador estava desligado, o Ideario avisa o que passou assim que abrir. Cada lembrete tem um status em três
cores: vermelho (a fazer), amarelo (em andamento) e verde (concluído).

<img src="site/img/lembretes.webp" alt="Lista de lembretes agrupada em atrasados, hoje, amanhã e próximos">

## Calendário

Os mesmos lembretes, no dia de cada um, por mês ou por semana. Arraste para outro dia e a data muda (a hora fica);
toque no + de um dia para criar um lembrete nele. Os que se repetem já mostram as próximas vezes.

<img src="site/img/calendario.webp" alt="Calendário do mês com os lembretes em cada dia, coloridos pelo status">

## Kanban

A fazer, em andamento e concluído, em três colunas. Arraste o card de uma coluna para outra ou toque no seletor de
cores dele. Tudo isso também pelo Claude.

<img src="site/img/kanban.webp" alt="Kanban com os lembretes em três colunas: a fazer, em andamento e concluído">

## Moodboard das suas fotos

Todas as imagens de todas as notas num mural só, com a paleta de cores de cada uma. Filtre por tom e encontre aquela
referência sem lembrar em que nota ela estava.

<img src="site/img/moodboard.webp" alt="Moodboard com as imagens das notas em mosaico e a paleta de cores de cada uma">

## Quando a nota cresce, vira documento

Um clique e a nota abre em página inteira, com coluna de leitura. Exporte em Markdown, HTML ou PDF, com as fotos e
anexos juntos.

<img src="site/img/documento.webp" alt="Nota aberta no modo documento, em página inteira">

## Funciona com o Claude

Ligue o Ideario no Claude Desktop ou no Claude Code com um clique e peça: “cria uma lista de compras”, “marca o leite
como comprado”, “o que eu anotei sobre a viagem?”. O Claude fala com o Ideario direto do seu computador, sem servidor
nosso no meio, e as categorias protegidas por PIN ficam de fora. Cada nota tem um ID curto (#a1b2c3d4): copie e diga
“na nota #a1b2c3d4, monta uma tabela com os gastos”. Guia: [`docs/MCP.md`](docs/MCP.md).

<img src="site/img/claude.webp" alt="Configurações do Ideario com a sincronização do Google Drive e o botão para ligar no Claude Desktop">

## Do tamanho que a janela estiver

Janela grande, lateral com categorias e tags; feche a lateral e as categorias viram pílulas acima das notas.
Janela estreita, o layout se ajusta, com as visões numa barra embaixo. Tema claro, escuro ou o do sistema, com as
cores de destaque do seu Windows, macOS ou Linux.

<p align="center"><img src="site/img/janela-estreita.webp" width="300" alt="O Ideario numa janela estreita, com as notas em duas colunas e a barra de visões embaixo"></p>

## E mais

| | |
|---|---|
| **Várias de uma vez** | Selecione notas com o mouse, Ctrl ou Shift e mude a cor, a categoria ou arquive todas juntas, com Desfazer. |
| **Clique direito em tudo** | Cards, lembretes, arquivos e categorias têm menu próprio, no clique direito ou no toque longo. |
| **Sync pelo seu Drive** | Numa pasta oculta do app no seu Google Drive, entre computadores e o celular, até a ordem dos cards. Sem servidor no meio, sem conta nova. |
| **Categorias com PIN** | Esconda uma categoria inteira das listas e da busca, e peça um PIN para abrir. Ordene por nome, por número de notas ou arrastando. |
| **Vem do Google Keep?** | Solte o arquivo do Google Takeout e as notas entram com fotos, cores, marcadores e datas. |
| **Backup local** | Um arquivo com tudo, quando quiser ou toda semana. Restaurar junta com o que já existe. |
| **Busca rápida** | Sem acento, por pedaço de palavra, em milhares de notas, no instante em que você digita. |
| **Fotos leves** | Fotos reduzidas e sem localização por padrão. Quer a original? Uma opção nas configurações. |

<a id="baixar"></a>

## Baixar

Grátis. Os instaladores ficam na página de [versões do GitHub](https://github.com/wylho/ideario/releases/latest).
Depois de instalado, o Ideario se atualiza sozinho.

| | |
|---|---|
| **Windows** | Baixe o `-setup.exe` e instale. Quando sair versão nova, o app avisa ao abrir. |
| **macOS** | Baixe o `.dmg` (Apple Silicon e Intel). Na primeira vez, clique com o botão direito no app e escolha **Abrir**: ele ainda não é assinado pela Apple. |
| **Android** (prévia) | Baixe o `_android.apk` no celular e abra; o Android pede para permitir instalar apps dessa fonte. Lembretes avisam com o app fechado; compartilhe de outro app para criar uma nota. Para atualizar, instale o novo por cima ou use o Obtainium. |

<a id="linux"></a>

**Linux.** Pelo repositório, o Ideario atualiza junto com o resto do sistema. Ubuntu, Debian e derivados:

```sh
curl -fsSL https://ideario.pages.dev/linux/ideario.gpg | sudo tee /usr/share/keyrings/ideario.gpg > /dev/null
echo "deb [signed-by=/usr/share/keyrings/ideario.gpg] https://ideario.pages.dev/apt stable main" | sudo tee /etc/apt/sources.list.d/ideario.list
sudo apt update && sudo apt install ideario
```

Fedora:

```sh
sudo curl -fsSL -o /etc/yum.repos.d/ideario.repo https://ideario.pages.dev/linux/ideario.repo
sudo dnf install ideario
```

Ou baixe o `.AppImage`, que roda em qualquer distribuição e também se atualiza sozinho.

**Privacidade:** sem anúncios, sem rastreamento, sem coleta de dados. Suas notas ficam no seu computador e, se você
quiser, no seu Google Drive. Leia a [Política de Privacidade](https://ideario.pages.dev/privacidade/) e os
[Termos de Serviço](https://ideario.pages.dev/termos/).

---

<a id="english"></a>

## Ideario, in English

Ideario is a free app to organize your life in notes, for Windows, macOS and Linux, with an Android preview. Notes,
reminders, a calendar and a kanban board are views of the same notes. It opens instantly, works offline and keeps your
notes on your computer. Optionally, it syncs between your computers and phone through your own Google Drive, in a hidden
app folder. There is no Ideario server and no data collection.

- Notes with checklists, tables, headings and quotes (paste Markdown or a screenshot), side-by-side photos, PDFs, audio, video, link cards and a big cover emoji
- Reminders with system notifications, snooze and repeat, a three-color status, a calendar and a kanban board
- Files view with a built-in PDF reader, and a moodboard of all your images, filterable by color
- Document mode and export to Markdown, HTML or PDF
- Works with Claude (Desktop and Code) through a local MCP server
- Multi-select with batch actions, PIN-protected categories (sorted by name, note count or by hand), Google Keep import, local backups
- New in 0.4: calendar, kanban, three-color reminder status, a new icon and faster sync
- Updates itself (Windows, macOS, AppImage) or through the apt/dnf repository on Linux

[Download the latest version](https://github.com/wylho/ideario/releases/latest) · [Website](https://ideario.pages.dev) · [Sponsor ♥](https://github.com/sponsors/wylho) · [Privacy Policy](https://ideario.pages.dev/privacidade/#english) ·
[Terms of Service](https://ideario.pages.dev/termos/#english)

---

## Para desenvolver

Tauri 2 (Rust) + Svelte 5. Especificação: [`docs/SPEC.md`](docs/SPEC.md). Protótipo de design: [`prototype/`](prototype/).

**Requisitos:** Node 20+ e Rust estável (`rustup`), mais as
[dependências de sistema do Tauri](https://v2.tauri.app/start/prerequisites/) (no Linux: `libwebkit2gtk-4.1-dev`,
`libayatana-appindicator3-dev`, `librsvg2-dev`, `libxdo-dev`, `libssl-dev`).

```sh
npm install

npm run tauri dev      # app desktop com recarga ao vivo
npm run tauri build    # instaladores em src-tauri/target/release/bundle/

npm run dev            # só a interface no navegador (http://localhost:1420), com dados de exemplo fictícios
npm run check          # tipos (svelte-check)
npm run test:e2e       # testes de comportamento no Chromium
cd src-tauri && cargo test
```

Sync com o Google Drive: [`docs/GOOGLE_DRIVE.md`](docs/GOOGLE_DRIVE.md). Site: pasta [`site/`](site/) (Cloudflare
Pages); prints em `site/img`, refeitos com `npm run build && node scripts/site-shots.mjs`.

Atalhos: <kbd>Ctrl/Cmd</kbd>+<kbd>N</kbd> nota nova, <kbd>Ctrl/Cmd</kbd>+<kbd>F</kbd> busca, <kbd>Esc</kbd> fecha o editor.
