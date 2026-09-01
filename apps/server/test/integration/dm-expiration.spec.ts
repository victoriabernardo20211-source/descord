import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import sharp from 'sharp';
import { WS_EVENT } from '@nexus/shared';
import {
  TEST_DM_TTL_MS,
  authed,
  createTestApp,
  envelopeFor,
  registerUser,
  resetDatabase,
  wait,
  type TestContext,
  type TestUser,
} from './setup';

/**
 * Os dez critérios de aceitação da expiração de mensagens privadas.
 * O TTL é de 2 segundos aqui — nenhum teste espera 8 horas.
 */
describe('expiração de mensagens privadas (integração)', () => {
  let ctx: TestContext;
  let ana: TestUser;
  let bruno: TestUser;
  let conversationId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 60_000);

  afterAll(async () => {
    await ctx.prisma.$disconnect();
    await ctx.app.close();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    ana = await registerUser(ctx.baseUrl, 'ana');
    bruno = await registerUser(ctx.baseUrl, 'bruno');

    const res = await fetch(`${ctx.baseUrl}/api/dm/conversations`, {
      method: 'POST',
      headers: authed(ana),
      body: JSON.stringify({ userIds: [bruno.id] }),
    });
    conversationId = ((await res.json()) as { id: string }).id;
  });

  async function send(user: TestUser, content: string): Promise<{ id: string; expiresAt: string }> {
    const res = await fetch(`${ctx.baseUrl}/api/dm/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: authed(user),
      // O que trafega é sempre um envelope; o servidor nunca recebe texto puro.
      body: JSON.stringify({ encryption: envelopeFor(user, content) }),
    });
    if (!res.ok) throw new Error(await res.text());
    return (await res.json()) as { id: string; expiresAt: string };
  }

  async function history(user: TestUser): Promise<{ id: string }[]> {
    const res = await fetch(
      `${ctx.baseUrl}/api/dm/conversations/${conversationId}/messages`,
      { headers: authed(user) },
    );
    return (await res.json()) as { id: string }[];
  }

  it('1. a mensagem criada recebe expiresAt = createdAt + TTL', async () => {
    const message = await send(ana, 'vamos jogar?');
    const row = await ctx.prisma.directMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(TEST_DM_TTL_MS);
  });

  it('2. a mensagem existe e é legível antes de expirar', async () => {
    const message = await send(ana, 'oi');
    expect((await history(bruno)).map((m) => m.id)).toContain(message.id);
  });

  it('3. a mensagem é apagada do banco depois de expirar', async () => {
    const message = await send(ana, 'some depois');
    await wait(TEST_DM_TTL_MS + 1500);
    expect(await ctx.prisma.directMessage.findUnique({ where: { id: message.id } })).toBeNull();
  });

  it('4. o cliente recebe dm.expired pelo WebSocket', async () => {
    const socket: Socket = io(ctx.baseUrl, {
      auth: { token: bruno.accessToken },
      transports: ['websocket'],
    });
    await new Promise<void>((resolve) => socket.on('connect', () => resolve()));

    const expired = new Promise<{ messageIds: string[] }>((resolve) => {
      socket.on(WS_EVENT, (envelope: { event: string; data: { messageIds: string[] } }) => {
        if (envelope.event === 'dm.expired') resolve(envelope.data);
      });
    });

    const message = await send(ana, 'até logo');
    const payload = await Promise.race([
      expired,
      wait(TEST_DM_TTL_MS + 5000).then(() => null),
    ]);
    socket.disconnect();

    expect(payload?.messageIds).toContain(message.id);
  });

  it('5. os anexos da mensagem são removidos junto', async () => {
    // Gerado pelo sharp: um PNG escrito à mão sai com CRC inválido.
    const png = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 90, g: 70, b: 240 } },
    })
      .png()
      .toBuffer();
    const form = new FormData();
    form.append('file', new Blob([png], { type: 'image/png' }), 'ponto.png');

    const uploadRes = await fetch(`${ctx.baseUrl}/api/files/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ana.accessToken}` },
      body: form,
    });
    const upload = (await uploadRes.json()) as { id: string };

    const sendRes = await fetch(
      `${ctx.baseUrl}/api/dm/conversations/${conversationId}/messages`,
      {
        method: 'POST',
        headers: authed(ana),
        body: JSON.stringify({
          encryption: envelopeFor(ana, 'olha isso'),
          attachmentIds: [upload.id],
        }),
      },
    );
    const message = (await sendRes.json()) as { id: string; attachments: { id: string }[] };
    expect(message.attachments.length).toBe(1);

    await wait(TEST_DM_TTL_MS + 1500);

    const attachments = await ctx.prisma.directMessageAttachment.findMany({
      where: { messageId: message.id },
    });
    expect(attachments).toHaveLength(0);
  });

  it('6 e 7. mensagem vencida durante a parada do backend some na inicialização', async () => {
    // Simula downtime: a linha é gravada direto no banco já vencida, sem job na fila.
    const past = new Date(Date.now() - 60_000);
    const orphan = await ctx.prisma.directMessage.create({
      data: {
        conversationId,
        authorId: ana.id,
        content: 'ciphertext-antes-do-backend-cair',
        algorithm: 'm.megolm.v1.aes-sha2',
        createdAt: past,
        expiresAt: new Date(past.getTime() + 1000),
      },
    });

    // A reconciliação (o mesmo código do purge de inicialização) precisa pegá-la.
    await wait(70_000);
    expect(await ctx.prisma.directMessage.findUnique({ where: { id: orphan.id } })).toBeNull();
  }, 90_000);

  it('8. a API não devolve a mensagem vencida nem antes do job rodar', async () => {
    const past = new Date(Date.now() - 60_000);
    const stale = await ctx.prisma.directMessage.create({
      data: {
        conversationId,
        authorId: ana.id,
        content: 'ciphertext-ja-vencido',
        algorithm: 'm.megolm.v1.aes-sha2',
        createdAt: past,
        expiresAt: new Date(past.getTime() + 1000),
      },
    });

    // A linha existe fisicamente...
    expect(await ctx.prisma.directMessage.findUnique({ where: { id: stale.id } })).not.toBeNull();
    // ...mas a API já a trata como inexistente.
    expect((await history(bruno)).map((m) => m.id)).not.toContain(stale.id);
  });

  it('9. quem não participa da conversa não lê nada, mesmo sabendo o id', async () => {
    await send(ana, 'assunto privado');
    const carla = await registerUser(ctx.baseUrl, 'carla');

    const res = await fetch(
      `${ctx.baseUrl}/api/dm/conversations/${conversationId}/messages`,
      { headers: authed(carla) },
    );
    expect(res.status).toBe(404);
  });

  it('10. restaurar um backup não ressuscita uma DM já expirada', async () => {
    // Um dump antigo restaurado equivale a reinserir a linha com expiresAt no passado.
    const past = new Date(Date.now() - 10 * 60 * 60 * 1000);
    const restored = await ctx.prisma.directMessage.create({
      data: {
        conversationId,
        authorId: ana.id,
        content: 'ciphertext-de-backup-antigo',
        algorithm: 'm.megolm.v1.aes-sha2',
        createdAt: past,
        expiresAt: new Date(past.getTime() + TEST_DM_TTL_MS),
      },
    });

    // Inacessível imediatamente...
    expect((await history(ana)).map((m) => m.id)).not.toContain(restored.id);
    // ...e removida fisicamente pela reconciliação.
    await wait(70_000);
    expect(await ctx.prisma.directMessage.findUnique({ where: { id: restored.id } })).toBeNull();
  }, 90_000);

  it('editar a mensagem não renova o prazo', async () => {
    const message = await send(ana, 'texto original');
    const before = await ctx.prisma.directMessage.findUniqueOrThrow({ where: { id: message.id } });

    await fetch(`${ctx.baseUrl}/api/dm/messages/${message.id}`, {
      method: 'PATCH',
      headers: authed(ana),
      body: JSON.stringify({ encryption: envelopeFor(ana, 'texto editado') }),
    });

    const after = await ctx.prisma.directMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(after.expiresAt.getTime()).toBe(before.expiresAt.getTime());
  });
});
