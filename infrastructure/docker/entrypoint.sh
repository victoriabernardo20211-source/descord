#!/bin/sh
set -e

cd /app/apps/server

# Migrations versionadas. Nunca `db push` em produção.
echo "Aplicando migrations..."
./node_modules/.bin/prisma migrate deploy

# O purge de inicialização do ExpirationService roda logo após o boot e remove
# qualquer mensagem privada já vencida — inclusive as vindas de um backup antigo.
echo "Iniciando o servidor Nexus..."
exec node dist/main.js
