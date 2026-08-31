import { app, BrowserWindow, ipcMain, Notification, shell } from 'electron';
import { join } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { cryptoService } from './crypto/crypto-service';

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

// ── Criptografia ponta a ponta ────────────────────────────────────────────
// Só trafegam por aqui dados PÚBLICOS (chaves públicas, texto já cifrado) ou
// texto que o próprio usuário acabou de digitar. Nenhuma chave privada e
// nenhuma sessão serializada cruza esta fronteira.

const deviceListSchema = (value: unknown): value is {
  userId: string;
  deviceId: string;
  identityKey: string;
  signingKey: string;
}[] =>
  Array.isArray(value) &&
  value.every(
    (d) =>
      typeof d === 'object' &&
      d !== null &&
      typeof (d as Record<string, unknown>).userId === 'string' &&
      typeof (d as Record<string, unknown>).deviceId === 'string' &&
      typeof (d as Record<string, unknown>).identityKey === 'string',
  );

ipcMain.handle('e2ee:init', async () => cryptoService.init());

ipcMain.handle('e2ee:one-time-keys', (_event, count: unknown) => {
  const total = typeof count === 'number' && count > 0 && count <= 100 ? count : 50;
  return cryptoService.generateOneTimeKeys(total);
});

ipcMain.handle('e2ee:missing-sessions', (_event, devices: unknown) => {
  if (!deviceListSchema(devices)) throw new Error('Lista de dispositivos inválida.');
  return cryptoService.missingSessions(devices);
});

ipcMain.handle('e2ee:create-sessions', (_event, input: unknown) => {
  const entries = input as { device: unknown; oneTimeKey: unknown }[];
  if (!Array.isArray(entries)) throw new Error('Entrada inválida.');
  let created = 0;
  for (const entry of entries) {
    if (!deviceListSchema([entry.device]) || typeof entry.oneTimeKey !== 'string') continue;
    cryptoService.createOutboundOlmSession(
      (entry.device as { userId: string; deviceId: string; identityKey: string; signingKey: string }),
      entry.oneTimeKey,
    );
    created += 1;
  }
  return { created };
});

ipcMain.handle('e2ee:share-session', (_event, input: unknown) => {
  const { conversationId, devices } = (input ?? {}) as {
    conversationId?: unknown;
    devices?: unknown;
  };
  if (typeof conversationId !== 'string' || !deviceListSchema(devices)) {
    throw new Error('Entrada inválida.');
  }
  return cryptoService.shareGroupSession(conversationId, devices);
});

ipcMain.handle('e2ee:receive-to-device', (_event, messages: unknown) => {
  if (!Array.isArray(messages)) throw new Error('Entrada inválida.');
  return cryptoService.receiveToDevice(
    messages as { senderUserId: string; senderDeviceId: string; payload: string }[],
  );
});

ipcMain.handle('e2ee:encrypt', (_event, input: unknown) => {
  const { conversationId, plaintext } = (input ?? {}) as {
    conversationId?: unknown;
    plaintext?: unknown;
  };
  if (typeof conversationId !== 'string' || typeof plaintext !== 'string') {
    throw new Error('Entrada inválida.');
  }
  return cryptoService.encrypt(conversationId, plaintext);
});

ipcMain.handle('e2ee:decrypt', (_event, envelope: unknown) => {
  const value = (envelope ?? {}) as Record<string, unknown>;
  if (typeof value.ciphertext !== 'string' || typeof value.sessionId !== 'string') {
    return { error: 'INVALID_ENVELOPE' };
  }
  return cryptoService.decrypt(
    value as unknown as Parameters<typeof cryptoService.decrypt>[0],
  );
});

ipcMain.handle('e2ee:fingerprint', (_event, signingKey: unknown) =>
  cryptoService.fingerprint(typeof signingKey === 'string' ? signingKey : undefined),
);

ipcMain.handle('e2ee:rotate-session', (_event, conversationId: unknown) => {
  if (typeof conversationId !== 'string') throw new Error('Entrada inválida.');
  cryptoService.rotateGroupSession(conversationId);
  return { ok: true };
});

ipcMain.handle('e2ee:reset', async () => {
  await cryptoService.reset();
  return { ok: true };
});

ipcMain.handle('badge:set', (_event, count: unknown) => {
  if (typeof count !== 'number') return false;
  app.setBadgeCount?.(count);
  return true;
});

/**
 * Instância única. Duas cópias do Nexus rodando gravariam o mesmo estado
 * criptográfico ao mesmo tempo e poderiam corromper as sessões E2EE.
 * A segunda execução apenas traz a janela existente para frente.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(() => {
  // CSP em runtime: nem o renderer nem conteúdo carregado podem puxar script externo.
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Fechar o app não pode perder uma chave de sessão recebida no último instante.
app.on('before-quit', async (event) => {
  if (flushed) return;
  event.preventDefault();
  await cryptoService.flush().catch(() => undefined);
  flushed = true;
  app.quit();
});

let flushed = false;

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
