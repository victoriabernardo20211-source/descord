import { app, BrowserWindow, ipcMain, Notification, shell } from 'electron';
import { join } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

/**
 * Processo principal. Regras de segurança (item 94 do plano):
 * contextIsolation ligado, nodeIntegration desligado, sandbox ligado,
 * navegação externa bloqueada e IPC restrito a uma allowlist.
 */

const CONFIG_FILE = 'nexus-config.json';
let mainWindow: BrowserWindow | null = null;

interface DesktopConfig {
  apiUrl?: string;
  refreshToken?: string;
}

function configPath(): string {
  return join(app.getPath('userData'), CONFIG_FILE);
}

async function readConfig(): Promise<DesktopConfig> {
  try {
    return JSON.parse(await readFile(configPath(), 'utf8')) as DesktopConfig;
  } catch {
    return {};
  }
}

async function writeConfig(patch: DesktopConfig): Promise<DesktopConfig> {
  const current = await readConfig();
  const next = { ...current, ...patch };
  await mkdir(app.getPath('userData'), { recursive: true });
  await writeFile(configPath(), JSON.stringify(next), 'utf8');
  return next;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#0f1116',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.on('ready-to-show', () => mainWindow?.show());

  // Qualquer link externo abre no navegador do sistema, nunca dentro do app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isDevServer = process.env.ELECTRON_RENDERER_URL
      ? url.startsWith(process.env.ELECTRON_RENDERER_URL)
      : false;
    if (!isDevServer && !url.startsWith('file://')) event.preventDefault();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

// IPC com allowlist: o renderer não tem acesso a fs, path ou child_process.
ipcMain.handle('config:get', async () => readConfig());
ipcMain.handle('config:set', async (_event, patch: unknown) => {
  if (typeof patch !== 'object' || patch === null) throw new Error('Configuração inválida.');
  const { apiUrl, refreshToken } = patch as DesktopConfig;
  const clean: DesktopConfig = {};
  if (typeof apiUrl === 'string') clean.apiUrl = apiUrl;
  if (typeof refreshToken === 'string' || refreshToken === null) clean.refreshToken = refreshToken;
  return writeConfig(clean);
});
ipcMain.handle('config:clear-session', async () => writeConfig({ refreshToken: undefined }));

ipcMain.handle('shell:open-external', async (_event, url: unknown) => {
  if (typeof url !== 'string') return false;
  if (!/^https?:\/\//i.test(url)) return false;
  await shell.openExternal(url);
  return true;
});

ipcMain.handle('notify', (_event, payload: unknown) => {
  if (typeof payload !== 'object' || payload === null) return false;
  const { title, body } = payload as { title?: unknown; body?: unknown };
  if (typeof title !== 'string' || typeof body !== 'string') return false;
  if (!Notification.isSupported()) return false;
  const notification = new Notification({ title, body: body.slice(0, 300) });
  notification.on('click', () => mainWindow?.show());
  notification.show();
  return true;
});

ipcMain.handle('badge:set', (_event, count: unknown) => {
  if (typeof count !== 'number') return false;
  app.setBadgeCount?.(count);
  return true;
});

app.whenReady().then(() => {
  // CSP em runtime: nem o renderer nem conteúdo carregado podem puxar script externo.
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
