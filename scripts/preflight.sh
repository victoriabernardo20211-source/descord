#!/usr/bin/env bash
# Confere se o .env está pronto para produção ANTES de subir a stack.
# Rode na VPS, dentro de /opt/nexus, com o .env já preenchido.
set -uo pipefail

ENV_FILE="${ENV_FILE:-.env}"
FAIL=0

red()  { printf '\033[31m✗\033[0m %s\n' "$1"; FAIL=1; }
warn() { printf '\033[33m!\033[0m %s\n' "$1"; }
ok()   { printf '\033[32m✓\033[0m %s\n' "$1"; }

if [ ! -f "$ENV_FILE" ]; then
  red "$ENV_FILE não existe. Copie de apps/server/.env.example."
  exit 1
fi

# shellcheck disable=SC1090
set -a; . "./$ENV_FILE"; set +a

check_set() {
  local name="$1" value="${!1:-}"
  if [ -z "$value" ]; then red "$name está vazio."; else ok "$name definido."; fi
}

check_len() {
  local name="$1" min="$2" value="${!1:-}"
  if [ "${#value}" -lt "$min" ]; then
    red "$name tem ${#value} caracteres (mínimo $min). Gere com: openssl rand -base64 48"
  else
    ok "$name tem tamanho adequado."
  fi
}

echo "── Segredos ────────────────────────────────────────────"
check_len JWT_SECRET 32
check_len JWT_REFRESH_SECRET 32
check_set POSTGRES_PASSWORD
check_set REDIS_PASSWORD

if [ "${JWT_SECRET:-a}" = "${JWT_REFRESH_SECRET:-b}" ]; then
  red "JWT_SECRET e JWT_REFRESH_SECRET são iguais. Use segredos diferentes."
fi

for var in JWT_SECRET JWT_REFRESH_SECRET; do
  count=$(grep -c "^$var=" "$ENV_FILE" || true)
  if [ "$count" -gt 1 ]; then
    red "$var aparece $count vezes no $ENV_FILE. Deixe apenas uma linha."
  fi
done

case "${JWT_SECRET:-}" in
  *troque-isto*) red "JWT_SECRET ainda é o valor de exemplo." ;;
esac

echo
echo "── Ambiente ────────────────────────────────────────────"
if [ "${NODE_ENV:-}" != "production" ]; then
  red "NODE_ENV deveria ser 'production' (está: '${NODE_ENV:-vazio}')."
else
  ok "NODE_ENV=production."
fi

check_set NEXUS_DOMAIN
case "${PUBLIC_URL:-}" in
  https://*) ok "PUBLIC_URL usa HTTPS." ;;
  "")        red "PUBLIC_URL está vazio." ;;
  *)         warn "PUBLIC_URL não usa HTTPS: ${PUBLIC_URL}" ;;
esac

if [ "${CORS_ORIGINS:-}" = "*" ]; then
  warn "CORS_ORIGINS=* aceita qualquer origem. Prefira o seu domínio."
else
  ok "CORS_ORIGINS restrito."
fi

if [ -z "${REGISTRATION_INVITE_CODE:-}" ]; then
  warn "REGISTRATION_INVITE_CODE vazio: qualquer pessoa com o endereço pode criar conta."
else
  ok "Cadastro protegido por código de convite."
fi

if [ -z "${INITIAL_ADMIN_EMAIL:-}" ]; then
  warn "INITIAL_ADMIN_EMAIL vazio: nenhuma conta virará admin global automaticamente."
else
  ok "Admin global: $INITIAL_ADMIN_EMAIL"
fi

echo
echo "── Sistema ─────────────────────────────────────────────"
perms=$(stat -c '%a' "$ENV_FILE" 2>/dev/null || echo '?')
if [ "$perms" != "600" ]; then
  warn "$ENV_FILE está com permissão $perms. Rode: chmod 600 $ENV_FILE"
else
  ok "$ENV_FILE com permissão 600."
fi

if docker compose version >/dev/null 2>&1; then ok "Docker Compose disponível."; else red "Docker Compose não encontrado."; fi

host_only="${NEXUS_DOMAIN:-}"
host_only="${host_only#http://}"
host_only="${host_only#https://}"

if [ -n "${BIND_ADDRESS:-}" ]; then
  ok "Portas publicadas apenas em $BIND_ADDRESS (fora do alcance da internet)."
else
  warn "BIND_ADDRESS vazio: 80 e 443 ficam abertas para a internet. Porta publicada pelo Docker NÃO passa pelo ufw."
fi

# IP não se resolve por DNS; só faz sentido conferir nome.
if command -v dig >/dev/null 2>&1 && [ -n "$host_only" ] &&
   ! printf '%s' "$host_only" | grep -qE '^[0-9]+(\.[0-9]+){3}$'; then
  resolved=$(dig +short "$host_only" | tail -1)
  if [ -z "$resolved" ]; then
    warn "$host_only não resolve ainda. O Caddy não conseguirá emitir o certificado."
  else
    ok "$host_only resolve para $resolved"
  fi
fi

echo
if [ "$FAIL" -eq 1 ]; then
  echo "Corrija os itens marcados com ✗ antes de subir."
  exit 1
fi
echo "Tudo pronto. Suba com: ./scripts/deploy.sh"
