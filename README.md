# Nexus

Aplicativo desktop **privado** de comunicação — texto, voz e compartilhamento de tela — para
um grupo pequeno de amigos (~9 pessoas). Servidor próprio, dados próprios, sem monetização,
sem terceiros no meio.

> Identidade própria. Nenhum asset, som, marca ou código de qualquer outro produto é usado aqui.

**Duas regras centrais do produto:**

1. Toda mensagem privada é **criptografada ponta a ponta** (Olm/Megolm). O servidor guarda
   bytes que não consegue ler. Ver [`docs/E2EE.md`](docs/E2EE.md).
2. Toda mensagem privada é **apagada permanentemente 8 horas após o envio** — do banco, do
   disco e da tela de todos os dispositivos. Não há como desativar, estender ou preservar.
   Ver [expiração de DMs](#expiração-de-dms-em-8-horas).

---

## Estado atual

| Fase | Conteúdo | Situação |
|---|---|---|
| **1** | Monorepo, auth, amigos, servidores, categorias, canais, chat, WebSocket, DMs com expiração de 8h, uploads, permissões, notificações | **Implementada** |
| **1.5** | **Criptografia ponta a ponta** das DMs e grupos privados (Olm/Megolm), diretório de chaves, verificação por número de segurança | **Implementada** |
| 2 | Canais de voz, LiveKit, microfone, mute/deafen, PTT, volume por usuário, chamadas privadas, chamar atenção/vibrar tela | Planejada |
| 3 | Compartilhamento de tela, resolução/FPS, áudio da tela, múltiplos streams | Planejada |
| 4 | Busca avançada, pins na UI, roles na UI, status/atividade, tray, atalhos, autostart | Parcial (backend pronto) |
| 5 | Instalador Windows, deploy, backups, auto-update, testes completos | Parcial (instalador e scripts prontos) |

O que **ainda não existe**: voz, vídeo, compartilhamento de tela e a integração com o LiveKit.
O banco, as permissões (`CONNECT`, `SPEAK`, `STREAM`) e o Docker Compose já estão preparados
para receber essa camada sem reescrita.

---

## Arquitetura em uma tela

```
Desktop (Electron) ──REST──►  Backend (NestJS)  ──►  PostgreSQL   estado durável
                   ──WS────►                    ──►  Redis        presença, filas, typing
                   ──WebRTC─►  LiveKit (SFU)    ◄──  Backend      só assina o token de acesso
```

O backend **nunca transporta mídia**. Ele autentica, resolve permissões e assina um token
LiveKit com os grants mínimos. Detalhes em [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

**Stack:** Electron 33 + React 19 + TypeScript + Vite + Tailwind + Zustand · NestJS +
Prisma + PostgreSQL 16 + Redis 7 + Socket.IO + BullMQ · LiveKit (SFU) · Caddy · Docker Compose.

---

## Estrutura do repositório

```
apps/
  server/           backend NestJS (modular monolith)
  desktop/          aplicativo Electron + React
packages/
  shared/           tipos, schemas Zod, bitfield de permissões, contratos de evento
infrastructure/
  docker/           docker-compose.yml, Dockerfile, entrypoint
  caddy/            Caddyfile (HTTPS automático)
scripts/            backup.sh, restore.sh
docs/               arquitetura, segurança, instalação, troubleshooting, banda
```

Tipos e contratos de evento vivem **só** em `packages/shared` — backend e cliente importam
do mesmo lugar, então um evento não pode divergir entre os dois lados.

---

## Rodando localmente

Pré-requisitos: **Node 22+**, **pnpm 10+**, **Docker**.

```bash
pnpm install

# 1. Banco e cache (portas expostas só no localhost)
docker compose -f infrastructure/docker/docker-compose.dev.yml up -d

# 2. Configuração
cp apps/server/.env.example apps/server/.env
# Gere segredos de verdade:
#   openssl rand -base64 48
# e cole em JWT_SECRET e JWT_REFRESH_SECRET.

# 3. Banco
pnpm --filter @nexus/server exec prisma migrate deploy
pnpm --filter @nexus/server run seed     # 3 usuários, 1 servidor, canais e mensagens

# 4. Backend  (http://localhost:4000, docs em /api/docs)
pnpm --filter @nexus/server dev

# 5. Aplicativo desktop
pnpm --filter @nexus/desktop dev
```

Na primeira execução o app pergunta o endereço do servidor — informe `http://localhost:4000`.

Contas do seed: `ana@nexus.local`, `bruno@nexus.local`, `clara@nexus.local`,
senha `nexus-dev-2026`. **Só para desenvolvimento** — o seed se recusa a rodar com
`NODE_ENV=production`.

### Scripts

```bash
pnpm dev              # tudo em watch
pnpm build            # build de todos os pacotes
pnpm test             # testes
pnpm lint             # lint
pnpm typecheck        # TypeScript strict em todo o monorepo
pnpm build:desktop    # build do cliente
pnpm release:windows  # gera Nexus-Setup-<versão>.exe
```

---

## Expiração de DMs em 8 horas

O requisito mais importante do sistema, implementado em **quatro camadas redundantes**:

1. **Filtro de leitura** — toda consulta de DM carrega `expiresAt > now()`. Mesmo que fila e
   cron estejam parados, a API nunca devolve uma mensagem vencida. O download de anexo faz a
   mesma checagem.
2. **Job atrasado (BullMQ)** — agendado no envio, dispara no milissegundo exato.
3. **Reconciliação** — cron a cada 60 s varre `expires_at <= now()` (índice dedicado) e apaga
   o que a fila perdeu (Redis reiniciado, backend fora do ar, job perdido).
4. **Purge na inicialização** — roda antes de o servidor aceitar tráfego. É o que impede um
   backup restaurado de ressuscitar mensagens.

Ao expirar: a linha do banco some, os anexos (original **e** miniatura) são apagados do
storage, e um evento `dm.expired` remove a mensagem da tela de todos os dispositivos.

`expiresAt` é calculado só no servidor, em UTC, por aritmética de milissegundos — sem
strings, sem fuso, sem horário de verão. Editar uma mensagem **não** renova o prazo.
Não existe rota que aceite `expiresAt` do cliente, não existe pin de DM e nem o administrador
global consegue preservar uma mensagem privada.

O contador visível no cliente usa `serverTimeOffset` (diferença medida entre o relógio do
servidor e o do PC). Ele é apenas informativo: **quem decide se a mensagem existe é sempre o
backend.**

---

## Instalando em produção

Passo a passo completo (VPS Ubuntu, Docker, domínio, firewall, admin, backups):
[`docs/SERVER_SETUP.md`](docs/SERVER_SETUP.md).

**Onde hospedar:** o backend precisa de processo contínuo (WebSocket, worker de
expiração, reconciliação de 60 s), então **Vercel e afins não servem** — comparação
das opções em [`docs/HOSTING.md`](docs/HOSTING.md).

Resumo:

```bash
cp apps/server/.env.example .env    # preencha os segredos e o domínio
./scripts/preflight.sh              # confere o .env, DNS e permissões antes de subir
./scripts/deploy.sh                 # backup, build, up -d e espera o health check
```

Duas topologias suportadas, ambas documentadas:

- **A — servidor público com HTTPS.** Domínio + Caddy com certificado automático.
- **B — rede privada com Tailscale.** Nada exposto na internet; só os 9 computadores
  enxergam o servidor. Recomendada para este caso de uso.

### Backup e restauração

```bash
./scripts/backup.sh                                   # banco + arquivos + .env
./scripts/restore.sh nexus-db-<stamp>.sql.gz nexus-storage-<stamp>.tar.gz
```

Restaurar **não** traz DMs expiradas de volta — o purge de inicialização as remove antes de
qualquer cliente conseguir ler.

---

## Instalando no Windows (para os amigos)

Você gera o instalador uma vez; eles só instalam e usam:

```bash
pnpm release:windows      # → apps/desktop/release/Nexus-Setup-0.1.0.exe
```

Eles baixam, instalam, abrem, informam o endereço do servidor (ou já vem embutido) e entram.
Detalhes em [`docs/WINDOWS_CLIENT.md`](docs/WINDOWS_CLIENT.md).

---

## Administração

- **Primeiro administrador:** defina `INITIAL_ADMIN_EMAIL` no `.env`. A primeira conta criada
  com esse e-mail vira administrador global.
- **Fechar o cadastro:** defina `REGISTRATION_INVITE_CODE`. Sem o código, ninguém se cadastra.
- **Logs:** `docker compose logs -f server`. Logs nunca contêm senhas, tokens completos ou
  conteúdo de mensagens privadas.
- **Saúde:** `GET /api/health` reporta API, Postgres e Redis.

---

## Segurança e privacidade

Argon2id, refresh token rotacionado e hasheado, sessões revogáveis por dispositivo,
autorização sempre no servidor, WebSocket com handshake autenticado e salas calculadas pelo
backend, uploads com MIME verificado pelo conteúdo, e Electron com `contextIsolation`,
sandbox e IPC restrito.

As mensagens privadas são **criptografadas ponta a ponta** com Olm/Megolm: as chaves ficam
no processo principal do Electron, protegidas pela DPAPI do Windows, e o servidor nunca vê
texto claro. O que ele **ainda** enxerga (metadados: quem falou com quem e quando) está dito
com todas as letras em [`docs/E2EE.md`](docs/E2EE.md).

---

## Documentação

| Documento | Conteúdo |
|---|---|
| [`ARCHITECTURE_PLAN.md`](ARCHITECTURE_PLAN.md) | decisões de stack e por que cada uma |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | diagramas, fluxos, modelo de dados |
| [`docs/SECURITY.md`](docs/SECURITY.md) | auth, permissões, uploads, DMs, limitações |
| [`docs/E2EE.md`](docs/E2EE.md) | criptografia ponta a ponta: protocolo, chaves, metadados |
| [`docs/SERVER_SETUP.md`](docs/SERVER_SETUP.md) | instalação na VPS, passo a passo |
| [`docs/WINDOWS_CLIENT.md`](docs/WINDOWS_CLIENT.md) | build, instalador, logs do cliente |
| [`docs/HOSTING.md`](docs/HOSTING.md) | onde hospedar: por que Vercel não serve, alternativas |
| [`docs/BANDWIDTH.md`](docs/BANDWIDTH.md) | estimativas de banda, mesh × SFU |
| [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) | problemas comuns e como resolver |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | fases seguintes, incluindo a spec do "zumbido" |
