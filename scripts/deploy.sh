#!/usr/bin/env bash
# Sobe (ou atualiza) o Nexus em produção.
# Faz backup antes de atualizar e espera o health check ficar verde.
set -euo pipefail

COMPOSE="docker compose --env-file .env -f infrastructure/docker/docker-compose.yml"
SKIP_BACKUP="${SKIP_BACKUP:-0}"

./scripts/preflight.sh

# shellcheck disable=SC1091
set -a; . ./.env; set +a

if [ "$SKIP_BACKUP" != "1" ] && $COMPOSE ps --status running --services 2>/dev/null | grep -q postgres; then
  echo "→ Backup antes de atualizar"
  ./scripts/backup.sh
fi

echo "→ Construindo a imagem do servidor"
$COMPOSE build server

echo "→ Subindo os serviços"
# As migrations rodam no entrypoint do container (prisma migrate deploy).
$COMPOSE up -d

echo "→ Aguardando o health check"
for attempt in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:4000/api/health" >/dev/null 2>&1 \
     || $COMPOSE exec -T server node -e "require('http').get('http://127.0.0.1:4000/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))" 2>/dev/null; then
    echo "Servidor no ar."
    $COMPOSE ps
    exit 0
  fi
  printf '.'
  sleep 3
done

echo
echo "O servidor não ficou saudável a tempo. Últimos logs:"
$COMPOSE logs --tail 60 server
exit 1
