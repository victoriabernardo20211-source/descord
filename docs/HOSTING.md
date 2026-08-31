# Onde hospedar o servidor

Resumo: **Vercel não serve** para este backend. Uma VPS barata serve, e é de longe a
opção mais econômica quando a Fase 3 (compartilhamento de tela) entrar.

## Por que o Vercel não funciona aqui

O Vercel é excelente para sites e APIs sem estado. O Nexus é o oposto disso em quase
tudo que importa:

| O que o Nexus precisa | O que o Vercel oferece |
|---|---|
| **WebSocket persistente** (Socket.IO): conexão aberta enquanto o app estiver aberto | Funções serverless com tempo máximo de execução. Não há processo para manter a conexão. |
| **Worker BullMQ** rodando de forma contínua para expirar as DMs no instante exato | Não existe processo de longa duração. |
| **Reconciliação a cada 60 s** — a rede de segurança da regra de 8 horas | Vercel Cron tem intervalo mínimo bem maior que isso (no plano gratuito, uma vez por dia). |
| **Purge na inicialização**, antes de aceitar tráfego | Não há "inicialização": cada requisição pode subir uma instância nova. |
| **Redis** para presença, digitação e filas | Não incluso (precisaria de um serviço externo). |
| **Disco** para os anexos | Sistema de arquivos efêmero. Uploads se perderiam. |
| **UDP** para voz e tela (Fase 2/3) | Não suportado. Nem com adaptação. |

As três primeiras linhas são fatais: sem processo contínuo, **a garantia de expiração
em 8 horas deixa de valer** — e ela é a regra central do produto.

### Para o que o Vercel *seria* ótimo

Uma página de download do instalador, para os amigos baixarem o `Nexus-Setup.exe`
sem você mandar o arquivo por WhatsApp. É estático e cabe no plano gratuito. Só não
tem relação com o servidor.

## Opções que funcionam

### 1. VPS — recomendada

Uma máquina Linux comum. É para isso que o `docker compose up -d` do projeto foi feito;
tudo funciona sem nenhuma alteração de código.

- Custo típico: algo entre US$ 5 e 15 por mês para 4 vCPU / 8 GB.
- Provedores comuns: Hetzner, DigitalOcean, Vultr, Contabo, Oracle Cloud (tem camada
  gratuita razoável).
- Passo a passo pronto em [`SERVER_SETUP.md`](SERVER_SETUP.md).

**A vantagem decisiva é o tráfego.** VPS normalmente inclui vários TB por mês no preço.
Plataformas gerenciadas cobram por GB que sai. Com compartilhamento de tela isso deixa
de ser detalhe:

> Uma transmissão 1080p60 para 8 amigos gera cerca de **21 GB por hora** de saída
> (ver [`BANDWIDTH.md`](BANDWIDTH.md)). Três horas por dia dão aproximadamente
> **2 TB por mês**.

Numa VPS com tráfego incluso, isso custa zero a mais. Cobrado por GB, na ordem de
grandeza usual dessas plataformas, viraria centenas de dólares por mês. Confira os
preços atuais antes de decidir — mas a diferença de ordem de grandeza é estável.

### 2. Railway / Render / Fly.io — funcionam, com ressalvas

Suportam processo contínuo e WebSocket, então o backend roda. O que muda:

- Postgres e Redis viram serviços gerenciados (ajustar `DATABASE_URL` e `REDIS_URL`).
- O disco é efêmero: é preciso implementar o `S3StorageProvider` e usar S3, R2 ou
  similar. A abstração `StorageProvider` já existe justamente para isso — falta só a
  implementação.
- O tráfego é cobrado por GB. Aceitável enquanto for só texto e voz; caro com tela.
- **Fly.io** é o mais promissor dos três para as Fases 2/3, porque suporta UDP —
  necessário para o LiveKit.

### 3. Um PC seu em casa + Tailscale

Se você já tem um computador que fica ligado, ele é servidor suficiente para 9 pessoas.
Com Tailscale não precisa de IP fixo, domínio, nem abrir porta nenhuma no roteador — e
o tráfego de tela nem sai para a internet quando vocês estiverem na mesma rede.

Contras: se o PC desliga, o Nexus cai; e o upload da sua internet residencial vira o
limite do compartilhamento de tela (veja `BANDWIDTH.md` — 1080p60 exige upload folgado).

## Recomendação

Comece com uma **VPS pequena** e a topologia **Tailscale** descrita em
[`SERVER_SETUP.md`](SERVER_SETUP.md): nada exposto na internet, sem domínio para
configurar, sem certificado para renovar, e o NAT já resolvido para quando a voz entrar.

Se o compartilhamento de tela em alta qualidade for prioridade, olhe o tráfego incluso
no plano antes de olhar o preço.
