---
name: atrio-hub
description: Fluxo obrigatório para qualquer mudança em algo que o Ideario e o Nodo compartilham (o card, componentes, CSS/tokens, temas, regras de etiqueta/lembrete/status, Markdown da nota, anexos, formatos, área de transferência, atualizador, configurações, diálogos). Use ao corrigir ou criar qualquer coisa num dos apps que exista ou deva existir no outro — inclusive quando o usuário fala de um app só — e ao subir a versão do Atrio.
---

# Atrio é o hub

Regra do usuário: o que o Ideario e o Nodo têm em comum mora **só** no Atrio (`wylho/atrio`): componentes Svelte,
`atrio.css`, regras e formatos (TS em `src/`, Rust na crate `crates/atrio`). Os apps só usam. **O card é um só**:
não parecido, exatamente o mesmo nos dois (mesma prévia, regras, visual, comportamento). Plano e inventário do que
ainda falta unificar: `docs/UNIFICACAO.md` no Atrio.

## Antes de mexer: é do Atrio?
Pergunta: isto existe, ou deveria existir, no outro app? Se sim → Atrio. Sinais de que é do Atrio: card (miniatura,
card aberto, prévia, pílulas, capa), editor, cores/tokens/temas, menus, diálogos, toast, etiqueta/lembrete/status,
anexos (tipo, hash, nome, protocolo `att://`), Markdown ↔ documento, área de transferência, atualizador, folha de
Configurações (aparência, Claude), ajustes de janela. Bug visto num app numa peça do Atrio: corrige no Atrio, nunca
com remendo no app (nem CSS por cima).

Onde ficam (neste ambiente; podem mudar): Atrio `/home/user/atrio` (push no `main`), Ideario `/home/user/wylho/ideario`
(npm; branch de trabalho = branch padrão dele), Nodo `/home/user/mapist` (pnpm em `crates/nodo-app/ui`; branch de
trabalho **e** `main`). Repositório ausente: `add_repo` e clonar ao lado.

## O ciclo
1. **Teste primeiro no Atrio.** Regra TS: `tests/*.test.ts` (vitest; componente pelo harness, ex.
   `tests/NoteEditorHarness.svelte`). Regra Rust: teste na crate (proptest quando for propriedade). Provar que o
   teste pega o erro: desfazer a correção, ver falhar, refazer.
2. **Verificar o Atrio:** `pnpm run check`, `pnpm run test`; na crate `cargo fmt --all --check`,
   `cargo clippy --all-targets -- -D warnings`, `cargo test`.
3. **Versão:** `scripts/bump.sh X.Y.Z` (package.json + crate juntos). Atualizar "Estado atual" do `CLAUDE.md` do
   Atrio. Commit e push no `main`: o CI testa e cria a tag `vX.Y.Z` (daqui o proxy não empurra tag).
4. **Os dois apps juntos:** `scripts/apps-up.sh X.Y.Z` — espera a tag, troca a referência no npm/pnpm e no Cargo
   de cada app, instala. Nunca deixar um app numa tag velha: correção do Atrio que não chega aos dois não está pronta.
5. **Verificar cada app** pelo próprio CLAUDE.md:
   - Ideario: `npm run check`, `npm run test:e2e` (rodar em segundo plano, ~minutos), `cargo test` em `src-tauri`.
   - Nodo: `cargo fmt --all --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test --workspace`,
     `pnpm --dir crates/nodo-app/ui run check`, `pnpm --dir crates/nodo-app/ui run test`.
   - Mudança visual: prévia nos dois apps (claro, escuro, celular) antes de aplicar; mostrar ao usuário.
6. **Commit e push** nos dois apps, com "Estado atual" do CLAUDE.md de cada um atualizado (tag nova e o que mudou).
   Lançar versão só quando o usuário pedir.

## Armadilhas já vistas
- Vite pré-empacota o Atrio e quebra nos `.svelte.ts`: `optimizeDeps.exclude: ['@wylho/atrio']` nos dois apps.
- `cargo update -p atrio` mexe em outras dependências; para só resolver a tag nova use `cargo metadata` (o script já faz).
- Prévia do card: hoje o Ideario projeta o Y.Doc no Rust e o Nodo usa `previewFromMarkdown`; enquanto não houver uma
  só (`docs/UNIFICACAO.md`), toda regra de prévia muda nos dois lugares e com o mesmo teste.
- O mock/backend do navegador de cada app (Ideario `src/lib/api/mock`, Nodo `lib/preview.ts`) não pode reimplementar
  regra do Atrio: importar do Atrio.
- Falar com o usuário sempre em português.
