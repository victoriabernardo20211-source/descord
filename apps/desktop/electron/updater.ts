import { app, BrowserWindow, Notification } from 'electron';
import { autoUpdater } from 'electron-updater';

/**
 * Atualização automática.
 *
 * O feed é o próprio servidor do grupo, atrás do Tailscale — quem usa o Nexus
 * já está nessa rede, então não entra serviço de terceiros nem conta em loja.
 *
 * A atualização é baixada em segundo plano e instalada ao fechar o aplicativo.
 * Nada é reiniciado no meio de uma conversa ou de uma chamada: o download
 * termina em silêncio e o app avisa que a próxima abertura já vem atualizada.
 */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function initUpdater(): void {
  // Em desenvolvimento não existe app empacotado para substituir, e o
  // electron-updater falha de formas confusas se tentar.
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  // Instalar no meio do uso fecharia a janela sem aviso. Só ao sair.
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', (info) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('update:ready', { version: info.version });
    }
    new Notification({
      title: 'Nexus atualizado',
      body: `A versão ${info.version} será aplicada quando você fechar o aplicativo.`,
    }).show();
  });

  // Falha de atualização não pode atrapalhar o uso: o servidor pode estar fora,
  // ou o Tailscale desligado. Registra e segue.
  autoUpdater.on('error', (error) => {
    console.error('[updater]', error.message);
  });

  const check = (): void => {
    void autoUpdater.checkForUpdates().catch(() => undefined);
  };

  check();
  const timer = setInterval(check, CHECK_INTERVAL_MS);
  app.on('will-quit', () => clearInterval(timer));
}
