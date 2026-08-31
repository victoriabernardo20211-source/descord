import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  DEFAULT_EVERYONE_PERMISSIONS,
  Permission,
  has,
  hasExact,
  listPermissions,
} from '@nexus/shared';
import { PermissionsService } from '../src/permissions/permissions.service';

/**
 * Prisma falso: devolve exatamente o cenário descrito em cada teste.
 * O alvo aqui é a lógica de resolução, não o banco.
 */
interface Scenario {
  ownerId: string;
  member: { userId: string; roles: { roleId: string; permissions: bigint; position: number }[] } | null;
  everyoneRoleId: string;
  overrides: { roleId: string | null; userId: string | null; allow: bigint; deny: bigint }[];
}

function serviceFor(scenario: Scenario): PermissionsService {
  const prisma = {
    serverMember: {
      findUnique: async ({ where }: { where: { serverId_userId: { userId: string } } }) => {
        if (!scenario.member || scenario.member.userId !== where.serverId_userId.userId) return null;
        return {
          id: 'member-1',
          server: { ownerId: scenario.ownerId },
          roles: scenario.member.roles.map((r) => ({
            roleId: r.roleId,
            role: { permissions: r.permissions, position: r.position },
          })),
        };
      },
    },
    channel: { findUnique: async () => ({ serverId: 'server-1' }) },
    role: { findFirst: async () => ({ id: scenario.everyoneRoleId }) },
    channelPermission: { findMany: async () => scenario.overrides },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return new PermissionsService(prisma);
}

const base: Scenario = {
  ownerId: 'owner',
  member: {
    userId: 'user-1',
    roles: [{ roleId: 'everyone', permissions: DEFAULT_EVERYONE_PERMISSIONS, position: 0 }],
  },
  everyoneRoleId: 'everyone',
  overrides: [],
};

describe('bitfield de permissões', () => {
  it('ADMINISTRATOR concede tudo através de has()', () => {
    expect(has(Permission.ADMINISTRATOR, Permission.BAN_MEMBERS)).toBe(true);
    // hasExact ignora o atalho: o bit precisa estar realmente presente.
    expect(hasExact(Permission.ADMINISTRATOR, Permission.BAN_MEMBERS)).toBe(false);
  });

  it('lista os nomes das permissões contidas no bitfield', () => {
    const bits = Permission.SEND_MESSAGES | Permission.VIEW_CHANNEL;
    expect(listPermissions(bits).sort()).toEqual(['SEND_MESSAGES', 'VIEW_CHANNEL']);
  });

  it('@everyone padrão não recebe permissões administrativas', () => {
    expect(hasExact(DEFAULT_EVERYONE_PERMISSIONS, Permission.ADMINISTRATOR)).toBe(false);
    expect(hasExact(DEFAULT_EVERYONE_PERMISSIONS, Permission.MANAGE_SERVER)).toBe(false);
    expect(hasExact(DEFAULT_EVERYONE_PERMISSIONS, Permission.SEND_MESSAGES)).toBe(true);
  });
});

describe('PermissionsService.resolveServer', () => {
  it('quem não é membro não recebe nenhuma permissão', async () => {
    const service = serviceFor({ ...base, member: null });
    expect(await service.resolveServer('server-1', 'estranho')).toBe(0n);
  });

  it('o dono recebe todas as permissões, mesmo sem cargos', async () => {
    const service = serviceFor({
      ...base,
      member: { userId: 'owner', roles: [{ roleId: 'everyone', permissions: 0n, position: 0 }] },
    });
    expect(await service.resolveServer('server-1', 'owner')).toBe(ALL_PERMISSIONS);
  });

  it('as permissões dos cargos do membro são somadas', async () => {
    const service = serviceFor({
      ...base,
      member: {
        userId: 'user-1',
        roles: [
          { roleId: 'everyone', permissions: Permission.VIEW_CHANNEL, position: 0 },
          { roleId: 'mod', permissions: Permission.KICK_MEMBERS, position: 5 },
        ],
      },
    });
    const bits = await service.resolveServer('server-1', 'user-1');
    expect(hasExact(bits, Permission.VIEW_CHANNEL)).toBe(true);
    expect(hasExact(bits, Permission.KICK_MEMBERS)).toBe(true);
  });
});

describe('PermissionsService.resolveChannel — overrides', () => {
  it('deny do @everyone no canal remove a permissão herdada', async () => {
    const service = serviceFor({
      ...base,
      overrides: [
        { roleId: 'everyone', userId: null, allow: 0n, deny: Permission.SEND_MESSAGES },
      ],
    });
    const bits = await service.resolveChannel('channel-1', 'user-1');
    expect(has(bits, Permission.SEND_MESSAGES)).toBe(false);
    expect(has(bits, Permission.VIEW_CHANNEL)).toBe(true);
  });

  it('allow de um cargo do membro vence o deny do @everyone', async () => {
    const service = serviceFor({
      ...base,
      member: {
        userId: 'user-1',
        roles: [
          { roleId: 'everyone', permissions: DEFAULT_EVERYONE_PERMISSIONS, position: 0 },
          { roleId: 'mod', permissions: 0n, position: 3 },
        ],
      },
      overrides: [
        { roleId: 'everyone', userId: null, allow: 0n, deny: Permission.SEND_MESSAGES },
        { roleId: 'mod', userId: null, allow: Permission.SEND_MESSAGES, deny: 0n },
      ],
    });
    expect(has(await service.resolveChannel('channel-1', 'user-1'), Permission.SEND_MESSAGES)).toBe(
      true,
    );
  });

  it('override do próprio membro tem a palavra final sobre o do cargo', async () => {
    const service = serviceFor({
      ...base,
      member: {
        userId: 'user-1',
        roles: [
          { roleId: 'everyone', permissions: DEFAULT_EVERYONE_PERMISSIONS, position: 0 },
          { roleId: 'mod', permissions: 0n, position: 3 },
        ],
      },
      overrides: [
        { roleId: 'mod', userId: null, allow: Permission.SEND_MESSAGES, deny: 0n },
        { roleId: null, userId: 'user-1', allow: 0n, deny: Permission.SEND_MESSAGES },
      ],
    });
    expect(has(await service.resolveChannel('channel-1', 'user-1'), Permission.SEND_MESSAGES)).toBe(
      false,
    );
  });

  it('overrides não afetam o dono do servidor', async () => {
    const service = serviceFor({
      ...base,
      member: { userId: 'owner', roles: [{ roleId: 'everyone', permissions: 0n, position: 0 }] },
      overrides: [
        { roleId: 'everyone', userId: null, allow: 0n, deny: ALL_PERMISSIONS },
        { roleId: null, userId: 'owner', allow: 0n, deny: ALL_PERMISSIONS },
      ],
    });
    expect(await service.resolveChannel('channel-1', 'owner')).toBe(ALL_PERMISSIONS);
  });

  it('assertChannelPermission exige VIEW_CHANNEL antes de qualquer outra ação', async () => {
    const service = serviceFor({
      ...base,
      overrides: [{ roleId: 'everyone', userId: null, allow: 0n, deny: Permission.VIEW_CHANNEL }],
    });
    await expect(
      service.assertChannelPermission('channel-1', 'user-1', Permission.SEND_MESSAGES),
    ).rejects.toThrow();
  });
});

describe('PermissionsService.assertHigherThan', () => {
  const hierarchy = (userId: string, position: number) => ({
    id: 'm',
    server: { ownerId: 'owner' },
    roles: [{ roleId: 'r', role: { permissions: 0n, position } }],
    userId,
  });

  function serviceWith(positions: Record<string, number>): PermissionsService {
    const prisma = {
      serverMember: {
        findUnique: async ({ where }: { where: { serverId_userId: { userId: string } } }) => {
          const userId = where.serverId_userId.userId;
          if (!(userId in positions)) return null;
          return hierarchy(userId, positions[userId] as number);
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    return new PermissionsService(prisma);
  }

  it('permite agir sobre quem está estritamente abaixo', async () => {
    const service = serviceWith({ mod: 5, membro: 1 });
    await expect(service.assertHigherThan('server-1', 'mod', 'membro')).resolves.toBeUndefined();
  });

  it('bloqueia ação sobre alguém de posição igual', async () => {
    const service = serviceWith({ mod: 5, outro: 5 });
    await expect(service.assertHigherThan('server-1', 'mod', 'outro')).rejects.toThrow();
  });

  it('o dono nunca pode ser alvo', async () => {
    const service = serviceWith({ mod: 99, owner: 0 });
    await expect(service.assertHigherThan('server-1', 'mod', 'owner')).rejects.toThrow();
  });
});
