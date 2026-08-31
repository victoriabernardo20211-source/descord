import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DM_TTL_MS } from '@nexus/shared';
import { ExpirationService } from '../src/direct-messages/expiration.service';
import { DirectMessagesService } from '../src/direct-messages/direct-messages.service';
import { loadConfig } from '../src/config/configuration';

const BASE_ENV = {
  DATABASE_URL: 'postgresql://x/y',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'x'.repeat(40),
  JWT_REFRESH_SECRET: 'y'.repeat(40),
};

/** Coleta o que foi realmente apagado do banco, do storage e emitido no WS. */
function harness(messages: Array<{ id: string; conversationId: string; keys: string[] }>) {
  const deletedRows: string[] = [];
  const deletedFiles: string[] = [];
  const emitted: Array<{ event: string; data: unknown }> = [];
  let store = [...messages];

  const prisma = {
    directMessage: {
      findMany: async ({ where }: { where?: { id?: { in: string[] } } } = {}) =>
        store
          .filter((m) => !where?.id || where.id.in.includes(m.id))
          .map((m) => ({
            id: m.id,
            conversationId: m.conversationId,
            attachments: m.keys.map((k) => ({ storageKey: k, thumbnailKey: null })),
          })),
      deleteMany: ({ where }: { where: { id: { in: string[] } } }) => {
        deletedRows.push(...where.id.in);
        store = store.filter((m) => !where.id.in.includes(m.id));
        return { count: where.id.in.length };
      },
    },
    directMessageAttachment: { deleteMany: () => ({ count: 0 }) },
    // A transação executa as operações já materializadas acima.
    $transaction: async (ops: unknown[]) => Promise.all(ops),
  };

  const files = {
    remove: async (keys: (string | null)[]) => {
      deletedFiles.push(...keys.filter((k): k is string => !!k));
    },
  };
  const events = {
    emit: (_target: string, event: string, data: unknown) => emitted.push({ event, data }),
  };
  const redis = { client: { duplicate: () => ({}) } };

  const service = new ExpirationService(
    prisma as never,
    redis as never,
    files as never,
    events as never,
    loadConfig({ ...BASE_ENV } as never),
  );

  return { service, deletedRows, deletedFiles, emitted, remaining: () => store };
}

describe('cálculo de expiresAt', () => {
  it('expiresAt é exatamente createdAt + 8 horas', () => {
    const createdAt = new Date('2026-08-31T18:00:00.000Z');
    const expiresAt = new Date(createdAt.getTime() + DM_TTL_MS);
    expect(expiresAt.toISOString()).toBe('2026-09-01T02:00:00.000Z');
  });

  it('a conta é feita em UTC, imune a horário de verão', () => {
    // Véspera de mudança de horário no hemisfério norte: 8h continuam 8h.
    const createdAt = new Date('2026-03-08T06:30:00.000Z');
    const expiresAt = new Date(createdAt.getTime() + DM_TTL_MS);
    expect(expiresAt.getTime() - createdAt.getTime()).toBe(8 * 60 * 60 * 1000);
    expect(expiresAt.toISOString()).toBe('2026-03-08T14:30:00.000Z');
  });

  it('produção ignora qualquer tentativa de encurtar/estender o TTL por env', () => {
    const config = loadConfig({
      ...BASE_ENV,
      NODE_ENV: 'production',
      DM_TTL_MS: '1000',
    } as never);
    expect(config.dmTtlMs).toBe(DM_TTL_MS);
  });

  it('somente NODE_ENV=test aceita o override, para os testes não esperarem 8h', () => {
    const config = loadConfig({ ...BASE_ENV, NODE_ENV: 'test', DM_TTL_MS: '1000' } as never);
    expect(config.dmTtlMs).toBe(1000);
  });
});

describe('ExpirationService.deleteMessages', () => {
  it('apaga a linha, os arquivos e avisa os participantes', async () => {
    const h = harness([{ id: 'm1', conversationId: 'c1', keys: ['blob/1', 'blob/1_thumb'] }]);
    await h.service.deleteMessages(['m1']);

    expect(h.deletedRows).toContain('m1');
    expect(h.deletedFiles).toEqual(['blob/1', 'blob/1_thumb']);
    expect(h.remaining()).toHaveLength(0);

    const expired = h.emitted.find((e) => e.event === 'dm.expired');
    expect(expired?.data).toEqual({ conversationId: 'c1', messageIds: ['m1'] });
  });

  it('é idempotente: rodar de novo não quebra nem reemite', async () => {
    const h = harness([{ id: 'm1', conversationId: 'c1', keys: [] }]);
    await h.service.deleteMessages(['m1']);
    const emittedAfterFirst = h.emitted.length;
    await h.service.deleteMessages(['m1']);
    expect(h.emitted.length).toBe(emittedAfterFirst);
  });

  it('agrupa o evento por conversa quando várias expiram juntas', async () => {
    const h = harness([
      { id: 'm1', conversationId: 'c1', keys: [] },
      { id: 'm2', conversationId: 'c1', keys: [] },
      { id: 'm3', conversationId: 'c2', keys: [] },
    ]);
    await h.service.deleteMessages(['m1', 'm2', 'm3']);

    const events = h.emitted.filter((e) => e.event === 'dm.expired');
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.data)).toContainEqual({
      conversationId: 'c1',
      messageIds: ['m1', 'm2'],
    });
  });
});

describe('reconciliação periódica', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('varre apenas mensagens com expiresAt já vencido', async () => {
    let capturedWhere: unknown;
    const prisma = {
      directMessage: {
        findMany: async (args: { where?: { id?: unknown }; select?: unknown }) => {
          // A varredura busca por expiresAt; deleteMessages busca pelos ids achados.
          if (!args.where?.id) {
            capturedWhere = args.where;
            return [{ id: 'vencida' }];
          }
          return [{ id: 'vencida', conversationId: 'c1', attachments: [] }];
        },
        deleteMany: () => ({ count: 1 }),
      },
      directMessageAttachment: { deleteMany: () => ({ count: 0 }) },
      $transaction: async (ops: unknown[]) => Promise.all(ops),
    };

    const service = new ExpirationService(
      prisma as never,
      { client: { duplicate: () => ({}) } } as never,
      { remove: async () => undefined } as never,
      { emit: () => undefined } as never,
      loadConfig({ ...BASE_ENV } as never),
    );

    vi.setSystemTime(new Date('2026-08-31T20:00:00.000Z'));
    const count = await service.reconcile();

    expect(count).toBe(1);
    expect(capturedWhere).toEqual({ expiresAt: { lte: new Date('2026-08-31T20:00:00.000Z') } });
  });
});

describe('DirectMessagesService — leitura', () => {
  it('o histórico sempre filtra expiresAt > agora, mesmo sem job ter rodado', async () => {
    let capturedWhere: Record<string, unknown> = {};
    const prisma = {
      directConversationParticipant: { findUnique: async () => ({ id: 'p1' }) },
      directMessage: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          capturedWhere = args.where;
          return [];
        },
        findUnique: async () => null,
      },
    };

    const service = new DirectMessagesService(
      prisma as never,
      { emit: () => undefined } as never,
      { claim: async () => [] } as never,
      { schedule: async () => undefined } as never,
      loadConfig({ ...BASE_ENV } as never),
    );

    await service.listMessages('c1', 'u1');

    const expiresAt = capturedWhere.expiresAt as { gt: Date };
    expect(expiresAt).toBeDefined();
    expect(expiresAt.gt).toBeInstanceOf(Date);
    // Margem de 1s: o filtro é o "agora" do servidor.
    expect(Math.abs(expiresAt.gt.getTime() - Date.now())).toBeLessThan(1000);
  });

  it('quem não participa da conversa recebe 404, não o conteúdo', async () => {
    const prisma = {
      directConversationParticipant: { findUnique: async () => null },
      directMessage: { findMany: async () => [] },
    };
    const service = new DirectMessagesService(
      prisma as never,
      { emit: () => undefined } as never,
      { claim: async () => [] } as never,
      { schedule: async () => undefined } as never,
      loadConfig({ ...BASE_ENV } as never),
    );

    await expect(service.listMessages('c1', 'intruso')).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });
  });
});
