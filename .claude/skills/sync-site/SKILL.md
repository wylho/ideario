---
name: sync-site
description: Mantém o site do Ideario (site/ em inglês e site/pt/ em português, publicado em ideario.pages.dev pelo Cloudflare Pages) e a página do GitHub (README.md em inglês e README.pt-BR.md) com o mesmo conteúdo e prints atualizados. Use ao mudar o texto ou os prints de um dos dois, ao lançar uma versão nova, ao mudar um recurso que aparece na página inicial, ou quando o usuário pedir para atualizar o site ou o README.
---

# Site e README sincronizados (inglês primeiro, português em cópia)

Pedido do usuário: **inglês é a língua do GitHub e do site**; o português fica como cópia numa subpágina. São quatro
textos com o **mesmo conteúdo** (mesmas seções, na mesma ordem, mesmas afirmações, mesmos prints de `site/img/*.webp`):

| | Inglês | Português |
|---|---|---|
| Site | `site/index.html` (`/`) | `site/pt/index.html` (`/pt/`) |
| GitHub | `README.md` | `README.pt-BR.md` |

Páginas legais: `site/privacidade/` + `site/privacy/` e `site/termos/` + `site/terms/` (português e inglês). As URLs em português (`/privacidade/`, `/termos/`)
**não mudam nunca** (a tela de consentimento do Google OAuth aponta para elas); elas guardam também a seção
`#english` antiga, para links velhos. O README só aponta para elas.

O site em inglês é a referência: mude primeiro `site/index.html`, depois leve a mesma mudança a `site/pt/index.html`,
`README.md` e `README.pt-BR.md`. Nunca deixe uma língua com algo que a outra não tem. Cada página tem a troca de
idioma (`.lang-link` no topo, "Português"/"English" no rodapé) apontando para a página equivalente, e os READMEs
apontam um para o outro na primeira linha.

## SEO (manter junto com o texto)

- **Palavras-chave no texto, com naturalidade** (títulos, primeiros parágrafos, `alt`), nunca uma lista solta no fim.
  Varie as formas; não repita a mesma expressão em toda frase.
- Cada página: um `<h1>`; `<title>` e `meta description` com as palavras principais (descrição até ~160 caracteres);
  `<html lang>` certo (`en` / `pt-BR`); `link rel="canonical"`; `hreflang` `en`, `pt-BR` e `x-default` (= inglês);
  Open Graph e Twitter card com imagem em URL absoluta (`og:image` = um print de `site/img`).
- **JSON-LD `SoftwareApplication`** no `<head>` das duas páginas iniciais (nome, descrição, sistemas, categoria,
  `offers` preço 0, `downloadUrl` = Releases do GitHub, `featureList`). Recurso novo ou sistema novo: atualizar aqui também.
- **`site/sitemap.xml`** lista todas as páginas com os `xhtml:link` de `hreflang`; página nova = entrada nova (nas duas
  línguas) e `lastmod` atualizado. **`site/robots.txt`** aponta para o sitemap.
- Validar: `python3 -c "import xml.etree.ElementTree as E; E.parse('site/sitemap.xml')"` e o JSON-LD com `json.loads`.
- `site/_redirects`: só acrescentar regras (as de `/apt` e `/rpm` servem os repositórios Linux).
- `site/googleb9f65d592b236440.html` é a verificação do Google: não apagar nem mover.
- O repositório não tem arquivo de licença: não chamar o Ideario de "open source"/"código aberto" (dizer grátis e
  com o código no GitHub) até o usuário escolher uma licença.

## Regra que não pode falhar: só dados fictícios

O repositório e o site são **públicos**. Os prints vêm da prévia do app com os dados de exemplo do mock
(`src/lib/api/mock/seed.ts`), que são inventados. Nunca:

- tirar print do app do usuário, de um backup dele ou de um Takeout real;
- pôr nos dados de exemplo nomes de clientes, empresas, cursos, saúde ou qualquer coisa da vida do usuário;
- publicar um print sem antes abrir cada imagem e ler tudo o que aparece nela (lateral, cards, anexos, e-mails).

Se aparecer algo que pareça real, pare e pergunte ao usuário antes de publicar.

## Quando o conteúdo muda

1. Edite `site/index.html` (inglês) e, com o mesmo conteúdo, `site/pt/index.html` (português). Os caminhos são
   absolutos (`/style.css`, `/img/...`), então valem nas duas pastas; os links do rodapé da página em português vão
   para `/pt/#...`.
2. Leve a mesma mudança a `README.md` (inglês) e `README.pt-BR.md` (português), na mesma ordem de seções. Diferenças
   permitidas:
   - no README as imagens usam caminhos relativos (`site/img/...`) e não há `loading`/`width` de layout;
   - o README termina com a parte de desenvolvimento ("Development" / "Para desenvolver"), só no README;
   - o comentário no topo do README fica.
3. Confira que as afirmações são verdadeiras no código (recurso existe, nome do botão igual ao da UI). Nada de
   prometer o que não existe; nada de botão de download sem um Release público para apontar.
4. Revise o SEO acima (título, descrição, JSON-LD, sitemap) se o que mudou é um recurso de destaque.

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
- Links internos (`/`, `/pt/`, `/privacy/`, `/privacidade/`, `/terms/`, `/termos/`), a troca de idioma em cada página e o do GitHub funcionando; as duas línguas em 1280 e 390 px.
- `git grep` por nomes que o usuário já pediu para não aparecerem, se ele tiver dito algum nesta conversa.

## Lançamento de versão

Ao lançar uma versão (workflow Release):

1. Atualize nos dois lugares o que mudou para quem usa (recursos novos, seção "E mais").
2. Se o Release for público, ponha o botão/link de download apontando para
   `https://github.com/wylho/ideario/releases/latest` no site (ao lado de "Ver no GitHub") e no README (no topo).
3. Refaça os prints se a interface mudou.
4. Um commit só com `site/` e `README.md` juntos. O Cloudflare Pages publica sozinho a partir do branch
   ligado a ele; o GitHub mostra o README na hora.
