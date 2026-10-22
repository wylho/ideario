---
name: sync-site
description: Mantém o site do Ideario (site/, publicado em ideario.pages.dev pelo Cloudflare Pages) e a página do GitHub (README.md) com o mesmo conteúdo e prints atualizados. Use ao mudar o texto ou os prints de um dos dois, ao lançar uma versão nova, ao mudar um recurso que aparece na página inicial, ou quando o usuário pedir para atualizar o site ou o README.
---

# Site e README sincronizados

A página inicial do site (`site/index.html`) e o `README.md` contam a mesma coisa, com os mesmos prints
(`site/img/*.webp`). O site é a referência: mude primeiro o site, depois leve o mesmo conteúdo ao README.
As páginas `site/privacidade/` e `site/termos/` só existem no site (o README só aponta para elas).

## Regra que não pode falhar: só dados fictícios

O repositório e o site são **públicos**. Os prints vêm da prévia do app com os dados de exemplo do mock
(`src/lib/api/mock/seed.ts`), que são inventados. Nunca:

- tirar print do app do usuário, de um backup dele ou de um Takeout real;
- pôr nos dados de exemplo nomes de clientes, empresas, cursos, saúde ou qualquer coisa da vida do usuário;
- publicar um print sem antes abrir cada imagem e ler tudo o que aparece nela (lateral, cards, anexos, e-mails).

Se aparecer algo que pareça real, pare e pergunte ao usuário antes de publicar.

## Quando o conteúdo muda

1. Edite `site/index.html` (português primeiro; a seção `#english` resume em inglês).
2. Leve a mesma mudança ao `README.md`, na mesma ordem de seções. Diferenças permitidas:
   - no README as imagens usam caminhos relativos (`site/img/...`) e não há `loading`/`width` de layout;
   - o README termina com "Para desenvolver" (só no README);
   - o comentário no topo do README fica.
3. Confira que as afirmações são verdadeiras no código (recurso existe, nome do botão igual ao da UI). Nada de
   prometer o que não existe; nada de botão de download sem um Release público para apontar.

## Como os prints devem ser (pedido do usuário)

- **A tela cheia de conteúdo, nunca o app vazio.** Os cards preenchem a tela: vários cards com prévia de verdade
  (lista de tarefas, foto de capa, etiquetas, status, lembrete), como o print do Nodo que o usuário aprovou em 22/10
  (mapa "Lançamento do app" a 90%, cards com emoji, tarefas, #etiquetas e status ocupando a tela, claro e escuro).
- **No recorte estreito (o que parece celular), dar zoom nos cards.** Sem medo de aproximar: o card tem de ocupar o
  recorte, não ficar perdido num fundo vazio.
- Sempre claro e escuro; dados fictícios; olhar cada imagem inteira antes de publicar.

## Quando os prints precisam mudar

```sh
npm run build && node scripts/site-shots.mjs
```

O script sobe a prévia, fixa o relógio às 10h e salva os prints em WebP em `site/img`. Para um print novo, acrescente
uma chamada `shot(...)` no script (não tire à mão). Depois **abra cada imagem** (reduzida, se preciso) e leia tudo.

## Verificar antes de publicar

- Sirva a pasta: `cd site && python3 -m http.server 8770` e tire prints com o Playwright em 1280×800 (claro e
  escuro) e 390×844; `document.documentElement.scrollWidth` tem que ser igual à largura (sem rolagem lateral).
- Links internos (`/privacidade/`, `/termos/`, `#english`) e o do GitHub funcionando.
- `git grep` por nomes que o usuário já pediu para não aparecerem, se ele tiver dito algum nesta conversa.

## Lançamento de versão

Ao lançar uma versão (workflow Release):

1. Atualize nos dois lugares o que mudou para quem usa (recursos novos, seção "E mais").
2. Se o Release for público, ponha o botão/link de download apontando para
   `https://github.com/wylho/ideario/releases/latest` no site (ao lado de "Ver no GitHub") e no README (no topo).
3. Refaça os prints se a interface mudou.
4. Um commit só com `site/` e `README.md` juntos. O Cloudflare Pages publica sozinho a partir do branch
   ligado a ele; o GitHub mostra o README na hora.
