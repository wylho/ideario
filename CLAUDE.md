# Ideário — app de notas local-first (Tauri 2 + Rust)

App estilo Google Keep, multiplataforma, rápido como um bloco de notas e com sync pelo Google Drive.
**Especificação completa: `docs/SPEC.md`. Leia antes de qualquer tarefa.** O protótipo de design está em `prototype/`.

## Regras do projeto
- **Local-first**: a UI lê e escreve só no SQLite local. Rede apenas em segundo plano. Nada de spinner para abrir nota ou lista.
- Notas, Lembretes, Arquivos e Moodboard são **visões do mesmo banco**. Não duplicar dados.
- Cada nota é um **Y.Doc** (Yjs/yrs). As colunas SQL são uma projeção derivada dele.
- Nunca sincronizar o arquivo SQLite. No Drive, um arquivo por nota e anexos endereçados por hash.
- Fotos sempre passam pelo pipeline: orientação EXIF, remoção de metadados, resize, WebP, miniatura, paleta e tom.
- Fidelidade visual ao protótipo (`prototype/index.css` tem os tokens). Fontes empacotadas, sem CDN.
- UI em **português do Brasil**. Código e identificadores em inglês.
- Trabalhar por fases (SPEC §10). Antes de começar uma fase, conferir as decisões pendentes (SPEC §11) e perguntar o que estiver em aberto.
- Ao fim de cada fase: compilar, rodar e verificar o critério "Pronto quando".

## Decisões tomadas
- **D1:** frontend em **Svelte 5 + Bits UI** (ícones `@lucide/svelte`, editor TipTap v3).
- **D2:** desktop primeiro (Windows, macOS, Linux); Android depois.
- D3, D4 e D5 continuam em aberto (SPEC §11).

## Estado atual
- **Fase 0 concluída.** Tauri 2 + Svelte 5 com porte visual do protótipo e dados de exemplo em memória.
- A UI só fala com `src/lib/api` (interface `Api`). Hoje ela é atendida por `src/lib/api/mock`, que faz o papel do núcleo
  Rust (projeção de trecho/checklist/capa, busca sem acento, escopos). Na Fase 1 a interface passa a chamar `invoke`,
  e o mock continua servindo o modo navegador (`npm run dev`) e os testes e2e.
- Tags: `tags` na nota guarda só as manuais; as `#tags` do corpo são derivadas na projeção (evita gravar tags pela metade
  durante o salvamento contínuo).
- Verificação: `npm run check`, `npm run test:e2e`, `npm run tauri build`.
- **Próximo passo: Fase 1 (núcleo local: SQLite, migrações, CRUD, FTS5).**
