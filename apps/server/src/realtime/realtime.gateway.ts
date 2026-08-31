import { Logger, OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { TYPING_TTL_MS, clientEvents } from '@nexus/shared';
import { TokenService } from '../auth/token.service';
import { PrismaService } from '../prisma/prisma.service';
import { PresenceService } from '../presence/presence.service';
import { EventsService, room } from './events.service';

interface SocketData {
  userId: string;
  username: string;
  displayName: string;
  sessionId: string;
}

@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class RealtimeGateway
  implements OnModuleInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly presence: PresenceService,
  ) {}

  onModuleInit(): void {
    this.events.bind(this.server);
  }

  /**
   * Handshake autenticado. O cliente NÃO pode pedir para entrar numa sala:
   * o servidor calcula as salas a partir da associação real do usuário.
   */
  async handleConnection(socket: Socket): Promise<void> {
    const token =
      (socket.handshake.auth?.token as string | undefined) ??
      socket.handshake.headers.authorization?.replace('Bearer ', '');

    if (!token) return this.reject(socket, 'NO_TOKEN');

    let payload;
    try {
      payload = await this.tokens.verifyAccessToken(token);
    } catch {
      return this.reject(socket, 'INVALID_TOKEN');
    }

    const session = await this.prisma.session.findUnique({
      where: { id: payload.sid },
      select: { revokedAt: true, expiresAt: true },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      return this.reject(socket, 'SESSION_REVOKED');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, username: true, displayName: true },
    });
    if (!user) return this.reject(socket, 'USER_NOT_FOUND');

    const data: SocketData = {
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      sessionId: payload.sid,
    };
    socket.data = data;

    const [memberships, participations] = await Promise.all([
      this.prisma.serverMember.findMany({
        where: { userId: user.id },
        select: { serverId: true, server: { select: { channels: { select: { id: true } } } } },
      }),
      this.prisma.directConversationParticipant.findMany({
        where: { userId: user.id },
        select: { conversationId: true },
      }),
    ]);

    const rooms = [room.user(user.id)];
    for (const m of memberships) {
      rooms.push(room.server(m.serverId));
      for (const c of m.server.channels) rooms.push(room.channel(c.id));
    }
    for (const p of participations) rooms.push(room.conversation(p.conversationId));
    await socket.join(rooms);

    await this.presence.handleConnect(user.id, socket.id);
    this.logger.log(`WS conectado: ${user.username}`);
  }

  async handleDisconnect(socket: Socket): Promise<void> {
    const data = socket.data as SocketData | undefined;
    if (!data?.userId) return;
    await this.presence.handleDisconnect(data.userId, socket.id);
  }

  @SubscribeMessage('typing.start')
  async onTyping(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<void> {
    const data = socket.data as SocketData | undefined;
    if (!data?.userId) return;
    const parsed = clientEvents['typing.start'].safeParse(body);
    if (!parsed.success) return;

    // Só ecoa em salas em que o socket já está — impede vazar digitação para terceiros.
    const target = parsed.data.channelId;
    const inChannel =
      socket.rooms.has(room.channel(target)) || socket.rooms.has(room.conversation(target));
    if (!inChannel) return;

    this.events.emit(
      socket.rooms.has(room.channel(target)) ? room.channel(target) : room.conversation(target),
      'typing.started',
      { channelId: target, userId: data.userId, displayName: data.displayName },
    );

    // Efêmero: nunca persistido. Expira sozinho.
    setTimeout(() => {
      this.events.emit(
        socket.rooms.has(room.channel(target)) ? room.channel(target) : room.conversation(target),
        'typing.stopped',
        { channelId: target, userId: data.userId },
      );
    }, TYPING_TTL_MS).unref();
  }

  @SubscribeMessage('presence.set')
  async onPresence(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<void> {
    const data = socket.data as SocketData | undefined;
    if (!data?.userId) return;
    const parsed = clientEvents['presence.set'].safeParse(body);
    if (!parsed.success) return;
    await this.presence.setStatus(data.userId, parsed.data);
  }

  @SubscribeMessage('heartbeat')
  async onHeartbeat(@ConnectedSocket() socket: Socket): Promise<{ serverTime: number }> {
    const data = socket.data as SocketData | undefined;
    if (data?.userId) await this.presence.heartbeat(data.userId, socket.id);
    // Devolve o relógio do servidor: o cliente calcula serverTimeOffset com isso.
    return { serverTime: Date.now() };
  }

  private reject(socket: Socket, code: string): void {
    socket.emit('nexus.error', { code, message: 'Falha na autenticação do WebSocket.' });
    socket.disconnect(true);
  }
}
