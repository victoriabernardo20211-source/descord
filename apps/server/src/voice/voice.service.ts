import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import { Permission, has } from '@nexus/shared';
import { AppConfig, CONFIG } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { PermissionsService } from '../permissions/permissions.service';
import { EventsService, room as wsRoom } from '../realtime/events.service';

export interface VoiceParticipant {
  userId: string;
  /** Silenciou o próprio microfone. */
  selfMuted: boolean;
  /** Não quer ouvir ninguém (implica microfone fechado). */
  selfDeafened: boolean;
  /** Silenciado por um moderador — o usuário não pode desfazer sozinho. */
  serverMuted: boolean;
  serverDeafened: boolean;
  streaming: boolean;
  joinedAt: number;
}

const key = {
  channel: (channelId: string) => `voice:channel:${channelId}`,
  user: (userId: string) => `voice:user:${userId}`,
};

/**
 * Voz e compartilhamento de tela.
 *
 * O NestJS **não transporta mídia**. Ele faz três coisas:
 *   1. valida quem pode entrar, falar e transmitir;
 *   2. assina um token do LiveKit com os grants MÍNIMOS para aquela sala;
 *   3. mantém o estado de quem está na sala (Redis) e avisa os clientes (WebSocket).
 *
 * O LiveKit nunca decide autorização — ele confia no token que assinamos.
 */
@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);
  private readonly rooms: RoomServiceClient | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly permissions: PermissionsService,
    private readonly events: EventsService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {
    this.rooms =
      config.LIVEKIT_URL && config.LIVEKIT_API_KEY && config.LIVEKIT_API_SECRET
        ? new RoomServiceClient(
            config.LIVEKIT_URL.replace(/^ws/, 'http'),
            config.LIVEKIT_API_KEY,
            config.LIVEKIT_API_SECRET,
          )
        : null;
  }

  get configured(): boolean {
    return Boolean(this.config.LIVEKIT_API_KEY && this.config.LIVEKIT_API_SECRET);
  }

  /** Nome da sala no LiveKit. Canal de servidor e conversa privada não colidem. */
  static roomName(kind: 'channel' | 'dm', id: string): string {
    return `${kind}:${id}`;
  }

  /**
   * Emite o token de acesso a um canal de voz.
   *
   * Os grants são derivados das permissões reais: sem SPEAK o token não permite
   * publicar áudio; sem STREAM não permite publicar tela. Um cliente adulterado
   * não consegue transmitir, porque o LiveKit recusa a track.
   */
  async issueChannelToken(channelId: string, userId: string) {
    this.assertConfigured();

    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true, type: true, serverId: true, name: true },
    });
    if (!channel || channel.type !== 'VOICE') {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Canal de voz não encontrado.',
      });
    }

    const bits = await this.permissions.resolveChannel(channelId, userId);
    if (!has(bits, Permission.VIEW_CHANNEL) || !has(bits, Permission.CONNECT)) {
      throw new ForbiddenException({
        code: 'MISSING_PERMISSION',
        message: 'Você não pode entrar nesse canal de voz.',
      });
    }

    const canSpeak = has(bits, Permission.SPEAK);
    const canStream = has(bits, Permission.STREAM);

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { username: true, displayName: true },
    });

    const token = await this.buildToken({
      roomName: VoiceService.roomName('channel', channelId),
      userId,
      displayName: user.displayName,
      canSpeak,
      canStream,
    });

    return {
      token,
      url: this.config.LIVEKIT_URL,
      room: VoiceService.roomName('channel', channelId),
      canSpeak,
      canStream,
    };
  }

  /** Token para chamada em conversa privada. Exige ser participante. */
  async issueCallToken(conversationId: string, userId: string) {
    this.assertConfigured();

    const participant = await this.prisma.directConversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { id: true },
    });
    if (!participant) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Conversa não encontrada.' });
    }

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { displayName: true },
    });

    // Numa conversa privada não há cargos: todo participante fala e transmite.
    const token = await this.buildToken({
      roomName: VoiceService.roomName('dm', conversationId),
      userId,
      displayName: user.displayName,
      canSpeak: true,
      canStream: true,
    });

    return {
      token,
      url: this.config.LIVEKIT_URL,
      room: VoiceService.roomName('dm', conversationId),
      canSpeak: true,
      canStream: true,
    };
  }

  private async buildToken(input: {
    roomName: string;
    userId: string;
    displayName: string;
    canSpeak: boolean;
    canStream: boolean;
  }): Promise<string> {
    const token = new AccessToken(this.config.LIVEKIT_API_KEY, this.config.LIVEKIT_API_SECRET, {
      identity: input.userId,
      name: input.displayName,
      // Token curto: reentrar pede um token novo, e permissão revogada vale rápido.
      ttl: '2h',
    });

    // `canPublishSources` é o que separa "pode falar" de "pode transmitir tela".
    const sources: TrackSource[] = [];
    if (input.canSpeak) sources.push(TrackSource.MICROPHONE);
    if (input.canStream) {
      sources.push(TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO, TrackSource.CAMERA);
    }

    token.addGrant({
      room: input.roomName,
      roomJoin: true,
      canSubscribe: true,
      canPublish: sources.length > 0,
      canPublishSources: sources,
      // Sem permissão de criar salas arbitrárias nem administrar o LiveKit.
      roomCreate: false,
      roomAdmin: false,
    });

    return token.toJwt();
  }

  // ── Estado da sala (efêmero, no Redis) ────────────────────────────────────

  async join(channelId: string, userId: string): Promise<VoiceParticipant[]> {
    const state: VoiceParticipant = {
      userId,
      selfMuted: false,
      selfDeafened: false,
      serverMuted: false,
      serverDeafened: false,
      streaming: false,
      joinedAt: Date.now(),
    };

    // Uma pessoa só fica em um canal de voz por vez.
    const previous = await this.redis.client.get(key.user(userId));
    if (previous && previous !== channelId) await this.leave(previous, userId);

    await this.redis.client.hset(key.channel(channelId), userId, JSON.stringify(state));
    await this.redis.client.set(key.user(userId), channelId);

    this.events.emit(wsRoom.channel(channelId), 'voice.joined', { channelId, userId });
    return this.participants(channelId);
  }

  async leave(channelId: string, userId: string): Promise<void> {
    const existing = await this.redis.client.hget(key.channel(channelId), userId);
    if (!existing) return;

    await this.redis.client.hdel(key.channel(channelId), userId);
    await this.redis.client.del(key.user(userId));

    const state = JSON.parse(existing) as VoiceParticipant;
    if (state.streaming) {
      this.events.emit(wsRoom.channel(channelId), 'stream.ended', { channelId, userId });
    }
    this.events.emit(wsRoom.channel(channelId), 'voice.left', { channelId, userId });
  }

  async participants(channelId: string): Promise<VoiceParticipant[]> {
    const entries = await this.redis.client.hgetall(key.channel(channelId));
    return Object.values(entries).map((raw) => JSON.parse(raw) as VoiceParticipant);
  }

  /** Estado de todos os canais de voz de um servidor, para a barra lateral. */
  async serverVoiceState(serverId: string): Promise<Record<string, VoiceParticipant[]>> {
    const channels = await this.prisma.channel.findMany({
      where: { serverId, type: 'VOICE' },
      select: { id: true },
    });
    const result: Record<string, VoiceParticipant[]> = {};
    for (const channel of channels) {
      result[channel.id] = await this.participants(channel.id);
    }
    return result;
  }

  /**
   * Estado que o próprio usuário controla. Não permite desfazer um mute aplicado
   * por moderador — essa é a diferença entre self mute e server mute.
   */
  async updateSelfState(
    userId: string,
    patch: { selfMuted?: boolean; selfDeafened?: boolean; streaming?: boolean },
  ): Promise<void> {
    const channelId = await this.redis.client.get(key.user(userId));
    if (!channelId) return;

    const raw = await this.redis.client.hget(key.channel(channelId), userId);
    if (!raw) return;
    const state = JSON.parse(raw) as VoiceParticipant;

    const wasStreaming = state.streaming;
    const next: VoiceParticipant = {
      ...state,
      ...patch,
      // Ensurdecer implica não falar: os dois andam juntos.
      selfMuted: patch.selfDeafened === true ? true : (patch.selfMuted ?? state.selfMuted),
    };

    await this.redis.client.hset(key.channel(channelId), userId, JSON.stringify(next));

    if (next.streaming !== wasStreaming) {
      this.events.emit(
        wsRoom.channel(channelId),
        next.streaming ? 'stream.started' : 'stream.ended',
        { channelId, userId },
      );
    }
    this.events.emit(wsRoom.channel(channelId), 'voice.joined', { channelId, userId });
  }

  // ── Moderação ─────────────────────────────────────────────────────────────

  async moderate(
    actorId: string,
    targetId: string,
    action: 'mute' | 'unmute' | 'deafen' | 'undeafen' | 'disconnect',
  ): Promise<void> {
    const channelId = await this.redis.client.get(key.user(targetId));
    if (!channelId) {
      throw new NotFoundException({
        code: 'NOT_IN_VOICE',
        message: 'Essa pessoa não está em um canal de voz.',
      });
    }

    const channel = await this.prisma.channel.findUniqueOrThrow({
      where: { id: channelId },
      select: { serverId: true },
    });

    const required =
      action === 'disconnect'
        ? Permission.MOVE_MEMBERS
        : action === 'deafen' || action === 'undeafen'
          ? Permission.DEAFEN_MEMBERS
          : Permission.MUTE_MEMBERS;

    await this.permissions.assertServerPermission(channel.serverId, actorId, required);
    await this.permissions.assertHigherThan(channel.serverId, actorId, targetId);

    if (action === 'disconnect') {
      await this.forceDisconnect(channelId, targetId);
      return;
    }

    const raw = await this.redis.client.hget(key.channel(channelId), targetId);
    if (!raw) return;
    const state = JSON.parse(raw) as VoiceParticipant;

    const next: VoiceParticipant = {
      ...state,
      serverMuted: action === 'mute' ? true : action === 'unmute' ? false : state.serverMuted,
      serverDeafened:
        action === 'deafen' ? true : action === 'undeafen' ? false : state.serverDeafened,
    };
    await this.redis.client.hset(key.channel(channelId), targetId, JSON.stringify(next));

    // Não basta marcar no Redis: o LiveKit precisa cortar a track de verdade.
    if (this.rooms && (action === 'mute' || action === 'unmute')) {
      await this.silenceInLiveKit(channelId, targetId, action === 'mute').catch((err) =>
        this.logger.error(`Falha ao silenciar no LiveKit: ${(err as Error).message}`),
      );
    }

    this.events.emit(wsRoom.channel(channelId), 'voice.joined', {
      channelId,
      userId: targetId,
    });
  }

  private async silenceInLiveKit(
    channelId: string,
    userId: string,
    muted: boolean,
  ): Promise<void> {
    if (!this.rooms) return;
    const roomName = VoiceService.roomName('channel', channelId);
    const participants = await this.rooms.listParticipants(roomName);
    const participant = participants.find((p) => p.identity === userId);
    if (!participant) return;

    for (const track of participant.tracks) {
      if (track.source === 2 /* MICROPHONE */) {
        await this.rooms.mutePublishedTrack(roomName, userId, track.sid, muted);
      }
    }
  }

  private async forceDisconnect(channelId: string, userId: string): Promise<void> {
    if (this.rooms) {
      await this.rooms
        .removeParticipant(VoiceService.roomName('channel', channelId), userId)
        .catch(() => undefined);
    }
    await this.leave(channelId, userId);
  }

  /**
   * Chamado pelo webhook do LiveKit quando um participante some.
   *
   * É isto que resolve o app travando no meio de uma transmissão (item 140): o
   * LiveKit percebe a queda e nós limpamos o estado, em vez de deixar alguém
   * eternamente marcado como "transmitindo".
   */
  async handleParticipantLeft(roomName: string, userId: string): Promise<void> {
    const [kind, id] = roomName.split(':');
    if (kind !== 'channel' || !id) return;
    await this.leave(id, userId);
    this.logger.log(`LiveKit: ${userId} saiu de ${roomName}`);
  }

  private assertConfigured(): void {
    if (!this.configured) {
      throw new ForbiddenException({
        code: 'VOICE_NOT_CONFIGURED',
        message: 'A voz ainda não está configurada neste servidor.',
      });
    }
  }
}
