import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';
import { EventName, EventPayload, WS_EVENT } from '@nexus/shared';

/** Convenções de sala. O cliente nunca escolhe a sala — o servidor decide no handshake. */
export const room = {
  user: (userId: string) => `user:${userId}`,
  server: (serverId: string) => `server:${serverId}`,
  channel: (channelId: string) => `channel:${channelId}`,
  conversation: (conversationId: string) => `dm:${conversationId}`,
};

/**
 * Ponto único de emissão de eventos. Todo evento sai no envelope { event, data }
 * definido em @nexus/shared/events.
 */
@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);
  private io: Server | null = null;

  bind(io: Server): void {
    this.io = io;
  }

  emit<E extends EventName>(target: string | string[], event: E, data: EventPayload<E>): void {
    if (!this.io) {
      this.logger.warn(`Evento ${event} descartado: gateway ainda não inicializado`);
      return;
    }
    this.io.to(target).emit(WS_EVENT, { event, data });
  }

  /** Faz todos os sockets de um usuário entrarem em uma sala nova (ex.: entrou num servidor). */
  async joinRoom(userId: string, roomName: string): Promise<void> {
    if (!this.io) return;
    const sockets = await this.io.in(room.user(userId)).fetchSockets();
    for (const socket of sockets) await socket.join(roomName);
  }

  async leaveRoom(userId: string, roomName: string): Promise<void> {
    if (!this.io) return;
    const sockets = await this.io.in(room.user(userId)).fetchSockets();
    for (const socket of sockets) await socket.leave(roomName);
  }
}
