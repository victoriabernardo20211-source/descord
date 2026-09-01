#!/usr/bin/env bash
# Restauração do Nexus a partir de um backup gerado por scripts/backup.sh.
#
# Depois de restaurar, o servidor apaga automaticamente toda mensagem privada
# cujo expiresAt já passou — um backup nunca traz uma DM expirada de volta.
set -euo pipefail

DB_DUMP="${1:?uso: restore.sh <dump.sql.gz> [storage.tar.gz]}"
STORAGE_ARCHIVE="${2:-}"
COMPOSE_FILE="${COMPOSE_FILE:-infrastructure/docker/docker-compose.yml}"
COMPOSE="docker compose --env-file .env -f $COMPOSE_FILE"

# shellcheck disable=SC1091
set -a; . ./.env; set +a

echo "→ Parando o servidor (banco e redis seguem no ar)"
$COMPOSE stop server

echo "→ Restaurando o banco"
gunzip -c "$DB_DUMP" | $COMPOSE exec -T postgres \
  psql -U "${POSTGRES_USER:-nexus}" -d "${POSTGRES_DB:-nexus}"

if [ -n "$STORAGE_ARCHIVE" ]; then
  echo "→ Restaurando os arquivos"
  docker run --rm \
    -v nexus_storage-data:/data \
    -v "$(cd "$(dirname "$STORAGE_ARCHIVE")" && pwd)":/backup:ro \
    alpine sh -c "rm -rf /data/* && tar xzf /backup/$(basename "$STORAGE_ARCHIVE") -C /data"
fi

echo "→ Subindo o servidor (o purge de expiração roda na inicialização)"
$COMPOSE up -d server
$COMPOSE logs -f --tail 40 server
