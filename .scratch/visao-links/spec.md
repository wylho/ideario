Status: ready-for-human

# Visão Links (alternativa ao Raindrop)

Pedido do usuário (04/11/2026): uma visão do Ideario que mostra os links das notas, com filtros e jeitos de ver bem
planejados. Prévia aprovada em https://claude.ai/artifact/XzpoABoM62ay989yuZjuse (o usuário seguiu as recomendações e
pediu também filtrar e agrupar por tag; o status tem de ser o do card, sem nome nem desenho novo).

## O que é
- Uma visão a mais, **Links**, depois do Moodboard (`VIEWS` em `src/lib/views.ts`). É do Ideario: o Nodo não tem
  visões de lista. O cartão do link, o seletor de status e o card da nota vêm do Atrio.
- **O que entra:** os cartões de link (endereço colado numa linha) e os links na palavra (Ctrl+K), das notas ativas que
  passam no filtro de sempre (categoria e tags). Arquivadas e lixeira ficam de fora.
- **Uma linha por endereço** (sem `#trecho` e sem a barra do fim): o mesmo link em várias notas aparece uma vez, "em N
  notas". Um cartão vale mais que a palavra para título, descrição e imagem.
- **Tipo** pelo endereço (site e extensão): artigo, vídeo, áudio, imagem, documento, código.
- **Tags** de um link: as das notas onde ele está (manuais e #tags do texto) que passam no filtro.

## Interface
- Barra de cima (como Arquivos): Tipo (`FilterGroup`), Site, Mais filtros (Status, Origem: cartão ou palavra,
  Agrupar: data, tag, site, categoria), Ordenar (recentes, título, site) e Ver como (Cards, Lista, Títulos, Mural; fica
  no aparelho, `ideario.linksLayout`; Cards ao abrir). No celular, Site e Ver como entram no menu Mais filtros.
- Chips dos filtros da visão com ×. Tags dos links são clicáveis e mexem no filtro de sempre.
- **Status = o da nota**, no `StatusToggle` do Atrio (A fazer, Em andamento, Concluído). Link numa nota só: o
  seletor na linha. Em várias notas: "em N notas" e o card de cada nota (com o próprio status) no painel.
- Clique (ou Enter) abre o site; o olho (ou Espaço) abre a prévia: imagem, endereço, descrição, tags, o card de cada
  nota onde o link está, Abrir site e Copiar link.
- **+ da visão Links** = Salvar link: pede o endereço, cria a nota com o cartão na hora (status A fazer, categoria e
  tags do filtro) e a prévia da página (título, descrição, imagem) chega depois, em segundo plano.

## Núcleo e MCP
- `src-tauri/src/links.rs` (regras puras e testes), `Store::list_links`, `save_link`, `fill_link`; comandos
  `list_links` e `save_link` (a prévia num thread; depois `notes-synced` e `core-changed`).
- MCP: `list_links` (filtros kind, site, tag, status) e `save_link` (busca a prévia antes de gravar).
- Mock: `src/lib/api/mock/links.ts` (a mesma regra) e 5 notas de exemplo com links (pt e en).

## Ficou para depois
- Extensão do navegador, conferir links quebrados, guardar o ícone de cada site (hoje a letra do site), importar
  favoritos de um HTML exportado.
