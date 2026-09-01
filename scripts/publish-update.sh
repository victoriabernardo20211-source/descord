#!/usr/bin/env bash
# Publica uma versão nova do aplicativo no feed de atualização do servidor.
#
# Roda no computador que GEROU o instalador (Windows, via Git Bash, ou WSL) e
# copia os arquivos para o servidor por SSH. Publicar é cópia de arquivo: o
# feed é servido só para leitura, nada é enviado por HTTP.
set -euo pipefail

RELEASE_DIR="${RELEASE_DIR:-apps/desktop/release}"
SERVER="${NEXUS_SERVER:-}"
REMOTE_DIR="${NEXUS_UPDATES_DIR:-/opt/nexus/updates}"

if [ -z "$SERVER" ]; then
  echo "Defina NEXUS_SERVER, por exemplo: NEXUS_SERVER=root@100.119.135.125" >&2
  exit 1
fi

# `latest.yml` é o que o electron-updater lê para saber que há versão nova.
# Sem ele o instalador é apenas um arquivo parado no servidor.
for required in latest.yml; do
  if [ ! -f "$RELEASE_DIR/$required" ]; then
    echo "Não achei $RELEASE_DIR/$required." >&2
    echo "Gere o instalador antes: cd apps/desktop && pnpm release:windows" >&2
    exit 1
  fi
done

installer=$(ls -1 "$RELEASE_DIR"/Nexus-Setup-*.exe 2>/dev/null | head -1 || true)
if [ -z "$installer" ]; then
  echo "Não achei o instalador em $RELEASE_DIR." >&2
  exit 1
fi

echo "→ Publicando $(basename "$installer") em $SERVER:$REMOTE_DIR"
ssh "$SERVER" "mkdir -p '$REMOTE_DIR'"

# O instalador vai primeiro: se o latest.yml chegasse antes, um cliente que
# checasse nesse intervalo tentaria baixar um arquivo que ainda não existe.
scp "$installer" "$SERVER:$REMOTE_DIR/"
scp "$RELEASE_DIR/latest.yml" "$SERVER:$REMOTE_DIR/"

echo "✓ Publicado. Cada cliente aplica na próxima vez que fechar o Nexus."
