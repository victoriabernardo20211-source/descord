# Cliente Windows

## Preparando o Windows

Três coisas costumam travar antes mesmo do projeto:

```powershell
# 1. O PowerShell bloqueia scripts por padrão, e sem isto o npm não roda.
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned

# 2. Use a versão de pnpm que o projeto fixa. Outra versão tenta trocar sozinha
#    para a fixada e falha no Windows ("Failed to switch pnpm to v...").
npm install -g pnpm@10.33.0

# 3. Instale só o cliente: evita compilar argon2 e sharp, que precisariam das
#    ferramentas de build do Visual Studio.
pnpm install --filter @nexus/desktop...
pnpm --filter @nexus/shared build
```

Para rodar em desenvolvimento: `pnpm --filter @nexus/desktop dev`.

## Gerando o instalador

Antes da primeira build, **ligue o Modo de Desenvolvedor do Windows**:
Configurações → Sistema → Para desenvolvedores → *Modo de desenvolvedor*.

O `electron-builder` baixa um pacote de assinatura de código (que ele também usa para
gravar o ícone no executável) e esse pacote contém links simbólicos. Sem o Modo de
Desenvolvedor, o Windows recusa criá-los e a build morre com:

```
ERROR: Cannot create symbolic link : O cliente não tem o privilégio necessário
```

Rodar o PowerShell **como Administrador** resolve igual, se você preferir não mexer na
configuração.

```powershell
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
pnpm release:windows
```

`CSC_IDENTITY_AUTO_DISCOVERY=false` evita que ele procure um certificado de assinatura —
o projeto não tem um, e o instalador não é assinado.

Saída: `apps\desktop\release\Nexus-Setup-0.1.0.exe`.

### Com o servidor já embutido (recomendado)

Assim quem recebe o instalador não precisa digitar endereço nenhum — instala, abre e
já cai na tela de login:

```powershell
$env:VITE_DEFAULT_SERVER_URL = "http://100.119.135.125"
pnpm release:windows
```

Troque pelo IP Tailscale do **seu** servidor. Quem já tiver usado o app antes mantém o
endereço que salvou; o valor embutido só vale na primeira execução.

Saída: `apps/desktop/release/Nexus-Setup-0.1.0.exe`.

O instalador NSIS cria atalho na área de trabalho, atalho no menu Iniciar e um desinstalador,
e permite escolher a pasta de instalação.

## Instalando (o que seus amigos fazem)

**Antes de tudo, o Tailscale.** O servidor não existe na internet pública — só dentro da
rede privada. Sem o Tailscale conectado, o app não acha o servidor.

1. Você convida a pessoa: painel do Tailscale → **Users → Invite external user** → mande o
   link. Ela instala o Tailscale (https://tailscale.com/download), aceita o convite e
   entra com a conta dela.
2. Baixar `Nexus-Setup-0.1.0.exe`.
2. Executar. O Windows SmartScreen vai avisar que o app não é assinado — **Mais informações →
   Executar assim mesmo**. (É esperado: assinar exige um certificado de code signing pago.)
3. Abrir o Nexus.
4. Informar o endereço do servidor, se ele não vier embutido no instalador.
5. Criar a conta com o código de convite do servidor (`REGISTRATION_INVITE_CODE`).

Se o app disser "Não foi possível conectar ao servidor", a causa quase sempre é o
Tailscale desconectado nessa máquina.

## Desinstalando

Configurações → Aplicativos → Nexus → Desinstalar. Ou pelo atalho "Uninstall Nexus" no menu
Iniciar.

Sobra a pasta de dados (endereço do servidor e sessão salva). Para limpar tudo:

```
%APPDATA%\Nexus
```

## Onde ficam os dados e os logs do cliente

| O quê | Onde |
|---|---|
| Endereço do servidor e sessão | `%APPDATA%\Nexus\nexus-config.json` |
| Cache do Chromium | `%APPDATA%\Nexus\Cache` |
| Logs de crash | `%APPDATA%\Nexus\Crashpad` |

O `nexus-config.json` guarda o refresh token. Apagar o arquivo desloga o app.

## Vendo erros do cliente

Abra o DevTools com **Ctrl+Shift+I** e olhe o console. Para rodar a partir do código com log
completo:

```bash
pnpm --filter @nexus/desktop dev
```

## Auto-update

A estrutura já está pronta (`electron-updater` instalado, `publish` configurado em
`electron-builder.yml`), mas **desligada** — `release:windows` usa `--publish never`.

Para ligar mais tarde: aponte `publish.url` para um servidor de arquivos ou release do GitHub,
publique os artefatos junto com o `latest.yml` gerado, e chame `autoUpdater.checkForUpdates()`
no processo principal. Nada na arquitetura atual impede isso.
