# Banda e dimensionamento

Estimativas para planejar a VPS antes de ligar o compartilhamento de tela (Fase 3).

## Bitrate por qualidade

Valores típicos de vídeo de tela em WebRTC (VP9/AV1; H.264 costuma ficar ~30 % acima):

| Qualidade | Bitrate de vídeo | Observação |
|---|---|---|
| 720p30 | ~1,5 Mbps | ótimo para conversa e código |
| 1080p30 | ~3 Mbps | padrão para jogos |
| 1080p60 | ~6 Mbps | jogos com movimento rápido |
| 1440p60 | ~10 Mbps | exige boa saída no transmissor |

Somar por participante: **microfone** ~40 kbps (Opus) e, quando houver, **áudio da tela**
~128 kbps. São desprezíveis perto do vídeo.

## Mesh P2P × SFU

Em **mesh**, o transmissor envia uma cópia para cada espectador. Com 8 amigos assistindo:

| Qualidade | Upload do transmissor (mesh) | Upload do transmissor (SFU) |
|---|---|---|
| 720p30 | 12 Mbps | **1,5 Mbps** |
| 1080p30 | 24 Mbps | **3 Mbps** |
| 1080p60 | 48 Mbps | **6 Mbps** |
| 1440p60 | 80 Mbps | **10 Mbps** |

Conexão doméstica brasileira típica tem 20–50 Mbps de **upload** em fibra e bem menos em
outras tecnologias. Mesh com 1080p60 simplesmente não funciona. Por isso a arquitetura usa
**SFU**: o transmissor envia uma vez, o servidor replica.

## Saída do servidor (SFU)

O custo migra para a VPS: `saída ≈ bitrate × número de espectadores`.

**Um transmissor, 8 espectadores:**

| Qualidade | Entrada no servidor | Saída do servidor |
|---|---|---|
| 720p30 | 1,5 Mbps | 12 Mbps |
| 1080p30 | 3 Mbps | 24 Mbps |
| 1080p60 | 6 Mbps | **48 Mbps** |
| 1440p60 | 10 Mbps | 80 Mbps |

**Cenários combinados (9 pessoas na sala, todas com microfone):**

| Cenário | Saída aproximada |
|---|---|
| Só voz, 9 pessoas | ~3 Mbps |
| 1 stream 1080p30 + 4 assistindo | ~13 Mbps |
| 1 stream 1080p60 + 8 assistindo | ~48 Mbps |
| 2 streams 1080p60, todos assistindo os dois | ~96 Mbps |

## O que isso significa na prática

Uma VPS de **4 vCPU / 8 GB** com porta de **1 Gbps** aguenta o caso de uso com folga
confortável. O gargalo raramente é CPU: o SFU **encaminha** pacotes, não recodifica.

Atenção ao **limite de tráfego mensal** do provedor, que costuma ser o custo real:

> 48 Mbps × 3 600 s ≈ **21,6 GB por hora** de transmissão 1080p60 para 8 pessoas.

Quatro horas por dia, todo dia, dão ~2,6 TB/mês. Muitos planos incluem 2–20 TB; confira antes.
Se apertar, 1080p30 corta o consumo pela metade.

## Qualidade adaptativa

O LiveKit resolve isso sozinho, e o projeto vai usar os recursos dele em vez de reinventar:

- **Simulcast** — o transmissor publica várias resoluções ao mesmo tempo; cada espectador
  recebe a que sua conexão suporta.
- **SVC** (AV1/VP9) — camadas dentro de um único stream, mais eficiente que simulcast.
- **Assinatura por qualidade** — quem está vendo a miniatura recebe a camada baixa; só quem
  abre em tela cheia puxa a alta. Isso derruba bastante a saída em grades com vários streams.

Com simulcast ligado, a saída real fica **abaixo** das tabelas acima, porque nem todo
espectador consome a camada máxima.

## Recomendação inicial

Comece com o padrão em **1080p30** e deixe 1080p60 disponível para quem quiser. Se a saída do
servidor virar problema, o primeiro ajuste é limitar o bitrate máximo de publicação no LiveKit —
não precisa mexer na aplicação.
