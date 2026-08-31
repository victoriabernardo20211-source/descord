# Cliente Windows

## Gerando o instalador

Na sua máquina de desenvolvimento (Windows, ou Linux com Wine para o `.exe`):

```bash
pnpm install
pnpm release:windows
```

Saída: `apps/desktop/release/Nexus-Setup-0.1.0.exe`.

O instalador NSIS cria atalho na área de trabalho, atalho no menu Iniciar e um desinstalador,
e permite escolher a pasta de instalação.

### Embutindo o endereço do servidor

Por padrão o app pergunta o endereço na primeira execução. Para entregar aos amigos já
configurado, defina o valor padrão em `apps/desktop/src/store/app.ts` (no `boot()`, quando
`config.apiUrl` estiver ausente) antes de buildar — assim eles só instalam, abrem e entram.

## Instalando (o que seus amigos fazem)

1. Baixar `Nexus-Setup-0.1.0.exe`.
2. Executar. O Windows SmartScreen vai avisar que o app não é assinado — **Mais informações →
   Executar assim mesmo**. (É esperado: assinar exige um certificado de code signing pago.)
3. Abrir o Nexus.
4. Informar o endereço do servidor, se ele não vier embutido.
5. Criar a conta com o código de convite que você passou.

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
