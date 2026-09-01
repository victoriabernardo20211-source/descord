import type { NexusBridge } from '../../electron/preload';

declare global {
  interface Window {
    nexus?: NexusBridge;
  }
}

export const E2EE_UNAVAILABLE =
  'A criptografia ponta a ponta só funciona no aplicativo instalado.';

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
  screenSources: async () => [],
  setPushToTalk: async () => ({ ok: false }),
  onPushToTalk: () => () => undefined,

  /**
   * Sem processo principal do Electron não há como guardar chave privada com
   * segurança. Em vez de cair para texto puro sem avisar — o pior erro possível
   * num app que promete E2EE — cada operação falha de forma explícita, e a UI
   * bloqueia o envio de mensagens privadas.
   */
  e2ee: {
    init: () => Promise.reject(new Error(E2EE_UNAVAILABLE)),
    generateOneTimeKeys: () => Promise.reject(new Error(E2EE_UNAVAILABLE)),
    missingSessions: () => Promise.reject(new Error(E2EE_UNAVAILABLE)),
    createSessions: () => Promise.reject(new Error(E2EE_UNAVAILABLE)),
    shareSession: () => Promise.reject(new Error(E2EE_UNAVAILABLE)),
    receiveToDevice: () => Promise.reject(new Error(E2EE_UNAVAILABLE)),
    encrypt: () => Promise.reject(new Error(E2EE_UNAVAILABLE)),
    decrypt: async () => ({ error: 'E2EE_UNAVAILABLE' }),
    fingerprint: () => Promise.reject(new Error(E2EE_UNAVAILABLE)),
    rotateSession: () => Promise.reject(new Error(E2EE_UNAVAILABLE)),
    reset: () => Promise.reject(new Error(E2EE_UNAVAILABLE)),
  },
};

export const bridge: NexusBridge = window.nexus ?? fallback;
export const isDesktop = Boolean(window.nexus);
