# Lançar uma versão

1. Suba a versão em `src-tauri/tauri.conf.json` (`"version"`). É ela que o atualizador compara, e vira a tag `vX.Y.Z`.
2. No GitHub: **Actions → Release → Run workflow** (no branch padrão).
3. O workflow compila os três sistemas num Release **rascunho**. Depois o job "Publicar" monta os repositórios
   apt/dnf e publica. Só então a versão vira o "último Release", de onde tudo se atualiza.

## Como cada um atualiza

| Instalação | Atualiza por | Onde está |
|---|---|---|
| Windows (`-setup.exe`/`.msi`), macOS (`.dmg`), Linux `.AppImage` | o próprio app: ao abrir, procura uma vez e mostra o aviso "Atualizar" | `src-tauri/src/updates.rs`, `src/lib/updates.svelte.ts`, `UpdateNotice.svelte` |
| Ubuntu/Debian pelo repositório | `sudo apt upgrade` | índices `apt-*` no Release; `https://ideario.pages.dev/apt` redireciona para lá |
| Fedora pelo repositório | `sudo dnf upgrade` | índices `rpm-*` no Release; `https://ideario.pages.dev/rpm` redireciona para lá |
| `.deb`/`.rpm` baixado à mão | baixando de novo | o app não se atualiza sozinho fora do AppImage |
| Android (`_android.apk`) | instalando o APK novo por cima (ou o Obtainium, que acompanha os Releases) | job `android` do Release |

- O atualizador lê `https://github.com/wylho/ideario/releases/latest/download/latest.json` (gerado pelo
  `tauri-action`) e só aceita pacotes assinados com a chave cuja parte pública está em `tauri.conf.json`
  (`plugins.updater.pubkey`). Os pacotes de atualização só são gerados no Release (`tauri.release.conf.json`).
- Repositórios Linux: `scripts/linux-repos.sh` gera os índices assinados com GPG; o site só tem a chave pública
  (`site/linux/ideario.asc` e `.gpg`), o `ideario.repo` do dnf e as regras de `site/_redirects`.

## Instalar pelo repositório

Ubuntu, Debian e derivados:

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

## Segredos do GitHub (Settings → Secrets and variables → Actions)

| Segredo | Para quê |
|---|---|
| `IDEARIO_GOOGLE_CLIENT_ID`, `IDEARIO_GOOGLE_CLIENT_SECRET` | login do Google (sync), ver `docs/GOOGLE_DRIVE.md` |
| `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | assinar as atualizações do app |
| `IDEARIO_GPG_PRIVATE_KEY` | assinar os repositórios apt/dnf |
| `ANDROID_KEYSTORE` (base64 do `.jks`), `ANDROID_KEYSTORE_PASSWORD` | assinar o APK (alias `ideario`). O SHA-1 dessa chave vai no cliente OAuth "Android" do Google Cloud (pacote `app.ideario`) |

**Guarde uma cópia das chaves fora do GitHub** (um gerenciador de senhas). O GitHub não deixa ler um segredo
depois de salvo. Sem a chave das atualizações, quem já instalou nunca mais recebe versão nova: teria de
reinstalar à mão um app com uma chave nova.
