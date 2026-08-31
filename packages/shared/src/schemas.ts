import { z } from 'zod';
import { MAX_MESSAGE_LENGTH } from './constants';

export const usernameSchema = z
  .string()
  .min(3)
  .max(32)
  .regex(/^[a-z0-9._-]+$/, 'Use apenas letras minúsculas, números, ponto, hífen ou underline');

export const passwordSchema = z.string().min(10).max(200);

export const registerSchema = z.object({
  email: z.string().email(),
  username: usernameSchema,
  displayName: z.string().min(1).max(48),
  password: passwordSchema,
  inviteCode: z.string().optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  deviceName: z.string().max(80).optional(),
});

export const presenceStatusSchema = z.enum(['ONLINE', 'IDLE', 'DND', 'INVISIBLE', 'OFFLINE']);
export type PresenceStatus = z.infer<typeof presenceStatusSchema>;

export const userSchema = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  bannerUrl: z.string().nullable(),
  bio: z.string().nullable(),
  createdAt: z.string(),
});
export type PublicUser = z.infer<typeof userSchema>;

export const presenceSchema = z.object({
  userId: z.string(),
  status: presenceStatusSchema,
  customStatus: z.string().nullable().optional(),
  customEmoji: z.string().nullable().optional(),
});
export type PresenceState = z.infer<typeof presenceSchema>;

export const attachmentSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  size: z.number(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  url: z.string(),
  thumbnailUrl: z.string().nullable(),
});
export type Attachment = z.infer<typeof attachmentSchema>;

export const reactionSchema = z.object({
  emoji: z.string(),
  count: z.number(),
  me: z.boolean(),
});

export const messageSchema = z.object({
  id: z.string(),
  channelId: z.string(),
  author: userSchema,
  content: z.string(),
  createdAt: z.string(),
  editedAt: z.string().nullable(),
  replyToId: z.string().nullable(),
  pinned: z.boolean(),
  attachments: z.array(attachmentSchema),
  reactions: z.array(reactionSchema),
  mentionsEveryone: z.boolean(),
  mentionedUserIds: z.array(z.string()),
  clientMessageId: z.string().nullable().optional(),
});
export type Message = z.infer<typeof messageSchema>;

/** DM carrega expiresAt obrigatório — o cliente só o exibe, nunca o define. */
export const directMessageSchema = messageSchema.omit({ channelId: true, pinned: true }).extend({
  conversationId: z.string(),
  expiresAt: z.string(),
});
export type DirectMessage = z.infer<typeof directMessageSchema>;

export const createMessageSchema = z.object({
  content: z.string().max(MAX_MESSAGE_LENGTH),
  replyToId: z.string().nullish(),
  attachmentIds: z.array(z.string()).max(10).optional(),
  /** Idempotência: reenvio com o mesmo id não duplica a mensagem. */
  clientMessageId: z.string().min(8).max(64).optional(),
});
export type CreateMessageInput = z.infer<typeof createMessageSchema>;

export const updateMessageSchema = z.object({
  content: z.string().min(1).max(MAX_MESSAGE_LENGTH),
});

export const createServerSchema = z.object({ name: z.string().min(2).max(64) });
export const createChannelSchema = z.object({
  name: z.string().min(1).max(64),
  type: z.enum(['TEXT', 'VOICE']),
  categoryId: z.string().nullish(),
  topic: z.string().max(512).nullish(),
});
export const createCategorySchema = z.object({ name: z.string().min(1).max(64) });
export const createInviteSchema = z.object({
  maxAgeSeconds: z.number().int().min(0).max(60 * 60 * 24 * 7),
  maxUses: z.number().int().min(0).max(100),
});
