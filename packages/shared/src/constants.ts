/** Nome do produto. Identidade própria — não referencia nenhum produto de terceiros. */
export const APP_NAME = 'Nexus';

/**
 * Tempo de vida OBRIGATÓRIO de toda mensagem privada (DM / grupo privado).
 * Regra de produto: não é configurável, não pode ser desativada, não pode ser
 * estendida por administrador. Ver docs/SECURITY.md.
 *
 * Sobrescrito apenas em ambiente de teste (DM_TTL_MS no server), nunca em produção.
 */
export const DM_TTL_MS = 8 * 60 * 60 * 1000;

export const MAX_MESSAGE_LENGTH = 4000;
/**
 * O texto cifrado é bem maior que o original (envelope Megolm em base64).
 * Este é o limite do campo que trafega até o servidor, não do que o usuário digita.
 */
export const MAX_CIPHERTEXT_LENGTH = 64_000;
/** Abaixo deste estoque de prekeys o dispositivo repõe automaticamente. */
export const ONE_TIME_KEY_TARGET = 50;
/** Uma sessão Megolm não vive mais que isto nem cifra mais que MEGOLM_MAX_MESSAGES. */
export const MEGOLM_ROTATION_MS = 8 * 60 * 60 * 1000;
export const MEGOLM_MAX_MESSAGES = 200;
export const MAX_UPLOAD_SIZE_DEFAULT = 100 * 1024 * 1024;
export const MESSAGE_PAGE_SIZE = 50;
export const TYPING_TTL_MS = 8000;
export const PRESENCE_HEARTBEAT_MS = 20_000;
export const PRESENCE_TTL_MS = 60_000;
