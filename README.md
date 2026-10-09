# Ideário

App de notas estilo Google Keep, local-first, com sync pelo Google Drive. Tauri 2 (Rust) + Svelte 5.
Especificação: [`docs/SPEC.md`](docs/SPEC.md). Protótipo de design: [`prototype/`](prototype/).

## Estado

**Fase 0 (esqueleto):** pronta. As quatro abas, a gaveta, o editor e as configurações reproduzem o protótipo
com dados de exemplo em memória (`src/lib/api/mock`). O editor já é TipTap.
O layout é responsivo: celular (< 640 px) igual ao protótipo; janela média com gaveta e abas embaixo;
desktop (≥ 960 px) com barra lateral fixa, grade de várias colunas e editor/configurações em janela central. Nada é gravado em disco ainda;
o SQLite chega na Fase 1.

## Requisitos

- Node 20+ e Rust estável (`rustup`).
- Dependências de sistema do Tauri: <https://v2.tauri.app/start/prerequisites/>
  (no Linux: `libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `libxdo-dev`, `libssl-dev`).

## Comandos

```sh
npm install

npm run tauri dev      # app desktop com recarga ao vivo
npm run tauri build    # instaladores em src-tauri/target/release/bundle/

npm run dev            # só a interface no navegador (http://localhost:1420), com os dados de exemplo
npm run check          # tipos (svelte-check)
npm run test:e2e       # testes de comportamento no Chromium (primeira vez: npx playwright install chromium)
```

## Estrutura

```
src/                      interface (Svelte 5 + Bits UI)
  App.svelte              casca: topo, abas, gaveta, editor, configurações
  app.css                 tokens e estilos portados de prototype/index.css
  components/             uma tela ou peça por arquivo
  lib/api/                camada de dados; hoje o mock, na Fase 1 os comandos Tauri
  lib/editor/             esquema do TipTap (imagem por hash, checklist, #tags)
  lib/app.svelte.ts       estado da UI e consultas reativas
src-tauri/                núcleo Rust (Tauri 2)
tests/e2e/                testes Playwright contra o mock
```

Atalhos no app: <kbd>Ctrl/Cmd</kbd>+<kbd>N</kbd> nota nova, <kbd>Ctrl/Cmd</kbd>+<kbd>F</kbd> busca, <kbd>Esc</kbd> fecha o editor.
