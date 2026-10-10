# Ligar o sync com o Google Drive

O Ideario sincroniza pela pasta oculta do app no Google Drive de cada pessoa (`appDataFolder`, escopo
`drive.appdata`): o app só enxerga os arquivos que ele mesmo criou, e eles não aparecem na lista do Drive.

Para o login funcionar, o app precisa de um **cliente OAuth do Google** ("App para computador"). Ele entra na
compilação por duas variáveis: `IDEARIO_GOOGLE_CLIENT_ID` e `IDEARIO_GOOGLE_CLIENT_SECRET`. Sem elas, o app funciona
normalmente, só sem sync (as Configurações dizem isso).

Num app instalado o "segredo" do cliente não é secreto de verdade (qualquer um pode extraí-lo do executável); quem
protege o login é o PKCE. Mesmo assim, ele fica fora do repositório, nos segredos do GitHub.

## 1. Criar o projeto e ligar a API

1. Abra o [Google Cloud Console](https://console.cloud.google.com/) com a sua conta Google.
2. No seletor de projetos (no alto), **Novo projeto** → nome `Ideario` → **Criar**.
3. Com o projeto selecionado: **APIs e serviços → Biblioteca** → procure **Google Drive API** → **Ativar**.

## 2. Tela de consentimento (Google Auth Platform)

1. **APIs e serviços → Tela de permissão OAuth** (ou **Google Auth Platform**) → **Começar**.
2. **Informações do app:** nome `Ideario`, e-mail de suporte (o seu). **Público:** *Externo*. Contato: o seu e-mail.
3. Em **Acesso a dados → Adicionar ou remover escopos**, marque:
   - `.../auth/drive.appdata` (ver e gerenciar os dados de configuração do app no Google Drive)
   - `openid` e `.../auth/userinfo.email` (para mostrar qual conta está conectada)
4. Em **Público**, enquanto o app estiver em **Teste**, adicione o seu e-mail (e de quem mais for usar) em
   **Usuários de teste**.

> **Importante:** no modo *Teste*, o Google faz o login expirar a cada **7 dias** (o app pede para entrar de novo).
> Para não expirar, em **Público** clique em **Publicar app** (fica "Em produção"). Como os escopos acima não são
> sensíveis, não é preciso passar pela verificação do Google; no máximo aparece o aviso "app não verificado" na
> primeira vez (clique em *Avançado → Acessar Ideario*).

## 3. Criar o cliente OAuth

1. **Google Auth Platform → Clientes → Criar cliente**.
2. **Tipo de aplicativo: App para computador** (Desktop app). Nome: `Ideario desktop` → **Criar**.
3. Copie o **ID do cliente** (termina em `.apps.googleusercontent.com`) e a **Chave secreta do cliente**.

Não precisa cadastrar endereço de retorno: o app usa `http://127.0.0.1:<porta>`, que o Google aceita para clientes
de computador.

## 4. Pôr nos segredos do GitHub

No repositório: **Settings → Secrets and variables → Actions → New repository secret**:

| Nome | Valor |
|---|---|
| `IDEARIO_GOOGLE_CLIENT_ID` | o ID do cliente |
| `IDEARIO_GOOGLE_CLIENT_SECRET` | a chave secreta |

Os instaladores do workflow **Build** e do **Release** passam a sair com o sync ligado.

## 5. Compilar localmente (opcional)

```sh
IDEARIO_GOOGLE_CLIENT_ID=… IDEARIO_GOOGLE_CLIENT_SECRET=… npm run tauri build
```

## Como usar

Configurações → Sincronização → **Entrar com Google**. O navegador abre a página do Google; depois de permitir, a
aba diz "Pronto!" e o app começa a sincronizar. Faça o mesmo nos outros computadores, com a mesma conta.

- Sincroniza ao abrir, alguns segundos depois de editar, a cada minuto, ao voltar à janela e no "Sincronizar agora".
- Sem rede, tudo continua funcionando; as mudanças sobem quando a conexão voltar.
- **Sair** esquece o login (e o desfaz no Google); as notas continuam no computador.
- O token de renovação fica no Chaveiro (macOS), no Gerenciador de Credenciais (Windows) ou num arquivo legível só
  pelo usuário na pasta de dados do app (Linux).
