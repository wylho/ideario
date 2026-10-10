# Ideario no Claude (MCP)

O Ideario tem um servidor MCP embutido. Com ele, o Claude (Claude Desktop ou Claude Code) pode buscar, ler, criar e
organizar as suas notas, checklists, lembretes e anexos. Tudo continua no seu computador. O Claude conversa com o
próprio app, que grava no mesmo banco local; o Drive recebe as mudanças pelo sync do app, como se você tivesse feito.

- Funciona com o app **aberto ou fechado**. Com ele aberto, a mudança aparece na hora, até na nota que está aberta no editor.
- **Apagar manda para a Lixeira** (30 dias para restaurar). Apagar para sempre só funciona para notas que já estão na Lixeira.
- **Categorias com PIN ficam fora do alcance do Claude**: as notas delas não aparecem na busca e não podem ser lidas nem
  mudadas; a categoria não pode ser renomeada nem apagada pelo Claude. Categorias ocultas só aparecem pedindo por elas.

## Ligar

### Claude Desktop
Configurações → **Claude** → **Ligar**. Se o Claude Desktop estiver aberto, feche e abra de novo. O botão grava o
Ideario na configuração do Claude Desktop, sem mexer no resto. **Desligar** tira.

### Claude Code
Configurações → **Claude** mostra o comando pronto (o botão copia). Ele é assim, com o caminho do app neste computador:

```sh
claude mcp add --scope user ideario -- "/Applications/Ideario.app/Contents/MacOS/ideario" --mcp
```

### À mão (qualquer cliente MCP)
O servidor é o próprio executável com `--mcp`, falando MCP por stdin/stdout:

```json
{
  "mcpServers": {
    "ideario": { "command": "/caminho/do/ideario", "args": ["--mcp"] }
  }
}
```

Onde fica o executável:
- **macOS:** `/Applications/Ideario.app/Contents/MacOS/ideario`
- **Windows:** `C:\Program Files\Ideario\ideario.exe` (ou onde foi instalado)
- **Linux:** o caminho do `.AppImage`, ou `/usr/bin/ideario` no `.deb`

## O que dá para pedir

- "Quais lembretes estão atrasados?"
- "Cria uma lista de compras para o churrasco de sábado, com subitens por seção."
- "Marca o pão e o leite na lista do mercado."
- "Resume as minhas notas da categoria Trabalho desta semana."
- "Põe um lembrete toda segunda às 9h na nota da reunião."
- "Arquiva as notas de 2023 que não têm lembrete." (o Claude busca, mostra e arquiva)
- "Anexa o PDF ~/Downloads/contrato.pdf na nota do apartamento."

## Ferramentas

| Ferramenta | O que faz |
|---|---|
| `app_overview` | Data e hora de agora, contagens, categorias, tags, sync |
| `search_notes` | Busca (sem acento, por prefixo) e filtros: categoria, tag, Arquivo, Lixeira; ordem |
| `get_note` | A nota inteira: metadados e corpo em Markdown, mais os anexos |
| `create_note` | Nova nota: título, Markdown, categoria, tags, cor, fixada, lembrete |
| `update_note` | Muda título, corpo, categoria, tags, cor e fixada |
| `edit_note_text` | Troca um trecho do corpo sem mexer no resto |
| `append_to_note` | Acrescenta no fim (ou no começo) |
| `set_checklist_items` | Marca e desmarca itens pelo texto (marcar o pai marca os subitens) |
| `add_checklist_items` | Acrescenta itens (ou subitens de um item) |
| `remove_checklist_items` | Tira itens, ou todos os marcados |
| `move_note` | Notas ↔ Arquivo ↔ Lixeira (restaurar também) |
| `delete_note_forever` | Só para nota que já está na Lixeira |
| `empty_trash` | Esvazia a Lixeira |
| `duplicate_note`, `reorder_note` | Duplicar; mudar de lugar na ordem personalizada |
| `list_reminders`, `set_reminder`, `clear_reminder`, `complete_reminder`, `snooze_reminder` | Lembretes (com repetição) |
| `list_categories`, `create_category`, `update_category`, `delete_category` | Categorias (nome e cor) |
| `list_tags`, `rename_tag`, `delete_tag` | Tags, também as `#tags` escritas no texto |
| `list_attachments`, `get_attachment` | Anexos; fotos voltam como imagem, textos como texto |
| `attach_file`, `export_attachment` | Anexar um arquivo do computador; salvar uma cópia |
| `import_keep` | Importar o zip do Google Takeout |
| `export_note` | Exporta a nota em Markdown ou HTML (com anexos, um `.zip`) |
| `create_backup` | Backup local completo num arquivo `.ideario` (restaurar é no app) |

As ferramentas que só leem vêm marcadas como só leitura (`readOnlyHint`), e as que apagam como destrutivas. O Claude
Desktop usa isso para pedir (ou não) a sua confirmação.

## Formato do corpo (Markdown)

```markdown
Texto com **negrito** e *itálico*.

### Título de seção

- [ ] item do checklist
  - [x] subitem marcado
- marcador
1. numerado

![foto da praia](ideario://att/3f2a…)  ![outra](ideario://att/9b1c…)   ← lado a lado
[📎 contrato.pdf](ideario://att/77de…)
[🔗 Receita de pão](https://exemplo.com/pao)   ← cartão de link (bloco)

&nbsp;   ← linha em branco da nota
```

Um link sozinho na linha com 🔗 no começo do texto é um **cartão de link** (a prévia: título, descrição e imagem da
página; ao reescrever a nota, cartões que continuam com o mesmo endereço guardam a prévia). Os demais links, citação e
riscado viram texto. Ao reescrever uma nota, as linhas de fotos e anexos que
devem ficar precisam continuar no texto.

## Como funciona (para quem mexe no código)

- `src-tauri/src/main.rs`: `ideario --mcp` não abre janela; chama `mcp::serve()`.
- `src-tauri/src/mcp/mod.rs`: JSON-RPC (uma mensagem por linha), `initialize`, `tools/list`, `tools/call`.
- `src-tauri/src/mcp/tools.rs`: as ferramentas, sobre o mesmo `Store` do app.
- `src-tauri/src/markdown.rs`: nota ↔ Markdown. A ida e volta devolve a mesma nota (teste de propriedade).
- `src-tauri/src/ydoc.rs` (`patch_children`): a gravação no Y.Doc mexe só no que mudou. Marcar um item com a nota aberta
  no editor não recria o corpo; as duas edições se juntam.
- `src-tauri/src/mcp/watch.rs`: o app aberto olha o `PRAGMA data_version`. Quando outro processo grava, lê
  `external_changes` e emite `notes-synced` / `notes-removed` / `core-changed`, os mesmos eventos do sync.
- `src-tauri/src/mcp/setup.rs`: o botão das Configurações (a configuração do Claude Desktop e o comando do Claude Code).
- Testes: `cargo test mcp` (o protocolo e todas as ferramentas, num banco temporário) e o teste nativo "MCP:" em
  `tests/native/run.mjs` (outro processo mexe com o app aberto e a nota aberta).
