import { z } from 'zod';
import { DM_TTL_MS, MAX_UPLOAD_SIZE_DEFAULT } from '@nexus/shared';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET precisa ter no mínimo 32 caracteres'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET precisa ter no mínimo 32 caracteres'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(30),
  PUBLIC_URL: z.string().default('http://localhost:4000'),
  CORS_ORIGINS: z.string().default('*'),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_PATH: z.string().default('./storage'),
  MAX_UPLOAD_SIZE: z.coerce.number().default(MAX_UPLOAD_SIZE_DEFAULT),
  INITIAL_ADMIN_EMAIL: z.string().email().optional(),
  REGISTRATION_INVITE_CODE: z.string().optional(),
  LIVEKIT_URL: z.string().optional(),
  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),
  /**
   * Override do TTL de mensagens privadas. Aceito APENAS quando NODE_ENV=test,
   * para que os testes não precisem esperar 8 horas reais. Em produção o valor
   * é sempre DM_TTL_MS (8h) — ver validateConfig abaixo.
   */
  DM_TTL_MS: z.coerce.number().optional(),
});

export type Env = z.infer<typeof envSchema>;

export interface AppConfig extends Env {
  dmTtlMs: number;
  corsOrigins: string[] | true;
  isProduction: boolean;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Configuração inválida:\n${issues.join('\n')}`);
  }
  const env = parsed.data;

  // A regra de 8 horas é inegociável fora do ambiente de teste.
  const dmTtlMs = env.NODE_ENV === 'test' && env.DM_TTL_MS ? env.DM_TTL_MS : DM_TTL_MS;

  return {
    ...env,
    dmTtlMs,
    isProduction: env.NODE_ENV === 'production',
    corsOrigins:
      env.CORS_ORIGINS === '*' ? true : env.CORS_ORIGINS.split(',').map((o) => o.trim()),
  };
}

export const CONFIG = Symbol('APP_CONFIG');
