# Voz e compartilhamento de tela

Implementado nas Fases 2 e 3. **Ainda não foi testado com áudio e vídeo reais** — ver
[Teste manual](#teste-manual) no fim, que é o que fecha essa lacuna.

## Como está montado

```
Cliente ──1. pede token──►  Backend ──valida CONNECT / SPEAK / STREAM
        ◄─2. token assinado─┘
        ──3. mídia (WebRTC/UDP)──►  LiveKit (SFU)
                                     │
Backend ◄──4. webhook de saída───────┘
```

O backend **não transporta mídia**. Ele assina um token com os grants mínimos e o LiveKit
confia nesse token — o SFU nunca consulta o nosso banco.

**Os grants vêm das permissões reais**, e é isso que impede um cliente adulterado de
transmitir sem poder:

| Permissão | O que o token libera |
|---|---|
| `CONNECT` | entrar na sala (sem isso o token nem é emitido) |
| `SPEAK` | publicar o microfone |
| `STREAM` | publicar tela, áudio da tela e câmera |

Sem `SPEAK`, o token sai com `canPublish: false` — a pessoa ouve e não fala. Nenhum token
concede administração do SFU, nem para o dono do servidor.

## Configuração

Gere as chaves e complete o `.env`:

```bash
cd /opt/nexus
echo "LIVEKIT_API_KEY=$(openssl rand -hex 16)" >> .env
echo "LIVEKIT_API_SECRET=$(openssl rand -base64 36 | tr -d '\n/+=')" >> .env
```

Depois edite o `.env` conforme a sua topologia:

**Com Tailscale** (recomendado — o IP 100.x é o da sua máquina):

```ini
LIVEKIT_URL=ws://100.119.135.125:7880
LIVEKIT_NODE_IP=100.119.135.125
LIVEKIT_USE_EXTERNAL_IP=false
LIVEKIT_WEBHOOK_URL=http://127.0.0.1:4000/api/voice/webhook
```

`LIVEKIT_NODE_IP` é o detalhe que mais quebra: é o endereço que o LiveKit anuncia nos
candidatos ICE. Se ele anunciar o IP público enquanto os clientes estão na rede privada,
a chamada conecta na sinalização e **nunca sai do "conectando"** — sem erro visível.

**Com domínio público:**

```ini
LIVEKIT_URL=wss://livekit.seudominio.com
LIVEKIT_USE_EXTERNAL_IP=true
```

E libere as portas do WebRTC:

```bash
ufw allow 7880/tcp     # sinalização
ufw allow 7881/tcp     # fallback TCP, para redes que bloqueiam UDP
ufw allow 7882/udp     # mídia (uma porta só, via mux)
```

Suba com `./scripts/deploy.sh`. Confirme que o LiveKit subiu:

```bash
docker compose --env-file .env -f infrastructure/docker/docker-compose.yml logs livekit | tail -20
curl -s http://127.0.0.1:4000/api/voice/status   # esperado: {"configured":true}
```

## Recursos

- **Microfone** com supressão de ruído, cancelamento de eco e ganho automático — recursos
  nativos do WebRTC, configuráveis por usuário.
- **Push-to-talk** com atalho **global**: funciona com o Nexus minimizado.
- **Silenciar** e **ensurdecer** (ensurdecer fecha o microfone junto).
- **Volume por pessoa, 0–200%** — preferência local, não vai para o servidor.
- **Moderação**: silenciar, ensurdecer, desconectar. Exige `MUTE_MEMBERS`, `DEAFEN_MEMBERS`
  ou `MOVE_MEMBERS`, e só age sobre quem está abaixo na hierarquia.
  *Server mute* é diferente de *self mute*: o usuário não desfaz sozinho.
- **Compartilhamento de tela** com escolha explícita de monitor, janela ou aplicativo,
  com miniatura. Nada é capturado antes de confirmar.
- **Qualidade**: 720p / 1080p / 1440p, 15 / 30 / 60 FPS, com áudio opcional.
- **Simulcast e dynacast**: quem vê a miniatura recebe camada baixa; só quem abre em
  destaque puxa a alta. É o que segura a banda de saída (ver `BANDWIDTH.md`).
- **Recuperação de queda**: o webhook `participant_left` do LiveKit limpa o estado, então
  ninguém fica eternamente marcado como "transmitindo" depois de travar.

## Teste manual

Nada disso pode ser verificado por teste automatizado — precisa de microfone, tela e duas
pessoas. Faça nesta ordem; cada item que falhar aponta para uma causa diferente.

### Voz (duas pessoas)

1. Os dois entram no mesmo canal de voz. **Esperado:** cada um vê o outro na lista, sob o canal.
2. Falem. **Esperado:** ouvem-se mutuamente.
   *Se conecta mas não sai áudio*, quase sempre é `LIVEKIT_NODE_IP` errado.
3. Um silencia o microfone. **Esperado:** o ícone muda para os dois e o áudio cessa.
4. Um ensurdece. **Esperado:** ele para de ouvir **e** o microfone dele fecha junto.
5. Ajuste o volume de alguém para 200% e 0%. **Esperado:** muda só para quem ajustou.
6. Ative push-to-talk nas configurações, minimize o app e segure a tecla.
   **Esperado:** o microfone abre com o Nexus fora de foco.
7. Um fecha o app à força (Gerenciador de Tarefas).
   **Esperado:** ele some da lista em segundos, sem ficar "fantasma".

### Compartilhamento de tela

8. Clique em "Compartilhar tela". **Esperado:** monitores e janelas aparecem com miniatura.
9. Escolha um jogo em 1080p60 e transmita. **Esperado:** o outro vê, e o indicador AO VIVO aparece.
10. Com "Incluir áudio" ligado. **Esperado:** o outro ouve o som do jogo.
    *No Windows, compartilhar o monitor inteiro é mais confiável que uma janela específica.*
11. Fale ao microfone enquanto transmite. **Esperado:** as duas coisas chegam juntas — são tracks
    independentes.
12. O espectador clica na transmissão. **Esperado:** abre em destaque; duplo clique vai a tela cheia.
13. Duas pessoas transmitindo ao mesmo tempo. **Esperado:** grade com as duas.
14. Pare a transmissão. **Esperado:** o vídeo some imediatamente do lado do espectador.

### Permissões

15. Crie um cargo sem `SPEAK` e aplique a alguém. **Esperado:** entra, ouve, e o microfone
    não publica — o SFU recusa a track, não é só a interface escondendo o botão.
16. Cargo sem `STREAM`. **Esperado:** o botão de transmitir não funciona.
17. Um moderador silencia alguém. **Esperado:** a pessoa não consegue se dessilenciar.

Se algo falhar, `docs/TROUBLESHOOTING.md` tem a seção de voz e tela.
