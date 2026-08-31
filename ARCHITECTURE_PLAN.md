# Nexus — Plano de Arquitetura

Aplicativo desktop privado de comunicação (texto, voz, screen share) para ~9 usuários.
Identidade própria, sem qualquer asset, marca, som ou código de terceiros proprietários.

## 1. Stack final

| Camada | Escolha | Justificativa |
|---|---|---|
| Desktop | **Electron 33 + React 19 + TS + Vite + Tailwind + Zustand** | `desktopCapturer` entrega lista de monitores/janelas **com thumbnails** (Tauri não tem equivalente maduro); áudio de sistema no Windows via `audio: 'loopback'`; `globalShortcut` para push-to-talk com app minimizado; tray, notificações nativas, `electron-builder` (NSIS + auto-update). |
| Backend | **NestJS + TypeScript** (modular monolith) | Módulos, DI, guards, DTO validation, Swagger. Um processo só — sem microsserviços para 9 usuários. |
| Banco | **PostgreSQL 16 + Prisma** | Migrations versionadas, relações fortes, full-text search nativo (suficiente, sem Elasticsearch). |
| Cache/efêmero | **Redis 7** | Presença, typing, rate limit, salas WS, estado de chamada, filas BullMQ. |
| Realtime | **Socket.IO + @socket.io/redis-adapter** | Reconnect com backoff, rooms, ack; adapter permite escalar/reiniciar sem perder broadcast. |
| Voz/Vídeo/Tela | **LiveKit self-hosted (SFU)** | SFU maduro, simulcast + SVC, TURN embutido, SDK web/Electron. Não reimplementamos SFU. |
| Storage | Abstração `StorageProvider` → `LocalStorageProvider` (hoje), `S3StorageProvider` (depois) | Nada amarrado ao filesystem. |
| Jobs | **BullMQ** (delayed jobs) + reconciliação SQL + purge no boot | Expiração de DM sobrevive a restart de backend e de Redis. |
| Proxy | **Caddy** | HTTPS automático (ACME), reverse proxy para API/WS/LiveKit. |

### Por que **não** P2P mesh
9 pessoas assistindo a um stream 1080p60 (~8 Mbps) em mesh = o transmissor faz upload de ~64 Mbps.
Inviável em conexão doméstica. Com SFU o transmissor envia **1×** e o servidor replica. Detalhes em `docs/BANDWIDTH.md`.

## 2. Divisão de responsabilidade (importante)

```
Desktop ──REST──►  Backend (Nest)  ──► Postgres   (estado durável)
        ──WS────►                  ──► Redis      (efêmero + filas)
        ──WebRTC─► LiveKit (SFU)   ◄──► Backend   (só emissão de token assinado)
```

O **backend nunca transporta mídia**. Ele apenas:
1. autentica o usuário,
2. resolve permissões (`CONNECT`, `SPEAK`, `STREAM`),
3. assina um token LiveKit com os *grants mínimos* para aquela sala.

O LiveKit nunca decide autorização — ele confia no token que o backend assinou.

## 3. Módulos do backend

`auth` `users` `friends` `servers` `channels` `messages` `direct-messages` `voice`
`calls` `files` `notifications` `presence` `roles` `permissions` `realtime` `admin`
`audit` `settings` `health` `jobs`

Regra: **toda** decisão de permissão passa por `PermissionsService.resolve()`. Nenhuma
checagem de permissão escrita ad-hoc dentro de um controller.

## 4. Expiração obrigatória de 8h nas DMs (requisito central)

`expiresAt = createdAt + 8h`, calculado **no servidor**, em UTC, imutável (nenhuma rota
aceita `expiresAt` do cliente; não existe pin nem "manter mensagem" em DM).

Quatro camadas independentes, propositalmente redundantes:

1. **Filtro de leitura** — todo `SELECT` de DM carrega `expiresAt > now()`. Mesmo que
   nenhum job tenha rodado, a API **nunca** devolve mensagem vencida. Idem download de anexo.
2. **Delayed job (BullMQ)** — agendado no envio, dispara na hora exata → apaga linha +
   anexos do storage + emite `dm.expired` no WS.
3. **Reconciliação** — cron a cada 60s varre `expires_at <= now()` (índice dedicado) e
   apaga o que a fila perdeu (Redis reiniciado, job perdido, downtime).
4. **Purge no boot** — roda antes de aceitar tráfego. Cobre backup restaurado: um dump
   antigo restaurado **não ressuscita** DM vencida.

Cliente: contador visual usando `serverTimeOffset` (nunca o relógio local para autorização);
cache local também expira e é purgado no start e em `dm.expired`.

## 5. Segurança (resumo; detalhe em `docs/SECURITY.md`)

- Senha: **Argon2id**. Access token curto (15 min) + refresh token rotacionado, hasheado no banco, revogável por dispositivo.
- Identidade **sempre** da sessão/token — nunca de `userId` no body.
- WS: handshake autenticado; `join` de sala valida membership no servidor.
- Upload: limite, MIME sniffing real (não confia na extensão), nome aleatório, sem execução.
- Electron: `contextIsolation: true`, `nodeIntegration: false`, sandbox, preload com IPC allowlist, CSP, navegação bloqueada.
- IDs: CUID2 (não enumeráveis).

## 6. Fases

- **Fase 1** — monorepo, auth, users, amigos, servidores/categorias/canais, chat, WS, DMs + expiração 8h, uploads, permissões, notificações básicas, shell do desktop.
- **Fase 2** — canais de voz, LiveKit, mic, mute/deafen, PTT, volume por usuário, chamadas privadas,
  chamar atenção / vibrar tela ("zumbido", spec em `docs/ROADMAP.md`).
- **Fase 3** — screen share (monitor/janela/app), resolução/FPS, áudio da tela, múltiplos streams, fullscreen/popout.
- **Fase 4** — busca, pins, roles avançadas, status/atividade, tray, atalhos, autostart, polish de UI.
- **Fase 5** — instalador Windows, deploy, backups, auto-update, testes completos, hardening.

Cada fase só avança com `lint`, `typecheck`, `test` e `build` verdes.
O detalhamento de cada fase fica em [`docs/ROADMAP.md`](docs/ROADMAP.md).
