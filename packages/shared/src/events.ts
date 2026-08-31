import { z } from 'zod';
import { directMessageSchema, messageSchema, presenceSchema } from './schemas';

/** Envelope único de todo evento WebSocket: { event, data }. */
export const WS_EVENT = 'nexus.event';

export const eventSchemas = {
  'message.created': messageSchema,
  'message.updated': messageSchema,
  'message.deleted': z.object({ id: z.string(), channelId: z.string() }),
  'reaction.added': z.object({
    messageId: z.string(),
    channelId: z.string(),
    emoji: z.string(),
    userId: z.string(),
  }),
  'reaction.removed': z.object({
    messageId: z.string(),
    channelId: z.string(),
    emoji: z.string(),
    userId: z.string(),
  }),
  'typing.started': z.object({
    channelId: z.string(),
    userId: z.string(),
    displayName: z.string(),
  }),
  'typing.stopped': z.object({ channelId: z.string(), userId: z.string() }),
  'presence.updated': presenceSchema,
  'member.joined': z.object({ serverId: z.string(), userId: z.string() }),
  'member.left': z.object({ serverId: z.string(), userId: z.string() }),
  'channel.created': z.object({ serverId: z.string(), channelId: z.string() }),
  'channel.updated': z.object({ serverId: z.string(), channelId: z.string() }),
  'channel.deleted': z.object({ serverId: z.string(), channelId: z.string() }),
  'dm.created': directMessageSchema,
  'dm.updated': directMessageSchema,
  'dm.deleted': z.object({ id: z.string(), conversationId: z.string() }),
  /** Mensagem privada atingiu expiresAt e foi removida permanentemente. */
  'dm.expired': z.object({
    conversationId: z.string(),
    messageIds: z.array(z.string()),
  }),
  /** Há envelope de chave de sessão esperando por este dispositivo. */
  'e2ee.to_device': z.object({ targetDeviceId: z.string() }),
  /** Alguém adicionou ou removeu um dispositivo: as sessões precisam ser refeitas. */
  'e2ee.devices_changed': z.object({
    userId: z.string(),
    deviceId: z.string(),
    removed: z.boolean(),
  }),
  'friend.requested': z.object({ requestId: z.string(), fromUserId: z.string() }),
  'friend.accepted': z.object({ userId: z.string() }),
  'friend.removed': z.object({ userId: z.string() }),
  'notification.created': z.object({
    id: z.string(),
    type: z.string(),
    channelId: z.string().nullable(),
    messageId: z.string().nullable(),
  }),
  'voice.joined': z.object({ channelId: z.string(), userId: z.string() }),
  'voice.left': z.object({ channelId: z.string(), userId: z.string() }),
  'stream.started': z.object({ channelId: z.string(), userId: z.string() }),
  'stream.ended': z.object({ channelId: z.string(), userId: z.string() }),
} as const;

export type EventName = keyof typeof eventSchemas;
export type EventPayload<E extends EventName> = z.infer<(typeof eventSchemas)[E]>;

export interface ServerEvent<E extends EventName = EventName> {
  event: E;
  data: EventPayload<E>;
}

/** Eventos que o cliente envia para o servidor. */
export const clientEvents = {
  'typing.start': z.object({ channelId: z.string() }),
  'presence.set': z.object({
    status: presenceSchema.shape.status,
    customStatus: z.string().max(80).nullish(),
    customEmoji: z.string().max(16).nullish(),
  }),
  'heartbeat': z.object({}),
} as const;
