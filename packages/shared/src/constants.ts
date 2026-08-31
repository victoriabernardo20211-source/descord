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
export const MAX_UPLOAD_SIZE_DEFAULT = 100 * 1024 * 1024;
export const MESSAGE_PAGE_SIZE = 50;
export const TYPING_TTL_MS = 8000;
export const PRESENCE_HEARTBEAT_MS = 20_000;
export const PRESENCE_TTL_MS = 60_000;
