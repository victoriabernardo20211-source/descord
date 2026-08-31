#!/usr/bin/env bash
# Backup do Nexus: banco + arquivos + configuração.
#
# IMPORTANTE — mensagens privadas e backups:
# Um dump pode conter DMs que ainda não tinham vencido no momento da cópia.
# Ao restaurar, o servidor NÃO as ressuscita: o purge de inicialização do
# ExpirationService apaga tudo com expiresAt <= agora antes de aceitar tráfego,
# e a reconciliação de 60s cobre o restante. Ver docs/SECURITY.md.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/nexus}"
COMPOSE_FILE="${COMPOSE_FILE:-infrastructure/docker/docker-compose.yml}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
KEEP_DAYS="${KEEP_DAYS:-14}"

mkdir -p "$BACKUP_DIR"

echo "→ Banco de dados"
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-nexus}" -d "${POSTGRES_DB:-nexus}" --clean --if-exists \
  | gzip > "$BACKUP_DIR/nexus-db-$STAMP.sql.gz"

echo "→ Arquivos enviados"
docker run --rm \
  -v nexus_storage-data:/data:ro \
  -v "$BACKUP_DIR":/backup \
  alpine tar czf "/backup/nexus-storage-$STAMP.tar.gz" -C /data .

echo "→ Configuração"
if [ -f .env ]; then
  # O .env contém segredos: guarde o backup em local restrito.
  cp .env "$BACKUP_DIR/nexus-env-$STAMP.bak"
  chmod 600 "$BACKUP_DIR/nexus-env-$STAMP.bak"
fi

echo "→ Removendo backups com mais de $KEEP_DAYS dias"
find "$BACKUP_DIR" -name 'nexus-*' -type f -mtime "+$KEEP_DAYS" -delete

echo "Backup concluído em $BACKUP_DIR (marca $STAMP)"
