import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import { AppModule } from '../../src/app.module';
import { installBigIntJson } from '../../src/common/serialize';

/**
 * Ambiente de integração real: Postgres + Redis de verdade.
 *
 * Rode com:
 *   docker compose -f infrastructure/docker/docker-compose.dev.yml up -d
 *   TEST_DATABASE_URL=postgresql://nexus:nexus@localhost:5432/nexus_test \
 *   TEST_REDIS_URL=redis://localhost:6379/1 \
 *   pnpm --filter @nexus/server test
 *
 * O TTL das DMs é reduzido para 2 segundos via DM_TTL_MS — só possível porque
 * NODE_ENV=test. Em produção o override é ignorado (ver configuration.ts).
 */
export const TEST_DM_TTL_MS = 2000;

export interface TestContext {
  app: INestApplication;
  prisma: PrismaClient;
  baseUrl: string;
}

export async function createTestApp(): Promise<TestContext> {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error('Defina TEST_DATABASE_URL para rodar os testes de integração.');

  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = databaseUrl;
  process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1';
  process.env.JWT_SECRET = 'test-secret-com-mais-de-32-caracteres-aqui';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-com-mais-de-32-caracteres-aqui';
  process.env.STORAGE_PATH = './storage-test';
  process.env.DM_TTL_MS = String(TEST_DM_TTL_MS);

  execSync('npx prisma migrate deploy', { env: process.env, stdio: 'inherit' });

  installBigIntJson();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  await app.init();
  await app.listen(0);

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const address = app.getHttpServer().address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return { app, prisma, baseUrl: `http://127.0.0.1:${port}` };
}

export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  // Ordem importa por causa das foreign keys.
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "DirectMessageAttachment", "DirectMessage",
      "DirectConversationParticipant", "DirectConversation",
      "MessageAttachment", "MessageReaction", "PinnedMessage", "Message",
      "ChannelRead", "ChannelPermission", "Channel", "Category",
      "MemberRole", "Role", "ServerMember", "ServerInvite", "ServerBan",
      "AuditLog", "Server", "Notification", "Friendship", "FriendRequest",
      "Block", "Presence", "UserSettings", "Session", "User"
    RESTART IDENTITY CASCADE
  `);
}

export interface TestUser {
  id: string;
  username: string;
  accessToken: string;
}

export async function registerUser(baseUrl: string, username: string): Promise<TestUser> {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `${username}@test.local`,
      username,
      displayName: username,
      password: 'senha-de-teste-123',
    }),
  });
  if (!res.ok) throw new Error(`Falha ao registrar ${username}: ${await res.text()}`);
  const body = (await res.json()) as { accessToken: string; user: { id: string } };
  return { id: body.user.id, username, accessToken: body.accessToken };
}

export function authed(user: TestUser): Record<string, string> {
  return {
    Authorization: `Bearer ${user.accessToken}`,
    'Content-Type': 'application/json',
  };
}

export const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
