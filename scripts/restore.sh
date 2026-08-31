#!/usr/bin/env bash
# Restauração do Nexus a partir de um backup gerado por scripts/backup.sh.
#
# Depois de restaurar, o servidor apaga automaticamente toda mensagem privada
# cujo expiresAt já passou — um backup nunca traz uma DM expirada de volta.
set -euo pipefail

DB_DUMP="${1:?uso: restore.sh <dump.sql.gz> [storage.tar.gz]}"
STORAGE_ARCHIVE="${2:-}"
COMPOSE_FILE="${COMPOSE_FILE:-infrastructure/docker/docker-compose.yml}"

echo "→ Parando o servidor (banco e redis seguem no ar)"
docker compose -f "$COMPOSE_FILE" stop server

echo "→ Restaurando o banco"
gunzip -c "$DB_DUMP" | docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U "${POSTGRES_USER:-nexus}" -d "${POSTGRES_DB:-nexus}"

if [ -n "$STORAGE_ARCHIVE" ]; then
  echo "→ Restaurando os arquivos"
  docker run --rm \
    -v nexus_storage-data:/data \
    -v "$(cd "$(dirname "$STORAGE_ARCHIVE")" && pwd)":/backup:ro \
    alpine sh -c "rm -rf /data/* && tar xzf /backup/$(basename "$STORAGE_ARCHIVE") -C /data"
fi

echo "→ Subindo o servidor (o purge de expiração roda na inicialização)"
docker compose -f "$COMPOSE_FILE" up -d server
docker compose -f "$COMPOSE_FILE" logs -f --tail 40 server
