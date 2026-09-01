# Atualização automática

O aplicativo se atualiza sozinho. O feed é o **próprio servidor de vocês**, atrás
do Tailscale: quem usa o Nexus já está nessa rede, então não entra loja, conta
nem serviço de terceiros no caminho, e nada novo fica exposto na internet.

## Como funciona para quem usa

1. Ao abrir, e depois a cada 6 horas, o app pergunta ao servidor se há versão nova.
2. Havendo, ele baixa em segundo plano. Ninguém é interrompido.
3. Uma faixa verde avisa que a versão está pronta.
4. **A troca acontece quando a pessoa fecha o aplicativo.**

Não existe botão de "reiniciar agora", de propósito: reiniciar no meio de uma
chamada ou de uma conversa é pior do que esperar a pessoa fechar o app.

Se o servidor estiver fora do ar ou o Tailscale desligado, a verificação falha
em silêncio e o app continua funcionando normalmente.

## Preparar o servidor (uma vez)

> **Onde rodar:** estes comandos são do **servidor**, dentro da sessão SSH
> (Bitvise, terminal do Ubuntu). Não são do PowerShell do Windows — lá o `&&`
> nem é aceito, e `mkdir /opt/...` cria uma pasta `C:\opt` no seu próprio PC.
> Você sabe que está no lugar certo quando o prompt é `root@servidor:...#`.

O feed é uma pasta servida pelo Caddy, só de leitura:

```bash
mkdir -p /opt/nexus/updates
echo "UPDATES_DIR=/opt/nexus/updates" >> /opt/nexus/.env
cd /opt/nexus
./scripts/deploy.sh
```

Confira que a pasta responde. Use o mesmo esquema (`http://` ou `https://`) que
está em `NEXUS_DOMAIN` no `.env` — e sem `-s`, senão um erro de conexão vira
silêncio:

```bash
curl -I http://100.x.y.z/updates/
```

Tem que voltar `HTTP/1.1 200 OK`.

### http ou https?

Acessando o servidor por **IP do Tailscale**, é `http://`. Não é descuido: o
Let's Encrypt só emite certificado para domínio, nunca para IP, então com um
`NEXUS_DOMAIN` começando em `http://` o Caddy desliga o HTTPS automático e a
porta 443 nem abre.

Isso não deixa a atualização desprotegida. O Tailscale já cifra e autentica todo
o tráfego por WireGuard, ponta a ponta, e o feed não existe fora dessa rede —
não há por onde alguém no meio do caminho trocar o instalador. O TLS aqui seria
uma segunda camada dentro de um túnel que já faz esse trabalho.

Se um dia vocês passarem a usar um domínio de verdade, aí `https://` vale, e o
endereço precisa ser trocado **antes de gerar o instalador**.

## Publicar uma versão nova

O endereço do feed **é gravado dentro do executável** no momento em que ele é
gerado. Por isso `NEXUS_UPDATE_URL` precisa estar definido na hora de gerar:

No **seu PC** (é aqui que o instalador é gerado). No PowerShell, `export` não
existe e `&&` não separa comandos — use uma linha por vez:

```powershell
$env:NEXUS_UPDATE_URL = "http://100.x.y.z/updates"
cd apps\desktop
pnpm release:windows
```

Suba a versão em `apps/desktop/package.json` antes de gerar — o
electron-updater compara números de versão, não datas nem hashes. Sem subir o
número, ninguém recebe nada.

Depois publique:

Ainda no seu PC, mas pelo **Git Bash** (o script é bash e usa `scp`):

```bash
NEXUS_SERVER=root@100.x.y.z ./scripts/publish-update.sh
```

O script copia o instalador primeiro e o `latest.yml` depois. A ordem importa:
ao contrário, um cliente que checasse nesse intervalo tentaria baixar um arquivo
que ainda não existe.

## Instalador não assinado

O instalador não tem certificado de assinatura (é pago). Consequências:

- na **primeira** instalação o Windows mostra o aviso de aplicativo desconhecido;
- nas **atualizações** não aparece aviso nenhum: quem substitui os arquivos é o
  próprio Nexus, já instalado.

Isso também significa que a segurança da atualização depende inteiramente de
quem consegue escrever em `/opt/nexus/updates`. Trate essa pasta como trata o
acesso SSH ao servidor.

## O que NÃO foi verificado

O ciclo completo — gerar, publicar, um cliente instalado detectar, baixar e
aplicar — **não foi exercitado**. Este ambiente não roda Windows nem Electron.
O que existe é o código ligado e o caminho documentado; a primeira publicação
de verdade é o teste.

Roteiro para conferir, com duas pessoas:

1. Publique a versão N e instale nos dois computadores.
2. Suba a versão para N+1, gere e publique.
3. Deixe os dois apps abertos e espere (ou reabra) — a faixa verde deve aparecer.
4. Feche e reabra: a versão na barra de usuário deve mudar.

Enquanto esse roteiro não passar, trate a atualização automática como
**não comprovada** e mande o instalador na mão.
