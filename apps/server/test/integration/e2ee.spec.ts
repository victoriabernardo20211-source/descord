import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  authed,
  createTestApp,
  envelopeFor,
  registerUser,
  resetDatabase,
  type TestContext,
  type TestUser,
} from './setup';

/**
 * Garantias do SERVIDOR no fluxo de criptografia ponta a ponta.
 * A criptografia em si é testada com Olm real em apps/desktop/test/crypto.spec.ts.
 */
describe('E2EE — diretório de chaves e opacidade do servidor', () => {
  let ctx: TestContext;
  let ana: TestUser;
  let bruno: TestUser;

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
  });

  it('o servidor guarda apenas o texto cifrado, nunca o original', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/dm/conversations`, {
      method: 'POST',
      headers: authed(ana),
      body: JSON.stringify({ userIds: [bruno.id] }),
    });
    const { id: conversationId } = (await res.json()) as { id: string };

    await fetch(`${ctx.baseUrl}/api/dm/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: authed(ana),
      body: JSON.stringify({ encryption: envelopeFor(ana, 'CIFRADO-OPACO-123') }),
    });

    // Lendo direto do banco, como faria quem administra o servidor.
    const row = await ctx.prisma.directMessage.findFirstOrThrow({ where: { conversationId } });
    expect(row.content).toBe('CIFRADO-OPACO-123');
    expect(row.algorithm).toBe('m.megolm.v1.aes-sha2');
    expect(row.senderDeviceId).toBe(ana.deviceId);
  });

  it('recusa envelope que diz vir do dispositivo de outra pessoa', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/dm/conversations`, {
      method: 'POST',
      headers: authed(ana),
      body: JSON.stringify({ userIds: [bruno.id] }),
    });
    const { id: conversationId } = (await res.json()) as { id: string };

    // Ana tentando forjar uma mensagem como se fosse do dispositivo do Bruno.
    const forged = await fetch(
      `${ctx.baseUrl}/api/dm/conversations/${conversationId}/messages`,
      {
        method: 'POST',
        headers: authed(ana),
        body: JSON.stringify({ encryption: envelopeFor(bruno, 'forjada') }),
      },
    );
    expect(forged.status).toBe(403);
  });

  it('entrega cada prekey no máximo uma vez', async () => {
    await fetch(`${ctx.baseUrl}/api/e2ee/keys/upload`, {
      method: 'POST',
      headers: authed(bruno),
      body: JSON.stringify({
        deviceId: bruno.deviceId,
        oneTimeKeys: { 'AAAAAA': 'chave-unica-de-teste-aaaaaaaaaaaaaaaa' },
      }),
    });

    const claim = async () => {
      const res = await fetch(`${ctx.baseUrl}/api/e2ee/keys/claim`, {
        method: 'POST',
        headers: authed(ana),
        body: JSON.stringify({ requests: [{ userId: bruno.id, deviceId: bruno.deviceId }] }),
      });
      return (await res.json()) as Record<string, Record<string, { key: string }>>;
    };

    const first = await claim();
    expect(first[bruno.id]?.[bruno.deviceId]?.key).toBeDefined();

    // A segunda tentativa não recebe nada: a prekey foi consumida.
    const second = await claim();
    expect(second[bruno.id]?.[bruno.deviceId]).toBeUndefined();
  });

  it('recusa registrar o mesmo deviceId com outra chave de identidade', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/e2ee/devices`, {
      method: 'POST',
      headers: authed(ana),
      body: JSON.stringify({
        deviceId: ana.deviceId,
        identityKey: 'chave-diferente-de-substituicao-aaaa',
        signingKey: 'assinatura-diferente-aaaaaaaaaaaaaaaa',
      }),
    });
    expect(res.status).toBe(403);
  });

  it('encaminha envelopes de dispositivo sem conseguir abri-los', async () => {
    const payload = 'envelope-olm-opaco';
    const sent = await fetch(`${ctx.baseUrl}/api/e2ee/to-device`, {
      method: 'POST',
      headers: authed(ana),
      body: JSON.stringify({
        deviceId: ana.deviceId,
        messages: [{ userId: bruno.id, deviceId: bruno.deviceId, payload }],
      }),
    });
    expect(sent.ok).toBe(true);

    const drained = await fetch(`${ctx.baseUrl}/api/e2ee/to-device/${bruno.deviceId}`, {
      headers: authed(bruno),
    });
    const messages = (await drained.json()) as { payload: string; senderDeviceId: string }[];
    expect(messages).toHaveLength(1);
    expect(messages[0]?.payload).toBe(payload);

    // Consumidos: uma segunda busca não devolve nada.
    const again = await fetch(`${ctx.baseUrl}/api/e2ee/to-device/${bruno.deviceId}`, {
      headers: authed(bruno),
    });
    expect(await again.json()).toHaveLength(0);
  });
});
