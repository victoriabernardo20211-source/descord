# Segurança e privacidade

Este documento descreve **o que o sistema realmente garante** — e, com a mesma clareza,
o que ele ainda não garante.

## Autenticação

| Item | Implementação |
|---|---|
| Hash de senha | **Argon2id**, 19 MiB de memória, 2 iterações. Senha nunca em texto puro, em lugar nenhum. |
| Access token | JWT, validade curta (15 min por padrão). |
| Refresh token | 48 bytes aleatórios opacos. O banco guarda **apenas o SHA-256** — um dump não permite se passar por ninguém. |
| Rotação | Cada refresh invalida o token anterior no mesmo instante. |
| Revogação | Toda requisição confere a sessão no banco, então revogar derruba o dispositivo imediatamente, sem esperar o token expirar. |
| Troca de senha | Derruba **todas** as sessões do usuário. |
| Enumeração de e-mails | O login compara contra um hash falso quando o usuário não existe, para não vazar quais e-mails estão cadastrados por diferença de tempo. |

Cada dispositivo é uma sessão nomeada. O usuário lista os dispositivos conectados
(`GET /api/auth/sessions`) e desconecta qualquer um deles.

## Autorização

**Nenhum endpoint confia em `userId` vindo do cliente.** A identidade sai sempre do token
validado pelo guard, e o guard é global: uma rota só fica aberta com `@Public()` explícito.

Toda decisão de permissão passa por `PermissionsService`. Regras que valem em todo o sistema:

- `VIEW_CHANNEL` é pré-requisito de qualquer ação dentro de um canal.
- Um membro só age sobre outro se estiver **estritamente acima** na hierarquia; o dono nunca é alvo.
- Quem tem `MANAGE_ROLES` **não pode conceder uma permissão que ele mesmo não tem** — isso fecha
  o caminho clássico de escalada de privilégio.
- `@everyone` não pode ser removido nem retirado de um membro.

## WebSocket

O handshake exige um access token válido **e** uma sessão não revogada. O cliente nunca pede
para entrar em uma sala: o servidor calcula as salas a partir das associações reais no banco.
`socket.join(idArbitrário)` não existe como caminho possível.

Digitação é efêmera: passa por WebSocket, nunca é persistida, e só é ecoada para salas em que
o socket já está.

## Uploads

- Tamanho limitado (`MAX_UPLOAD_SIZE`, padrão 100 MB).
- **MIME detectado pelo conteúdo** (magic bytes), não pela extensão nem pelo header enviado.
  Um `.exe` renomeado para `.png` é rejeitado.
- Allowlist de tipos; executáveis não entram.
- Nome no disco é aleatório (CUID2). O nome original é só um rótulo — nunca vira caminho.
- Path traversal bloqueado: nenhuma chave de storage escapa do diretório raiz.
- Download **sempre** exige autorização: anexo de canal pede `VIEW_CHANNEL` +
  `READ_MESSAGE_HISTORY`; anexo de DM pede participação na conversa **e** que a mensagem ainda
  não tenha expirado.
- Resposta com `X-Content-Type-Options: nosniff` e `Cache-Control: private, no-store`.

## Mensagens privadas: o que é garantido

`expiresAt = createdAt + 8h`, em UTC, calculado só no servidor.

**Garantias:**

1. A API **nunca** devolve uma mensagem vencida, mesmo com fila e cron parados — o filtro
   `expiresAt > now()` está em toda leitura, inclusive no download de anexo.
2. O conteúdo é apagado do banco e os arquivos do storage (original e miniatura), em transação.
3. Nenhuma rota aceita `expiresAt` do cliente. Não existe pin de DM. Editar não renova o prazo.
   Nem o administrador global consegue preservar uma mensagem privada.
4. Reiniciar o backend não cancela a expiração (nada depende de `setTimeout`).
5. Reiniciar o Redis não cancela a expiração (a reconciliação de 60 s cobre a fila perdida).
6. Ficar fora do ar não cancela: o purge de inicialização roda antes de aceitar tráfego.
7. **Restaurar um backup não ressuscita nada** — o mesmo purge apaga tudo que já venceu.
8. Cache: o cliente remove a mensagem ao receber `dm.expired` e purga o que estiver vencido ao
   iniciar. O servidor rejeita o anexo de qualquer forma.
9. A auditoria nunca registra conteúdo de DM.

**Limite honesto:** entre o instante da expiração e a execução da exclusão existe uma janela
de até 60 s em que a linha ainda pode existir fisicamente no banco (por exemplo, se a fila
falhou). Nessa janela ela já é **inacessível** por qualquer API. Quem tem acesso `psql` direto
ao servidor pode ver essa linha. Isso é uma consequência de o servidor ser seu.

## Criptografia: o que existe hoje

Seja claro sobre o nível real alcançado:

| Camada | Situação |
|---|---|
| Em trânsito | **TLS** (HTTPS/WSS) via Caddy, ou a rede criptografada do Tailscale (WireGuard). |
| Mídia (Fase 2/3) | **DTLS-SRTP**, obrigatório no WebRTC. |
| Senhas | Argon2id. |
| Refresh tokens | Apenas o hash é armazenado. |
| **Mensagens em repouso** | **Texto legível no PostgreSQL.** Quem administra o servidor pode lê-las. |

Ou seja: **isto não é criptografia ponta-a-ponta.** O modelo de confiança é "o servidor é
nosso e o administrador é de confiança" — razoável para 9 amigos com uma VPS própria, mas
precisa ser dito, não presumido.

Melhorias possíveis, em ordem de custo:

1. **Disco criptografado na VPS** (LUKS) — protege contra o provedor ou um disco descartado.
   Barato e sem mudança de código.
2. **Criptografia em repouso por conversa** — a chave fica no servidor. Protege contra dump de
   banco vazado, não contra o administrador.
3. **Ponta a ponta de verdade** — usar uma implementação estabelecida do **protocolo Signal**
   (por exemplo `libsignal`), com chaves geradas e guardadas **apenas** nos dispositivos.
   Muda muita coisa: histórico não sincroniza sozinho num dispositivo novo, busca no servidor
   deixa de funcionar, anexos precisam ser cifrados antes do upload, e é preciso resolver
   verificação de dispositivos. É uma fase própria, não um ajuste.

**Nunca implemente criptografia caseira.** Se for fazer E2E, use uma biblioteca auditada e um
protocolo estabelecido.

## Cliente desktop

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. O renderer não tem
acesso a `fs`, `path`, `child_process` nem ao `ipcRenderer` cru — só às funções nomeadas do
preload, todas com argumentos validados no processo principal.

Navegação arbitrária é bloqueada; links externos abrem no navegador do sistema (só `http`/`https`).
CSP proíbe script externo, `eval` e iframes.

**Markdown nunca vira HTML.** O conteúdo recebido é renderizado como elementos React —
`dangerouslySetInnerHTML` não é usado em lugar nenhum. XSS por mensagem é impossível por
construção, não por sanitização.

No logout: tokens, refresh token no disco, estado do WebSocket e todo conteúdo em memória são
descartados.

## Rede

- HTTPS e WSS obrigatórios em produção (Caddy resolve o certificado).
- Cabeçalhos: HSTS, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`.
- CORS restrito a origens configuradas.
- **PostgreSQL e Redis não expõem portas** no `docker-compose.yml` de produção — só a rede
  interna do Docker os enxerga. O Redis ainda assim exige senha.
- Swagger só existe fora de produção.

## Rate limiting

| Ação | Limite |
|---|---|
| Login | 10 / min |
| Cadastro | 5 / min |
| Refresh | 30 / min |
| Mensagens | 30 / 10 s |
| Uploads | 20 / min |
| Solicitações de amizade | 10 / min |
| Global | 300 / min |

## O que os logs contêm

Erros, falhas de autenticação, jobs, limpeza de DMs, eventos de inicialização.
**Não contêm:** senhas, tokens completos, nem conteúdo de mensagens privadas.

## Checklist de produção

- [ ] `JWT_SECRET` e `JWT_REFRESH_SECRET` gerados com `openssl rand -base64 48`
- [ ] `POSTGRES_PASSWORD` e `REDIS_PASSWORD` fortes e únicos
- [ ] `REGISTRATION_INVITE_CODE` definido (fecha o cadastro)
- [ ] `INITIAL_ADMIN_EMAIL` definido antes da primeira conta
- [ ] `CORS_ORIGINS` restrito
- [ ] `.env` com permissão `600`, fora do git
- [ ] Firewall: só 22, 80, 443 (+ UDP do WebRTC na Fase 2)
- [ ] Backups agendados e **uma restauração testada**
- [ ] Disco da VPS criptografado, se o modelo de ameaça pedir
