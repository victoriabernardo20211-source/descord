# Instalação do servidor

Passo a passo para uma VPS **Ubuntu 24.04 LTS**. Os comandos podem ser copiados e colados
na ordem. Nenhuma etapa foi omitida.

Recomendado: 4 vCPU, 8 GB RAM, boa saída de rede (ver [`BANDWIDTH.md`](BANDWIDTH.md) para o
dimensionamento do compartilhamento de tela).

---

## 1. Sistema

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git ufw
sudo timedatectl set-timezone UTC     # o servidor trabalha em UTC
```

## 2. Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
newgrp docker                          # ou saia e entre de novo
docker --version && docker compose version
```

## 3. Firewall

```bash
sudo ufw allow 22/tcp        # SSH
sudo ufw allow 80/tcp        # HTTP (renovação do certificado)
sudo ufw allow 443/tcp       # HTTPS
sudo ufw allow 443/udp       # HTTP/3
# Fase 2/3 — mídia WebRTC do LiveKit:
# sudo ufw allow 7881/tcp
# sudo ufw allow 50000:60000/udp
sudo ufw enable
sudo ufw status
```

**Nunca** abra 5432 (PostgreSQL) nem 6379 (Redis). No `docker-compose.yml` de produção eles
sequer publicam portas.

## 4. Código

```bash
sudo mkdir -p /opt/nexus && sudo chown "$USER":"$USER" /opt/nexus
git clone <url-do-seu-repositorio> /opt/nexus
cd /opt/nexus
```

## 5. Segredos

```bash
cp apps/server/.env.example .env
echo "JWT_SECRET=$(openssl rand -base64 48)"          >> .env
echo "JWT_REFRESH_SECRET=$(openssl rand -base64 48)"  >> .env
echo "POSTGRES_PASSWORD=$(openssl rand -base64 32)"   >> .env
echo "REDIS_PASSWORD=$(openssl rand -base64 32)"      >> .env
chmod 600 .env
nano .env
```

Ajuste no `.env`:

```ini
NODE_ENV=production
NEXUS_DOMAIN=chat.seudominio.com
PUBLIC_URL=https://chat.seudominio.com
CORS_ORIGINS=https://chat.seudominio.com
INITIAL_ADMIN_EMAIL=voce@seuemail.com      # esta conta vira admin global
REGISTRATION_INVITE_CODE=algo-que-so-voces-sabem
```

Remova as linhas duplicadas de `JWT_SECRET`/`JWT_REFRESH_SECRET` que vieram do exemplo,
mantendo só as geradas. Confira: `grep -c JWT_SECRET .env` deve devolver `1`.

---

## Opção A — servidor público com HTTPS

### 6A. DNS

No painel do seu domínio, crie um registro **A** apontando para o IP da VPS:

```
chat.seudominio.com.    A    <IP-DA-VPS>
```

Confirme a propagação antes de subir (o Caddy precisa disso para emitir o certificado):

```bash
dig +short chat.seudominio.com
```

### 7A. Subir

```bash
cd /opt/nexus
./scripts/preflight.sh    # confere segredos, NODE_ENV, DNS e permissões do .env
./scripts/deploy.sh       # backup (se já houver dados), build, up -d, espera o health check
```

O `preflight.sh` falha com uma lista do que está errado em vez de deixar o container subir e
quebrar depois. Para acompanhar os logs:

```bash
docker compose -f infrastructure/docker/docker-compose.yml logs -f
```

O Caddy emite o certificado sozinho no primeiro acesso. Verifique:

```bash
curl https://chat.seudominio.com/api/health
```

Resposta esperada: `{"status":"ok", ...}` com `postgres` e `redis` em `ok`.

---

## Opção B — rede privada com Tailscale (recomendada)

Para 9 amigos, esta é a topologia mais segura: **nada** fica exposto na internet.

### 6B. Tailscale na VPS

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
tailscale ip -4          # ex.: 100.101.102.103
```

### 7B. HTTPS dentro da tailnet

Ative MagicDNS e HTTPS no painel do Tailscale e use o nome da máquina:

```bash
sudo tailscale cert nexus.seu-tailnet.ts.net
```

No `.env`:

```ini
NEXUS_DOMAIN=nexus.seu-tailnet.ts.net
PUBLIC_URL=https://nexus.seu-tailnet.ts.net
```

Feche o firewall para o mundo — só a interface do Tailscale entra:

```bash
sudo ufw delete allow 80/tcp
sudo ufw delete allow 443/tcp
sudo ufw allow in on tailscale0
```

### 8B. Nos computadores dos amigos

Cada um instala o Tailscale ([tailscale.com/download](https://tailscale.com/download)),
entra na sua tailnet a convite, e no Nexus informa `https://nexus.seu-tailnet.ts.net`.
Pronto — sem domínio, sem porta aberta, sem certificado para gerenciar.

Bônus: o Tailscale já resolve NAT, o que simplifica bastante o WebRTC da Fase 2.

---

## 8. Primeiro usuário e administrador

Com o servidor no ar, abra o app desktop, informe o endereço e crie a conta usando **o mesmo
e-mail** de `INITIAL_ADMIN_EMAIL` (e o `REGISTRATION_INVITE_CODE`, se definido). Essa conta
vira administrador global automaticamente.

Depois, crie um servidor pelo botão `+` e gere um convite para os amigos.

## 9. Backups automáticos

```bash
sudo crontab -e
```

```cron
0 4 * * * cd /opt/nexus && BACKUP_DIR=/var/backups/nexus ./scripts/backup.sh >> /var/log/nexus-backup.log 2>&1
```

**Teste a restauração pelo menos uma vez** — um backup nunca testado não é um backup:

```bash
./scripts/restore.sh /var/backups/nexus/nexus-db-<stamp>.sql.gz
```

Restaurar não traz DMs expiradas de volta: o purge de inicialização as remove antes de o
servidor aceitar tráfego.

## 10. Atualizações

```bash
cd /opt/nexus
git pull
./scripts/deploy.sh
```

O `deploy.sh` faz backup antes de reconstruir, sobe os serviços e só devolve o controle quando
o health check fica verde (ou mostra os logs se falhar). As migrations rodam sozinhas no
entrypoint (`prisma migrate deploy`).

## 11. Operação do dia a dia

```bash
cd /opt/nexus
COMPOSE="docker compose -f infrastructure/docker/docker-compose.yml"

$COMPOSE ps                    # estado dos serviços
$COMPOSE logs -f server        # logs ao vivo
$COMPOSE logs --tail 200 server
$COMPOSE restart server
$COMPOSE down                  # para tudo (os volumes ficam)
curl -s https://SEU-DOMINIO/api/health | jq
```

Ver quanto espaço os anexos ocupam:

```bash
docker run --rm -v nexus_storage-data:/data alpine du -sh /data
```
