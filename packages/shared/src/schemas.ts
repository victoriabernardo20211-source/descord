import { z } from 'zod';
import { MAX_CIPHERTEXT_LENGTH, MAX_MESSAGE_LENGTH } from './constants';

export const usernameSchema = z
  .string()
  .min(3)
  .max(32)
  .regex(
    /^[a-z0-9._-]+$/,
    'Use apenas letras minúsculas, números, ponto, hífen ou underline — sem @ e sem espaços',
  );

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
  /** Presentes em anexo de conversa privada: ligam a linha à chave no envelope. */
  uploadId: z.string().nullish(),
  encrypted: z.boolean().nullish(),
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

/**
 * Um anexo de conversa privada. O arquivo é cifrado no dispositivo com
 * AES-256-GCM antes do upload; a chave viaja DENTRO do envelope Megolm, então
 * o servidor guarda bytes opacos e não tem como abri-los.
 */
export const encryptedFileSchema = z.object({
  /** Correlaciona esta entrada com a linha de anexo devolvida pelo servidor. */
  uploadId: z.string(),
  /** Chave AES-256-GCM em base64. Só existe aqui, dentro do texto cifrado. */
  key: z.string(),
  iv: z.string(),
  /** Miniatura cifrada com a MESMA chave, quando o anexo é imagem. */
  thumbnailUploadId: z.string().nullish(),
  thumbnailIv: z.string().nullish(),
  fileName: z.string(),
  mimeType: z.string(),
  size: z.number(),
  width: z.number().nullish(),
  height: z.number().nullish(),
});
export type EncryptedFile = z.infer<typeof encryptedFileSchema>;

/**
 * O que é realmente cifrado numa mensagem privada. O texto e os metadados dos
 * anexos ficam juntos aqui dentro — nada disso chega legível ao servidor.
 */
export const dmPayloadSchema = z.object({
  v: z.literal(1),
  text: z.string(),
  files: z.array(encryptedFileSchema).max(10).default([]),
});
export type DmPayload = z.infer<typeof dmPayloadSchema>;

/**
 * Envelope cifrado ponta a ponta. O servidor armazena e devolve estes campos
 * sem nunca conseguir abrir `ciphertext`.
 */
export const encryptedEnvelopeSchema = z.object({
  algorithm: z.literal('m.megolm.v1.aes-sha2'),
  ciphertext: z.string().min(1).max(MAX_CIPHERTEXT_LENGTH),
  senderDeviceId: z.string(),
  senderKey: z.string(),
  sessionId: z.string(),
});
export type EncryptedEnvelope = z.infer<typeof encryptedEnvelopeSchema>;

/** DM carrega expiresAt obrigatório — o cliente só o exibe, nunca o define. */
export const directMessageSchema = messageSchema.omit({ channelId: true, pinned: true }).extend({
  conversationId: z.string(),
  expiresAt: z.string(),
  /**
   * Presente quando a mensagem está cifrada (o padrão). Nesse caso `content`
   * carrega o texto cifrado e só o cliente consegue transformá-lo em texto.
   */
  encryption: encryptedEnvelopeSchema.nullable(),
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

/**
 * Envio de mensagem privada. O `content` vai CIFRADO e o servidor não o lê —
 * por isso as menções vêm calculadas pelo cliente, e não extraídas do texto.
 */
export const createEncryptedMessageSchema = z.object({
  encryption: encryptedEnvelopeSchema,
  replyToId: z.string().nullish(),
  attachmentIds: z.array(z.string()).max(10).optional(),
  clientMessageId: z.string().min(8).max(64).optional(),
  mentionedUserIds: z.array(z.string()).max(20).optional(),
});
export type CreateEncryptedMessageInput = z.infer<typeof createEncryptedMessageSchema>;

export const updateEncryptedMessageSchema = z.object({
  encryption: encryptedEnvelopeSchema,
});

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
