/**
 * Bitfield de permissões. Armazenado como string decimal no banco (Postgres BIGINT
 * via Prisma BigInt) para evitar perda de precisão em JSON.
 */
export const Permission = {
  ADMINISTRATOR: 1n << 0n,
  MANAGE_SERVER: 1n << 1n,
  MANAGE_CHANNELS: 1n << 2n,
  MANAGE_ROLES: 1n << 3n,
  MANAGE_MESSAGES: 1n << 4n,
  KICK_MEMBERS: 1n << 5n,
  BAN_MEMBERS: 1n << 6n,
  CREATE_INVITE: 1n << 7n,
  VIEW_CHANNEL: 1n << 8n,
  SEND_MESSAGES: 1n << 9n,
  READ_MESSAGE_HISTORY: 1n << 10n,
  ATTACH_FILES: 1n << 11n,
  ADD_REACTIONS: 1n << 12n,
  MENTION_EVERYONE: 1n << 13n,
  CONNECT: 1n << 14n,
  SPEAK: 1n << 15n,
  STREAM: 1n << 16n,
  MUTE_MEMBERS: 1n << 17n,
  DEAFEN_MEMBERS: 1n << 18n,
  MOVE_MEMBERS: 1n << 19n,
  MANAGE_NICKNAMES: 1n << 20n,
  MANAGE_EMOJIS: 1n << 21n,
  VIEW_AUDIT_LOG: 1n << 22n,
} as const;

export type PermissionName = keyof typeof Permission;

export const ALL_PERMISSIONS = Object.values(Permission).reduce((a, b) => a | b, 0n);

/** Permissões do cargo @everyone em um servidor recém-criado. */
export const DEFAULT_EVERYONE_PERMISSIONS =
  Permission.VIEW_CHANNEL |
  Permission.SEND_MESSAGES |
  Permission.READ_MESSAGE_HISTORY |
  Permission.ATTACH_FILES |
  Permission.ADD_REACTIONS |
  Permission.CREATE_INVITE |
  Permission.CONNECT |
  Permission.SPEAK |
  Permission.STREAM;

export function has(bits: bigint, permission: bigint): boolean {
  if ((bits & Permission.ADMINISTRATOR) === Permission.ADMINISTRATOR) return true;
  return (bits & permission) === permission;
}

/** Sem o atalho de ADMINISTRATOR — usado onde o bit exato importa. */
export function hasExact(bits: bigint, permission: bigint): boolean {
  return (bits & permission) === permission;
}

export function toBits(value: string | bigint | number): bigint {
  return typeof value === 'bigint' ? value : BigInt(value);
}

export function listPermissions(bits: bigint): PermissionName[] {
  return (Object.keys(Permission) as PermissionName[]).filter(
    (name) => (bits & Permission[name]) === Permission[name],
  );
}
