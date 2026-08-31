# Arquitetura

## Visão geral

```mermaid
flowchart TB
    subgraph Cliente["Computador do usuário"]
        E[Electron main<br/>tray, notificações, atalhos]
        R[Renderer React<br/>UI, estado, contadores]
        E -. IPC allowlist .- R
    end

    subgraph Servidor["VPS"]
        C[Caddy<br/>HTTPS automático]
        A[Backend NestJS<br/>modular monolith]
        P[(PostgreSQL<br/>estado durável)]
        D[(Redis<br/>efêmero + filas)]
        S[/Storage<br/>local ou S3/]
        L[LiveKit SFU<br/>Fase 2/3]
    end

    R -->|REST /api| C
    R -->|WebSocket| C
    C --> A
    A --> P
    A --> D
    A --> S
    R -.->|WebRTC UDP<br/>áudio, vídeo, tela| L
    A -.->|assina token<br/>com grants mínimos| L
```

A mídia **não** passa pelo NestJS. O cliente pede um token ao backend, que valida
membership e as permissões `CONNECT` / `SPEAK` / `STREAM`, e então conecta direto ao SFU.
O LiveKit não decide autorização — ele confia no token assinado.

## Envio de uma mensagem

```mermaid
sequenceDiagram
    participant A as Cliente A
    participant API as Backend
    participant DB as PostgreSQL
    participant WS as Socket.IO
    participant B as Cliente B

    A->>A: mostra a mensagem como "enviando"
    A->>API: POST /channels/:id/messages (clientMessageId)
    API->>API: resolve permissões do canal
    API->>DB: INSERT (unique channelId+clientMessageId)
    API->>WS: message.created na sala do canal
    WS-->>A: substitui a otimista pela real
    WS-->>B: aparece sem refresh
```

`clientMessageId` torna o envio idempotente: um retry após queda de rede devolve a mensagem
já criada em vez de duplicá-la.

## Ciclo de vida de uma mensagem privada

```mermaid
sequenceDiagram
    participant A as Cliente
    participant API as Backend
    participant Q as BullMQ (Redis)
    participant DB as PostgreSQL
    participant FS as Storage

    A->>API: POST /dm/conversations/:id/messages
    API->>API: expiresAt = now + 8h (UTC, só no servidor)
    API->>DB: INSERT direct_messages
    API->>Q: job atrasado até expiresAt
    API-->>A: dm.created (com expiresAt)

    Note over A: contador usa serverTimeOffset

    alt caminho normal
        Q->>API: dispara no instante exato
    else fila perdida / Redis reiniciado
        API->>DB: cron de 60s: expires_at <= now()
    else servidor estava fora / backup restaurado
        API->>DB: purge na inicialização
    end

    API->>FS: apaga original e miniatura
    API->>DB: DELETE anexos + mensagem (transação)
    API-->>A: dm.expired → some da tela
```

Em qualquer caminho a leitura já estava protegida: todo `SELECT` de DM filtra
`expiresAt > now()`, então uma mensagem vencida some da API antes mesmo de ser apagada.

## Resolução de permissões

Uma função central (`PermissionsService`), usada por controllers, gateway e downloads.
Nenhuma checagem de permissão é escrita fora dela.

```mermaid
flowchart LR
    O{é o dono?} -->|sim| ALL[todas as permissões]
    O -->|não| E["@everyone"]
    E --> RR[cargos do membro<br/>OR dos bitfields]
    RR --> ADM{tem ADMINISTRATOR?}
    ADM -->|sim| ALL
    ADM -->|não| CE["override @everyone<br/>no canal"]
    CE --> CR["overrides dos cargos<br/>deny agregado, depois allow"]
    CR --> CM["override do próprio membro<br/>palavra final"]
    CM --> OUT[permissões efetivas]
```

Hierarquia: um membro só age sobre outro (expulsar, banir, mudar cargos) se estiver
estritamente acima. O dono está acima de todos e nunca é alvo. Quem tem `MANAGE_ROLES` não
pode conceder uma permissão que ele mesmo não possui — isso fecha a escalada de privilégio.

## Salas do WebSocket

O cliente **nunca** pede para entrar em uma sala. No handshake o servidor consulta as
associações reais e faz o `join`:

| Sala | Quem entra | Recebe |
|---|---|---|
| `user:{id}` | o próprio usuário (todos os dispositivos) | notificações, amizades, presença própria |
| `server:{id}` | membros do servidor | membros, canais, presença |
| `channel:{id}` | membros do servidor | mensagens, reações, digitação |
| `dm:{id}` | participantes da conversa | DMs, `dm.expired` |

Isso elimina por construção o risco de `socket.join(idArbitrário)`.

## Modelo de dados

Entidades principais e o que as liga:

- **User** ← Session (um por dispositivo), UserSettings, Presence
- **Server** → ServerMember → MemberRole → Role · Category → Channel → ChannelPermission
- **Channel** → Message → MessageAttachment / MessageReaction / PinnedMessage · ChannelRead
- **DirectConversation** → DirectConversationParticipant · DirectMessage → DirectMessageAttachment
- **Auditoria e moderação:** AuditLog, ServerBan, ServerInvite, Notification

Decisões de cascade tomadas conscientemente:

| Relação | Comportamento | Por quê |
|---|---|---|
| `Session → User` | cascade | apagar a conta derruba os dispositivos |
| `Message → Channel` | cascade | apagar o canal apaga o histórico dele |
| `Channel → Category` | `SetNull` | apagar a categoria não deve apagar canais; eles ficam soltos |
| `Message.replyTo` | `SetNull` | apagar a original não apaga as respostas |
| `Server.owner` | sem cascade | o dono não some por acidente; ownership é transferida explicitamente |
| `DirectMessageAttachment → DirectMessage` | cascade **+ remoção do arquivo** | o registro sozinho não basta: o blob também é apagado |

Índices que importam: `Message(channelId, createdAt)`, `DirectMessage(conversationId, createdAt)`,
**`DirectMessage(expiresAt)`** (a reconciliação varre por ele a cada minuto), `Session(expiresAt)`,
`User(username)`, `ServerMember(userId)`, `Notification(userId, createdAt)`.

IDs são CUID2 — não sequenciais, não enumeráveis.

## Contratos de evento

Todo evento sai no mesmo envelope:

```json
{ "event": "message.created", "data": { "...": "..." } }
```

Os nomes e os formatos vivem em `packages/shared/src/events.ts`, com schema Zod por evento.
Backend e cliente importam do mesmo arquivo — um evento não pode divergir entre os dois lados.

## Reconexão

Socket.IO reconecta com backoff exponencial (1 s → 30 s, com jitter). Enquanto isso a UI
mostra "Reconectando…". Eventos perdidos durante a queda não são reenviados: ao voltar, o
cliente recarrega o histórico do canal aberto. Mensagens privadas já expiradas simplesmente
não voltam — o filtro de leitura garante isso.
