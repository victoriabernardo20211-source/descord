#!/usr/bin/env bash
# Verifica o que os testes NÃO pegam: que um clone limpo compila e que o
# servidor construído realmente INICIA no layout da imagem de produção.
#
# Três bugs reais passaram por lint, typecheck, testes e build antes deste
# script existir:
#   • um .gitignore engoliu src/storage/ — compilava aqui, não no clone;
#   • a imagem final não copiava packages/shared/node_modules — o zod sumia no boot;
#   • file-type é ESM puro — virava require e quebrava só ao iniciar.
#
# Rode antes de qualquer deploy: ./scripts/verify-release.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export CI=true

echo "→ Clonando o repositório do zero (pega arquivo esquecido no .gitignore)"
git clone -q "file://$REPO_ROOT" "$WORK/repo"
cd "$WORK/repo"
git checkout -q "$(cd "$REPO_ROOT" && git rev-parse --abbrev-ref HEAD)"

echo "→ Instalando e compilando"
pnpm install --frozen-lockfile --silent
pnpm --filter @nexus/shared build >/dev/null
pnpm --filter @nexus/server exec prisma generate >/dev/null
pnpm --filter @nexus/server exec nest build >/dev/null

echo "→ Reinstalando apenas dependências de produção (como o Dockerfile)"
pnpm install --frozen-lockfile --prod --filter @nexus/server... --filter @nexus/shared --silent
pnpm --filter @nexus/server exec prisma generate >/dev/null

echo "→ Montando o layout exato da imagem final"
RT="$WORK/runtime"
mkdir -p "$RT/packages/shared" "$RT/apps/server"
cp -a node_modules "$RT/node_modules"
cp -a packages/shared/dist packages/shared/package.json packages/shared/node_modules "$RT/packages/shared/"
cp -a apps/server/dist apps/server/package.json apps/server/prisma apps/server/node_modules "$RT/apps/server/"

echo "→ Iniciando o servidor (sem banco: queremos ver os módulos carregarem)"
cd "$RT/apps/server"
OUTPUT="$(timeout 30 env \
  NODE_ENV=production PORT=4099 \
  DATABASE_URL='postgresql://x:x@127.0.0.1:5999/x' \
  REDIS_URL='redis://127.0.0.1:6999' \
  JWT_SECRET="$(head -c 40 /dev/urandom | base64)" \
  JWT_REFRESH_SECRET="$(head -c 40 /dev/urandom | base64)" \
  STORAGE_PATH="$RT/storage" \
  node dist/main.js 2>&1 || true)"

# Dependência ausente no layout de produção, em qualquer das formas que o Node
# e o Nest reportam. A terceira pegou o `class-validator`, que some no install
# de produção e derruba o app DEPOIS de todos os módulos carregarem.
FATAL='MODULE_NOT_FOUND|Cannot find module|ERR_PACKAGE_PATH_NOT_EXPORTED|package is missing|PackageLoader'
if grep -qE "$FATAL" <<<"$OUTPUT"; then
  echo
  echo "✗ FALHOU: dependência ausente no layout de produção."
  grep -E "$FATAL" <<<"$OUTPUT" | head -5
  exit 1
fi

# Qualquer ERROR que não seja a falta esperada de Postgres/Redis.
UNEXPECTED="$(grep -E "ERROR|\[Nest\].*ERROR" <<<"$OUTPUT" \
  | grep -viE "ECONNREFUSED|Can.t reach database|connect ECONNREFUSED|Redis|PrismaClientInitializationError" || true)"
if [ -n "$UNEXPECTED" ]; then
  echo
  echo "✗ FALHOU: erro inesperado durante a inicialização."
  head -5 <<<"$UNEXPECTED"
  exit 1
fi

if ! grep -q "InstanceLoader" <<<"$OUTPUT"; then
  echo
  echo "✗ FALHOU: o servidor não chegou a inicializar os módulos."
  tail -20 <<<"$OUTPUT"
  exit 1
fi

echo
echo "✓ Clone limpo compila e o servidor inicializa no layout de produção."
echo "  (parar por falta de Postgres/Redis aqui é esperado)"
