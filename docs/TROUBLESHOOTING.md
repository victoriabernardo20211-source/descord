# Solução de problemas

## "Não foi possível conectar ao servidor"

O app mostra essa tela quando `/api/health` não responde.

1. O endereço está certo? Deve incluir `https://` e **não** terminar em barra.
2. O servidor está no ar?
   ```bash
   curl -v https://SEU-DOMINIO/api/health
   ```
3. Se o `curl` funciona na VPS mas não no PC: DNS ou firewall.
   ```bash
   dig +short SEU-DOMINIO      # aponta para o IP certo?
   sudo ufw status             # 80 e 443 liberados?
   ```
4. Usando Tailscale? Confirme que o computador está conectado à tailnet: `tailscale status`.

## "blocked by CORS policy" no console do app

`CORS_ORIGINS` está restrito a algum endereço. O app desktop carrega de
`http://localhost:5173` em desenvolvimento e de `file://` quando empacotado — nunca do
endereço do servidor — então qualquer restrição bloqueia o próprio aplicativo.

```bash
cd /opt/nexus
sed -i 's|^CORS_ORIGINS=.*|CORS_ORIGINS=*|' .env
./scripts/deploy.sh
```

Isso não afrouxa a segurança: a autenticação é por token no cabeçalho, não por cookie.
Ver `docs/SECURITY.md`.

## Certificado inválido / erro de HTTPS

O Caddy só consegue emitir o certificado se o DNS já apontar para a VPS **e** a porta 80
estiver acessível de fora.

```bash
docker compose --env-file .env -f infrastructure/docker/docker-compose.yml logs caddy | tail -50
```

Erros de ACME aparecem aí. Causas comuns: DNS ainda propagando, porta 80 bloqueada, ou limite
de emissões do Let's Encrypt (5 por semana para o mesmo domínio — espere ou use um subdomínio
diferente enquanto testa).

## WebSocket desconectando toda hora

- A barra "Reconectando…" aparecendo de vez em quando é normal em rede instável; o backoff
  reconecta sozinho.
- Se **nunca** conecta, verifique se o proxy faz o upgrade. O `Caddyfile` do projeto já faz.
  Atrás de outro proxy (Cloudflare, nginx), confirme que WebSocket está habilitado.
- Sessão revogada também derruba: a conexão cai e o app volta para o login. Esperado.

## "required variable POSTGRES_PASSWORD is missing a value"

O `docker compose` procura o `.env` **no diretório do arquivo compose**
(`infrastructure/docker/`), não onde você está. Use sempre `--env-file`:

```bash
cd /opt/nexus
docker compose --env-file .env -f infrastructure/docker/docker-compose.yml ps
```

Os scripts do projeto já fazem isso. O erro só aparece em comandos digitados à mão.

## Docker não inicia

```bash
sudo systemctl status docker
sudo systemctl start docker
docker compose --env-file .env -f infrastructure/docker/docker-compose.yml ps
```

Container reiniciando em loop:

```bash
docker compose --env-file .env -f infrastructure/docker/docker-compose.yml logs --tail 100 server
```

Quase sempre é `.env` incompleto. O backend valida a configuração na inicialização e diz
exatamente qual variável está faltando ou inválida.

## PostgreSQL indisponível

```bash
docker compose --env-file .env -f infrastructure/docker/docker-compose.yml ps postgres
docker compose --env-file .env -f infrastructure/docker/docker-compose.yml logs postgres | tail -30
```

- `POSTGRES_PASSWORD` vazio → o compose se recusa a subir (proposital).
- Disco cheio: `df -h`.
- Migration falhando: o entrypoint mostra o erro do `prisma migrate deploy`. Restaure o backup
  antes de tentar consertar o schema na mão.

## Redis indisponível

```bash
docker compose --env-file .env -f infrastructure/docker/docker-compose.yml logs redis | tail -30
```

Com o Redis fora do ar, **as mensagens continuam funcionando** (Postgres é a fonte da verdade),
mas presença, digitação e a fila de expiração param. Quando ele volta, a reconciliação de 60 s
recupera a expiração automaticamente — nenhuma DM deixa de ser apagada por causa disso.

## `GET /api/health` responde "degraded"

O campo `services` diz qual componente está fora:

```bash
curl -s https://SEU-DOMINIO/api/health | jq
```

## Mensagem privada não sumiu no horário

1. Ela **já está inacessível** pela API assim que `expiresAt` passa, mesmo antes de a linha ser
   apagada. Se ainda aparece na tela, é cache do cliente: reabra a conversa.
2. Veja o job:
   ```bash
   docker compose logs server | grep -i "removida permanentemente"
   ```
3. A reconciliação roda a cada 60 s. Uma diferença de até um minuto entre o contador e o
   sumiço físico é o comportamento esperado.
4. Se nem depois de minutos: confira se o Redis está de pé e se há erro de storage nos logs.

## Upload falhando

- "Arquivo maior que o limite" → aumente `MAX_UPLOAD_SIZE` no `.env` e reinicie o servidor.
- "Esse tipo de arquivo não é permitido" → o tipo é detectado pelo **conteúdo**, não pela
  extensão. Executáveis são bloqueados de propósito.
- Erro 500 no upload → provavelmente disco cheio na VPS: `df -h`.

## "Failed to switch pnpm to v10.33.0"

O pnpm instalado é diferente do que o projeto fixa, e a troca automática falha no
Windows. Instale a versão exata:

```powershell
npm install -g pnpm@10.33.0
```

## "npm.ps1 não pode ser carregado porque a execução de scripts foi desabilitada"

O PowerShell bloqueia scripts por padrão. Libere para o seu usuário (não precisa de
administrador, não altera o sistema todo):

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Alternativa sem mexer na política: use `npm.cmd` e `pnpm.cmd` no lugar de `npm` e `pnpm`.

## "Cannot create symbolic link" ao gerar o instalador

O `electron-builder` extrai um pacote que contém links simbólicos, e o Windows só permite
criá-los com Modo de Desenvolvedor ligado ou como Administrador.

Configurações → Sistema → Para desenvolvedores → **Modo de desenvolvedor: Ativado**.
Depois rode a build de novo. Ver `docs/WINDOWS_CLIENT.md`.

## Windows Firewall / SmartScreen

- SmartScreen avisando na instalação é esperado (o app não é assinado): **Mais informações →
  Executar assim mesmo**.
- Se o Windows perguntar sobre acesso à rede, autorize em **redes privadas**.

---

## Fase 2/3 — voz e tela (ainda não implementadas)

Guardado aqui para quando essa camada entrar.

### Microfone não aparece

Windows: Configurações → Privacidade → Microfone → permitir para aplicativos da área de
trabalho. Depois reinicie o Nexus. Em Configurações → Voz e Vídeo o app lista os dispositivos
e permite testar a captura.

### "Malformed constraint" ao compartilhar tela

Corrigido. A captura usa `getUserMedia` com as constraints legadas do Chromium, porque o
`getDisplayMedia` abriria o seletor do sistema em vez de usar a fonte escolhida no app —
e os dois formatos de constraint não podem ser misturados. Se voltar a aparecer, é sinal
de que alguém reintroduziu `getDisplayMedia` em `apps/desktop/src/lib/voice.ts`.

### "v1 RTC path not found" ou "Cannot read properties of undefined (reading 'publisher')"

O servidor LiveKit está mais antigo que o SDK do app. A sinalização até conecta pelo
caminho legado, mas o transporte de publicação não se estabelece — e aí qualquer tentativa
de publicar microfone ou tela quebra.

```bash
cd /opt/nexus
docker compose --env-file .env -f infrastructure/docker/docker-compose.yml pull livekit
./scripts/deploy.sh
docker compose --env-file .env -f infrastructure/docker/docker-compose.yml logs livekit | head -20
```

### Stream aparece preto

Costuma ser aceleração de hardware brigando com a captura de janela. Tente compartilhar o
**monitor inteiro** em vez da janela, ou rode o jogo em "janela sem bordas" em vez de tela
cheia exclusiva.

### Sem áudio no compartilhamento

A captura de áudio de aplicativo tem limitações no Windows. O caminho mais confiável é
compartilhar a tela **com áudio do sistema**; áudio por aplicativo específico é menos estável.
O microfone é uma track independente e continua funcionando de qualquer forma.

### "Failed to resolve address for global.stun.twilio.com" repetindo no log

STUN público sendo anunciado numa rede que não o alcança. Em Tailscale ele é
desnecessário — deixe `LIVEKIT_STUN_SERVERS=` vazio no `.env` e rode `./scripts/deploy.sh`.
São mensagens de ruído: não impedem a chamada, mas atrasam a negociação.

### TURN falhando / não conecta a chamada

Sem TURN, quem está atrás de NAT simétrico não conecta.

```bash
sudo ufw allow 7881/tcp
sudo ufw allow 50000:60000/udp
docker compose logs livekit | grep -i turn
```

Se todos usam Tailscale, o problema praticamente desaparece: a tailnet já resolve NAT.
