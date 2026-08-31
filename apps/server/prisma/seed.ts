/**
 * Seed de DESENVOLVIMENTO. As senhas abaixo são públicas de propósito e não
 * devem existir em produção — o script se recusa a rodar com NODE_ENV=production.
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { DEFAULT_EVERYONE_PERMISSIONS, DM_TTL_MS, Permission } from '@nexus/shared';

const prisma = new PrismaClient();
const DEV_PASSWORD = 'nexus-dev-2026';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('O seed de desenvolvimento não pode rodar em produção.');
  }

  const passwordHash = await argon2.hash(DEV_PASSWORD, { type: argon2.argon2id });
  const people = [
    { email: 'ana@nexus.local', username: 'ana', displayName: 'Ana' },
    { email: 'bruno@nexus.local', username: 'bruno', displayName: 'Bruno' },
    { email: 'clara@nexus.local', username: 'clara', displayName: 'Clara' },
  ];

  const users = [];
  for (const person of people) {
    users.push(
      await prisma.user.upsert({
        where: { email: person.email },
        update: {},
        create: {
          ...person,
          passwordHash,
          isGlobalAdmin: person.username === 'ana',
          settings: { create: {} },
          presence: { create: { status: 'OFFLINE' } },
        },
      }),
    );
  }
  const [ana, bruno, clara] = users;
  if (!ana || !bruno || !clara) throw new Error('Falha ao criar os usuários do seed.');

  const existing = await prisma.server.findFirst({ where: { name: 'Casa dos Amigos' } });
  if (!existing) {
    const server = await prisma.server.create({
      data: { name: 'Casa dos Amigos', ownerId: ana.id },
    });

    const everyone = await prisma.role.create({
      data: {
        serverId: server.id,
        name: '@everyone',
        isEveryone: true,
        position: 0,
        permissions: DEFAULT_EVERYONE_PERMISSIONS,
      },
    });
    const moderator = await prisma.role.create({
      data: {
        serverId: server.id,
        name: 'Moderador',
        color: '#5b8def',
        position: 5,
        permissions:
          DEFAULT_EVERYONE_PERMISSIONS |
          Permission.MANAGE_MESSAGES |
          Permission.KICK_MEMBERS |
          Permission.MUTE_MEMBERS |
          Permission.VIEW_AUDIT_LOG,
      },
    });

    for (const user of users) {
      const member = await prisma.serverMember.create({
        data: { serverId: server.id, userId: user.id },
      });
      await prisma.memberRole.create({ data: { memberId: member.id, roleId: everyone.id } });
      if (user.id === bruno.id) {
        await prisma.memberRole.create({ data: { memberId: member.id, roleId: moderator.id } });
      }
    }

    const geral = await prisma.category.create({
      data: { serverId: server.id, name: 'Geral', position: 0 },
    });
    const jogos = await prisma.category.create({
      data: { serverId: server.id, name: 'Jogos', position: 1 },
    });

    const conversa = await prisma.channel.create({
      data: { serverId: server.id, categoryId: geral.id, name: 'conversa', type: 'TEXT', position: 0 },
    });
    await prisma.channel.create({
      data: { serverId: server.id, categoryId: geral.id, name: 'Sala de voz', type: 'VOICE', position: 1 },
    });
    await prisma.channel.create({
      data: { serverId: server.id, categoryId: jogos.id, name: 'partidas', type: 'TEXT', position: 0 },
    });

    await prisma.message.createMany({
      data: [
        { channelId: conversa.id, authorId: ana.id, content: 'Servidor no ar 🎉' },
        { channelId: conversa.id, authorId: bruno.id, content: 'Testando o chat por aqui.' },
        { channelId: conversa.id, authorId: clara.id, content: 'Chamem quando for jogar!' },
      ],
    });
  }

  await prisma.friendship.upsert({
    where: {
      userAId_userBId:
        ana.id < bruno.id ? { userAId: ana.id, userBId: bruno.id } : { userAId: bruno.id, userBId: ana.id },
    },
    update: {},
    create:
      ana.id < bruno.id ? { userAId: ana.id, userBId: bruno.id } : { userAId: bruno.id, userBId: ana.id },
  });

  // Uma DM de exemplo, já com o prazo de 8h contado a partir de agora.
  const conversation =
    (await prisma.directConversation.findFirst({
      where: {
        isGroup: false,
        AND: [
          { participants: { some: { userId: ana.id } } },
          { participants: { some: { userId: bruno.id } } },
        ],
      },
    })) ??
    (await prisma.directConversation.create({
      data: {
        isGroup: false,
        participants: { create: [{ userId: ana.id }, { userId: bruno.id }] },
      },
    }));

  const now = new Date();
  await prisma.directMessage.create({
    data: {
      conversationId: conversation.id,
      authorId: ana.id,
      content: 'Esta mensagem some sozinha em 8 horas.',
      createdAt: now,
      expiresAt: new Date(now.getTime() + DM_TTL_MS),
    },
  });

  console.log('Seed concluído.');
  console.log(`Usuários: ${people.map((p) => p.email).join(', ')}`);
  console.log(`Senha de desenvolvimento: ${DEV_PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
