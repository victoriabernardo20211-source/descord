import { io, Socket } from 'socket.io-client';
import { WS_EVENT, type EventName, type EventPayload } from '@nexus/shared';

type Handler = (data: unknown) => void;

/**
 * Conexão de eventos em tempo real.
 * Reconecta com backoff exponencial; ao reconectar o app ressincroniza o
 * histórico, porque eventos perdidos durante a queda não são reenviados.
 */
export class RealtimeConnection {
  private socket: Socket | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private statusHandlers = new Set<(status: ConnectionStatus) => void>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  connect(baseUrl: string, token: string): void {
    this.disconnect();
    this.setStatus('connecting');

    this.socket = io(baseUrl, {
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30_000,
      randomizationFactor: 0.5,
    });

    this.socket.on('connect', () => {
      this.setStatus('connected');
      this.heartbeat = setInterval(() => this.socket?.emit('heartbeat', {}), 20_000);
    });
    this.socket.on('disconnect', () => {
      this.setStatus('reconnecting');
      if (this.heartbeat) clearInterval(this.heartbeat);
    });
    this.socket.on('connect_error', () => this.setStatus('reconnecting'));

    this.socket.on(WS_EVENT, (envelope: { event: string; data: unknown }) => {
      for (const handler of this.handlers.get(envelope.event) ?? []) handler(envelope.data);
    });
  }

  disconnect(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.socket?.disconnect();
    this.socket = null;
    this.setStatus('offline');
  }

  emit(event: string, data: unknown): void {
    this.socket?.emit(event, data);
  }

  on<E extends EventName>(event: E, handler: (data: EventPayload<E>) => void): () => void {
    const set = this.handlers.get(event) ?? new Set<Handler>();
    set.add(handler as Handler);
    this.handlers.set(event, set);
    return () => set.delete(handler as Handler);
  }

  onStatus(handler: (status: ConnectionStatus) => void): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  private setStatus(status: ConnectionStatus): void {
    for (const handler of this.statusHandlers) handler(status);
  }
}

export type ConnectionStatus = 'offline' | 'connecting' | 'connected' | 'reconnecting';
export const realtime = new RealtimeConnection();
