# Nexus — contexto do projeto

Aplicativo desktop privado de comunicação (texto, voz, tela) para ~9 amigos.
Servidor próprio, uso diário real — **não é demo, mockup nem prova de conceito**.

Se você está retomando este projeto sem contexto anterior, leia este arquivo,
depois `ARCHITECTURE_PLAN.md` e `docs/ROADMAP.md`.

## Invariantes — não quebre nenhuma destas

1. **Mensagens privadas expiram em 8 horas.** `expiresAt = createdAt + 8h`, definido só
   no servidor, em UTC. Não existe configuração para desativar, estender ou preservar —
   nem para administrador. Toda leitura filtra `expiresAt > now()`. Quatro camadas
   redundantes garantem a exclusão (ver `docs/ARCHITECTURE.md`).
2. **DMs são criptografadas ponta a ponta** (Olm/Megolm). O servidor guarda ciphertext.
   Chaves privadas vivem apenas no processo principal do Electron.
3. **Nunca há downgrade silencioso.** Se a criptografia não estiver pronta, o envio é
   bloqueado. Não existe caminho onde uma DM saia em texto puro.
4. **Nenhuma primitiva criptográfica é escrita neste projeto.** Só bibliotecas
   estabelecidas. Se precisar de cripto nova, use biblioteca auditada.
5. **Identidade própria.** Nome "Nexus". Nenhum asset, som, cor, logo ou nome de
   produto de terceiros. A organização da UI pode ser inspirada, o visual é original.
6. **Permissão se decide em um lugar só:** `PermissionsService`. Nunca escreva checagem
   de permissão ad-hoc num controller.
7. **Identidade vem sempre do token**, nunca de `userId` no corpo da requisição.

## Estrutura

```
apps/server/     NestJS + Prisma + Redis + Socket.IO (modular monolith)
apps/desktop/    Electron + React 19 + Vite + Tailwind + Zustand
packages/shared/ tipos, schemas Zod, bitfield de permissões, contratos de evento
infrastructure/  docker-compose, Dockerfile, Caddyfile
scripts/         preflight, deploy, backup, restore, verify-release
docs/            arquitetura, segurança, E2EE, instalação, hosting, banda, roadmap
```

Tipos e eventos vivem **só** em `packages/shared`. Backend e cliente importam do mesmo
lugar para que um evento não possa divergir entre os dois lados.

## Verificação — leia antes de dizer que algo funciona

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
./scripts/verify-release.sh      # OBRIGATÓRIO antes de qualquer deploy
```

`verify-release.sh` clona o repositório do zero, compila, reinstala só as dependências de
produção e **inicia o servidor** no layout exato da imagem Docker.

Ele existe porque três bugs reais passaram por lint, typecheck, testes e build:

| Bug | Por que os testes não pegaram |
|---|---|
| `.gitignore` engoliu `apps/server/src/storage/` | os arquivos existiam no disco local |
| imagem não copiava `packages/shared/node_modules` | só falha ao iniciar o processo |
| `file-type` é ESM puro, virava `require` | só falha ao iniciar o processo |

Lição: build passar ≠ aplicação iniciar. Quando o alvo é produção, **inicie o processo**.

Para conferir **layout** sem GUI (este ambiente não roda Electron), existe um arnês
que monta a tela principal com dados falsos e sem servidor:

```bash
cd apps/desktop && npx vite build --config vite.preview.config.ts
# sirva apps/desktop/out/preview e abra preview.html (#dm abre a conversa privada)
```

`src/preview.tsx` não entra no aplicativo: o build do Electron só usa `src/index.html`.
Ele prova que as telas renderizam e como ficam — **não** prova voz, tela nem rede.

Testes de integração do servidor exigem Postgres e Redis reais:
```bash
docker compose -f infrastructure/docker/docker-compose.dev.yml up -d
TEST_DATABASE_URL=postgresql://nexus:nexus@localhost:5432/nexus_test pnpm --filter @nexus/server test
```

## Estado atual

- **Fase 1 pronta:** auth (Argon2id, sessões revogáveis), amigos, servidores, categorias,
  canais, chat em tempo real, DMs com expiração de 8h, uploads, permissões, notificações.
- **Fase 1.5 pronta:** E2EE das DMs e grupos privados, **incluindo os anexos**
  (AES-256-GCM no cliente, chave dentro do envelope Megolm).
- **Fases 2 e 3 escritas:** voz e tela com LiveKit — código completo e com testes de
  permissão/token, mas **nunca exercitado com áudio ou vídeo reais**. Roteiro de
  validação em `docs/VOICE.md`. Não diga que funciona antes desse roteiro passar.
- **Deploy feito:** VPS em São Paulo, acesso por Tailscale, health check verde.
- **Próximas fases** em `docs/ROADMAP.md`: voz/LiveKit, tela, polish, instalador.

### Pendências conhecidas

- Verificação de contato (número de segurança) existe no backend, falta a tela.
- Voz e tela estão implementadas mas **não validadas com mídia real**. Enquanto o
  roteiro de `docs/VOICE.md` não passar, trate como não comprovado.
- Chamadas privadas (DM) têm token no backend, mas ainda não têm interface.
- Atualização automática está ligada (feed no próprio servidor, atrás do Tailscale),
  mas o ciclo completo nunca foi exercitado. Roteiro em `docs/UPDATES.md`.

## Como trabalhar aqui

- Português nas mensagens ao usuário e nos comentários de código; inglês nos commits.
- Commits lógicos e pequenos, com o *porquê* no corpo — não só o *quê*.
- Comentário explica decisão e trade-off, não repete o que o código já diz.
- Ao encontrar um bug: reproduza primeiro, corrija depois, e escreva o teste que teria pego.
- Se algo não puder ser testado automaticamente, **diga isso claramente** em vez de afirmar
  que funciona. O usuário pediu isso explicitamente e é a regra mais importante aqui.
