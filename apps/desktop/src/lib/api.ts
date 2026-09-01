import { bridge } from './bridge';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Cliente HTTP do app.
 *
 * - Renova o access token sozinho no primeiro 401 e repete a requisição uma vez.
 * - Guarda `serverTimeOffset` (relógio do servidor − relógio local). O contador
 *   de expiração das DMs usa esse offset; a decisão de apagar é sempre do servidor.
 */
export class ApiClient {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private refreshing: Promise<void> | null = null;
  serverTimeOffset = 0;

  constructor(public baseUrl: string) {}

  get token(): string | null {
    return this.accessToken;
  }

  setTokens(tokens: Tokens | null): void {
    this.accessToken = tokens?.accessToken ?? null;
    this.refreshToken = tokens?.refreshToken ?? null;
    void bridge.setConfig({ refreshToken: tokens?.refreshToken ?? undefined });
  }

  setRefreshToken(token: string | null): void {
    this.refreshToken = token;
  }

  /** Mede a diferença de relógio e confirma que o servidor está de pé. */
  async syncClock(): Promise<{ ok: boolean }> {
    const before = Date.now();
    const res = await fetch(`${this.baseUrl}/api/health`);
    if (!res.ok) return { ok: false };
    const body = (await res.json()) as { serverTime: string };
    const rtt = Date.now() - before;
    // Desconta metade do round-trip como estimativa do caminho de ida.
    this.serverTimeOffset = new Date(body.serverTime).getTime() - (before + rtt / 2);
    return { ok: true };
  }

  now(): number {
    return Date.now() + this.serverTimeOffset;
  }

  async request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    const headers = new Headers(init.headers);
    if (this.accessToken) headers.set('Authorization', `Bearer ${this.accessToken}`);
    if (init.body && !(init.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api${path}`, { ...init, headers });
    } catch {
      throw new ApiError('Não foi possível conectar ao servidor.', 'NETWORK', 0);
    }

    if (res.status === 401 && retry && this.refreshToken) {
      await this.refreshSession();
      return this.request<T>(path, init, false);
    }

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
      throw new ApiError(
        body.message ?? 'Não foi possível concluir a ação.',
        body.code ?? 'UNKNOWN',
        res.status,
      );
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /** Uma renovação por vez, mesmo com várias requisições falhando juntas. */
  private async refreshSession(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const res = await fetch(`${this.baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.refreshToken }),
      });
      if (!res.ok) {
        this.setTokens(null);
        throw new ApiError('Sua sessão expirou. Entre novamente.', 'SESSION_EXPIRED', 401);
      }
      const body = (await res.json()) as Tokens;
      this.setTokens(body);
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }
  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
  }
  patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
  }
  put<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'PUT' });
  }
  del<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' });
  }

  async upload(file: File): Promise<{ id: string; fileName: string }> {
    const form = new FormData();
    form.append('file', file);
    return this.request('/files/upload', { method: 'POST', body: form });
  }

  /** Sobe um blob já cifrado pelo dispositivo (anexo de conversa privada). */
  async uploadEncrypted(data: ArrayBuffer): Promise<{ id: string }> {
    const form = new FormData();
    form.append('file', new Blob([data], { type: 'application/octet-stream' }), 'blob');
    return this.request('/files/upload/encrypted', { method: 'POST', body: form });
  }

  /** Bytes crus de um anexo, para o cliente decifrar antes de exibir. */
  async fetchAttachmentBytes(url: string): Promise<ArrayBuffer> {
    const res = await fetch(`${this.baseUrl}/api${url}`, {
      headers: this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {},
    });
    if (!res.ok) throw new ApiError('Anexo indisponível.', 'NOT_FOUND', res.status);
    return res.arrayBuffer();
  }

  /** URL absoluta de um anexo (o download exige o token no header, via fetch). */
  async fetchAttachment(url: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api${url}`, {
      headers: this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {},
    });
    if (!res.ok) throw new ApiError('Anexo indisponível.', 'NOT_FOUND', res.status);
    return URL.createObjectURL(await res.blob());
  }
}
