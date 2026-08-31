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
};

contextBridge.exposeInMainWorld('nexus', api);

export type NexusBridge = typeof api;
