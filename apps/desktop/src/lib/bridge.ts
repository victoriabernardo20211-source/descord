import type { NexusBridge } from '../../electron/preload';

declare global {
  interface Window {
    nexus?: NexusBridge;
  }
}

/**
 * Fallback para rodar o renderer no navegador durante o desenvolvimento,
 * quando a ponte do Electron não existe.
 */
const fallback: NexusBridge = {
  getConfig: async () => {
    const raw = localStorage.getItem('nexus-config');
    return raw ? (JSON.parse(raw) as { apiUrl?: string; refreshToken?: string }) : {};
  },
  setConfig: async (patch) => {
    const raw = localStorage.getItem('nexus-config');
    const next = { ...(raw ? JSON.parse(raw) : {}), ...patch };
    localStorage.setItem('nexus-config', JSON.stringify(next));
    return next;
  },
  clearSession: async () => {
    const raw = localStorage.getItem('nexus-config');
    const next = { ...(raw ? JSON.parse(raw) : {}) };
    delete next.refreshToken;
    localStorage.setItem('nexus-config', JSON.stringify(next));
    return next;
  },
  openExternal: async (url) => {
    window.open(url, '_blank', 'noopener,noreferrer');
    return true;
  },
  notify: async (title, body) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body });
      return true;
    }
    return false;
  },
  setBadge: async () => false,
};

export const bridge: NexusBridge = window.nexus ?? fallback;
export const isDesktop = Boolean(window.nexus);
