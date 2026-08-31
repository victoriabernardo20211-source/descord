# Roadmap

Cada fase só é considerada pronta quando `lint`, `typecheck`, `test` e `build` passam.

| Fase | Escopo | Situação |
|---|---|---|
| 1 | monorepo, auth, amigos, servidores, categorias, canais, chat, WebSocket, DMs com expiração de 8h, uploads, permissões, notificações | **pronta** |
| 1.5 | criptografia ponta a ponta das DMs e grupos privados (Olm/Megolm) | **pronta** |
| 2 | voz (LiveKit), mic, mute/deafen, PTT, volume por usuário, chamadas privadas, **chamar atenção / vibrar tela** | próxima |
| 3 | compartilhamento de tela, resolução/FPS, áudio da tela, múltiplos streams, fullscreen/popout | planejada |
| 4 | busca na UI, pins na UI, cargos na UI, status/atividade, tray, atalhos, autostart | planejada |
| 5 | instalador assinado, auto-update, deploy, backups automatizados, hardening final | parcial |

---

## Fase 2 — Chamar atenção / vibrar a tela ("zumbido")

Recurso pedido explicitamente: o equivalente ao **zumbido do MSN** — sacudir a janela do
destinatário para chamar a atenção quando ele não está respondendo.

### Comportamento

Quem envia clica no ícone de sino/vibração ao lado do campo de mensagem (ou `Ctrl+Shift+Z`)
dentro de uma DM, grupo privado ou canal de texto. Quem recebe:

1. A janela do Nexus **treme** por ~800 ms (animação de translação amortecida, não um
   `shake` infinito).
2. Toca um som curto e próprio (royalty-free ou sintetizado — **nunca** o som do MSN nem de
   qualquer outro produto).
3. Aparece uma linha discreta no chat: *"Ana chamou sua atenção"*, com horário.
4. Se a janela estiver minimizada ou sem foco: notificação nativa do Windows e
   `flashFrame(true)` na barra de tarefas, em vez de tremer uma janela invisível.

### Regras (o que impede virar spam ou arma)

| Regra | Valor | Por quê |
|---|---|---|
| Rate limit por conversa | **1 a cada 30 s** por remetente, no servidor | é o recurso mais fácil de abusar entre amigos |
| Silenciar por conversa | opção "não receber chamadas de atenção" | quem está jogando não quer a tela tremendo |
| Respeitar "Não Perturbe" | em DND: **sem** tremer e **sem** som; só a linha no chat | DND precisa significar algo |
| Bloqueio | usuário bloqueado não consegue enviar | mesma regra das mensagens |
| Canais de servidor | exige `SEND_MESSAGES` no canal | não cria uma permissão nova |
| Acessibilidade | opção "chamar atenção sem animação" (só som + flash) | tremor de tela incomoda quem tem sensibilidade vestibular; **obrigatório**, não opcional |

### Como se encaixa no que já existe

Nada de arquitetura nova — o recurso cabe inteiro nas peças da Fase 1:

- **Evento novo** em `packages/shared/src/events.ts`:
  ```ts
  'attention.requested': z.object({
    channelId: z.string(),      // canal ou conversationId
    fromUserId: z.string(),
    displayName: z.string(),
    at: z.string(),             // timestamp do servidor
  })
  ```
- **Efêmero como o `typing`**: vai por WebSocket para a sala já calculada pelo servidor
  (`dm:{id}` ou `channel:{id}`) e **não é persistido**. Não vira linha no banco, não entra em
  backup, e num DM não precisa de `expiresAt` porque simplesmente não existe depois do envio.
- **Rate limit no Redis**, chave `attention:{fromUserId}:{channelId}` com TTL de 30 s — o mesmo
  padrão já usado para presença e typing.
- **Autorização**: participação na conversa ou `SEND_MESSAGES` no canal, resolvido pelo
  `PermissionsService` de sempre. Como qualquer outro evento, a validação é no servidor.
- **No cliente**: um IPC novo no allowlist do preload — `nexus.shakeWindow()` — que no processo
  principal faz `BrowserWindow.flashFrame(true)` e, quando a janela está visível, anima
  `setBounds` por ~800 ms. A animação em si é feita no processo principal porque só ele
  controla a posição da janela real.
- **Preferências** em `UserSettings`: `attentionSounds`, `attentionShake` (a opção de
  acessibilidade) e um mute por conversa.

### Esforço estimado

Pequeno: um evento, um endpoint com rate limit, um handler de IPC, uma animação e três
preferências. A parte que merece cuidado não é o código — é a moderação do abuso e a opção de
desligar a animação.

---

## Fase 2 — restante

- Canais de voz com LiveKit: entrar/sair, lista ao vivo de quem está na sala
- Microfone: seleção de dispositivo, teste, ganho, `echoCancellation`, `noiseSuppression`,
  `autoGainControl` (recursos nativos do WebRTC)
- Push-to-talk com atalho global no Windows (funciona com o app minimizado) e voice activity
- Mute e deafen (locais) separados de server mute e server deafen (moderação)
- Volume por usuário, 0–200 %, salvo localmente
- Chamadas privadas em DM: `calling` / `ringing` / `connected` / `ended` / `missed` / `declined`
- Emissão de token LiveKit validando `CONNECT`, `SPEAK` e `STREAM` — já previsto no backend

## Pendências conhecidas do E2EE

Ficaram fora desta entrega e valem uma fase futura:

- **Anexos de DM ainda não são cifrados no cliente.** A mensagem é, o arquivo não.
  Próximo passo: cifrar com AES-256-GCM antes do upload e mandar a chave dentro do
  envelope Megolm. O servidor passaria a guardar blob opaco.
- **Verificação de contato pela UI.** O número de segurança já é calculado; falta a
  tela para comparar e marcar um dispositivo como verificado.
- **Aviso visual de dispositivo novo** na conversa (o evento já existe no backend).

## Fase 3 — compartilhamento de tela

- Seleção de fonte com miniaturas: monitor, janela ou aplicativo (`desktopCapturer`)
- Resolução (720p / 1080p / 1440p) e FPS (15 / 30 / 60), com modo automático
- Áudio do sistema junto com o vídeo, quando o Windows permitir
- Simulcast/SVC do LiveKit: miniatura em camada baixa, tela cheia em camada alta
- Grade de múltiplos streams, destaque, fullscreen e pop-out
- Indicador claro de "transmitindo" e botão vermelho de parar
- Timeout no SFU: se o app travar durante a transmissão, a presença e o stream são removidos
