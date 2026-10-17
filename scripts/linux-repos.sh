#!/usr/bin/env bash
# Monta os índices dos repositórios APT (Ubuntu, Debian) e RPM (Fedora) do Ideario a partir dos pacotes de um
# Release, assinados com a chave GPG do repositório (a pública fica em site/linux/).
#
#   scripts/linux-repos.sh <pasta com os .deb e .rpm> <pasta de saída>
#
# A saída sobe para o mesmo Release, com prefixo no nome (apt-InRelease, rpm-repomd.xml…). O site redireciona
# /apt/* e /rpm/* para os arquivos do último Release (site/_redirects): os pacotes não passam pelo site e nenhum
# lançamento precisa mexer no repositório. Quem instalou pelo repositório atualiza no `apt upgrade`/`dnf upgrade`.
set -euo pipefail

src=$(realpath "$1")
out=$(realpath -m "$2")
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$out" "$work/apt" "$work/rpm"

# APT, no formato padrão (deb … stable main): dists/stable/{InRelease,Release,Release.gpg} e o Packages de
# main/binary-amd64; os .deb ficam em pool/ (que o site redireciona para os arquivos do Release).
cp "$src"/*.deb "$work/apt/"
(
  cd "$work/apt"
  bin=dists/stable/main/binary-amd64
  mkdir -p "$bin"
  apt-ftparchive packages . | sed 's#^Filename: \./#Filename: pool/#' > "$bin/Packages"
  gzip -9nk "$bin/Packages"
  apt-ftparchive \
    -o APT::FTPArchive::Release::Origin=Ideario \
    -o APT::FTPArchive::Release::Label=Ideario \
    -o APT::FTPArchive::Release::Suite=stable \
    -o APT::FTPArchive::Release::Codename=stable \
    -o APT::FTPArchive::Release::Architectures=amd64 \
    -o APT::FTPArchive::Release::Components=main \
    -o APT::FTPArchive::Release::Description="Ideario" \
    release dists/stable > Release
  mv Release dists/stable/Release
  gpg --batch --yes --clearsign -o dists/stable/InRelease dists/stable/Release
  gpg --batch --yes --armor --detach-sign -o dists/stable/Release.gpg dists/stable/Release
  for f in InRelease Release Release.gpg; do cp "dists/stable/$f" "$out/apt-$f"; done
  for f in Packages Packages.gz; do cp "$bin/$f" "$out/apt-$f"; done
)

# RPM: repodata com nomes fixos (primary.xml.gz…), com o repomd.xml assinado (repo_gpgcheck no ideario.repo).
cp "$src"/*.rpm "$work/rpm/"
createrepo_c --simple-md-filenames --general-compress-type=gz --no-database "$work/rpm" > /dev/null
gpg --batch --yes --armor --detach-sign -o "$work/rpm/repodata/repomd.xml.asc" "$work/rpm/repodata/repomd.xml"
for f in "$work"/rpm/repodata/*; do cp "$f" "$out/rpm-$(basename "$f")"; done

ls "$out"
