import { contextBridge, ipcRenderer } from 'electron';

/**
 * Superfície mínima exposta ao renderer. Nada de fs, path ou ipcRenderer cru —
 * apenas estas funções nomeadas.
 */
const api = {
  getConfig: (): Promise<{ apiUrl?: string; refreshToken?: string }> =>
    ipcRenderer.invoke('config:get'),
  setConfig: (patch: { apiUrl?: string; refreshToken?: string }): Promise<unknown> =>
    ipcRenderer.invoke('config:set', patch),
  clearSession: (): Promise<unknown> => ipcRenderer.invoke('config:clear-session'),
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('shell:open-external', url),
  notify: (title: string, body: string): Promise<boolean> =>
    ipcRenderer.invoke('notify', { title, body }),
  setBadge: (count: number): Promise<boolean> => ipcRenderer.invoke('badge:set', count),

  /** Fontes de compartilhamento de tela, com miniatura. */
  screenSources: (): Promise<ScreenSource[]> => ipcRenderer.invoke('screen:sources'),

  /** Registra (ou limpa) o atalho global de push-to-talk. */
  setPushToTalk: (accelerator: string | null): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('ptt:set', accelerator),

  /** Avisa o renderer que a tecla de push-to-talk foi acionada. */
  onPushToTalk: (handler: () => void): (() => void) => {
    const listener = (): void => handler();
    ipcRenderer.on('ptt:pressed', listener);
    return () => ipcRenderer.removeListener('ptt:pressed', listener);
  },

  /**
   * Criptografia ponta a ponta. As chaves privadas vivem no processo principal
   * e nunca são expostas aqui — o renderer só manda texto para cifrar e recebe
   * envelope, ou manda envelope e recebe texto.
   */
  e2ee: {
    init: (): Promise<E2eeIdentity> => ipcRenderer.invoke('e2ee:init'),
    generateOneTimeKeys: (count: number): Promise<Record<string, string>> =>
      ipcRenderer.invoke('e2ee:one-time-keys', count),
    missingSessions: (devices: E2eeDevice[]): Promise<E2eeDevice[]> =>
      ipcRenderer.invoke('e2ee:missing-sessions', devices),
    createSessions: (
      entries: { device: E2eeDevice; oneTimeKey: string }[],
    ): Promise<{ created: number }> => ipcRenderer.invoke('e2ee:create-sessions', entries),
    shareSession: (
      conversationId: string,
      devices: E2eeDevice[],
    ): Promise<{ userId: string; deviceId: string; payload: string }[]> =>
      ipcRenderer.invoke('e2ee:share-session', { conversationId, devices }),
    receiveToDevice: (
      messages: { senderUserId: string; senderDeviceId: string; payload: string }[],
    ): Promise<{ imported: number; failed: number }> =>
      ipcRenderer.invoke('e2ee:receive-to-device', messages),
    encrypt: (conversationId: string, plaintext: string): Promise<E2eeEnvelope> =>
      ipcRenderer.invoke('e2ee:encrypt', { conversationId, plaintext }),
    decrypt: (envelope: E2eeEnvelope): Promise<{ plaintext: string } | { error: string }> =>
      ipcRenderer.invoke('e2ee:decrypt', envelope),
    fingerprint: (signingKey?: string): Promise<string> =>
      ipcRenderer.invoke('e2ee:fingerprint', signingKey),
    rotateSession: (conversationId: string): Promise<{ ok: true }> =>
      ipcRenderer.invoke('e2ee:rotate-session', conversationId),
    reset: (): Promise<{ ok: true }> => ipcRenderer.invoke('e2ee:reset'),
  },
};

export interface ScreenSource {
  id: string;
  name: string;
  kind: 'screen' | 'window';
  thumbnail: string;
  appIcon: string | null;
  width: number | null;
  height: number | null;
}

export interface E2eeIdentity {
  deviceId: string;
  identityKey: string;
  signingKey: string;
  encryptionAtRest: boolean;
}

export interface E2eeDevice {
  userId: string;
  deviceId: string;
  identityKey: string;
  signingKey: string;
}

export interface E2eeEnvelope {
  algorithm: 'm.megolm.v1.aes-sha2';
  ciphertext: string;
  senderDeviceId: string;
  senderKey: string;
  sessionId: string;
}

contextBridge.exposeInMainWorld('nexus', api);

export type NexusBridge = typeof api;
