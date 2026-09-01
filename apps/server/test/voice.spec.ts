import { describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS, DEFAULT_EVERYONE_PERMISSIONS, Permission } from '@nexus/shared';
import { VoiceService } from '../src/voice/voice.service';
import { loadConfig } from '../src/config/configuration';

/**
 * O token do LiveKit é a única coisa que separa "pode ouvir" de "pode falar" de
 * "pode transmitir a tela". O LiveKit não consulta o nosso banco: ele confia no
 * que assinamos. Por isso os grants precisam de teste próprio.
 */
const config = loadConfig({
  DATABASE_URL: 'postgresql://x/y',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'x'.repeat(40),
  JWT_REFRESH_SECRET: 'y'.repeat(40),
  LIVEKIT_URL: 'ws://livekit:7880',
  LIVEKIT_API_KEY: 'devkey',
  LIVEKIT_API_SECRET: 'segredo-de-teste-com-32-caracteres!!',
} as never);

interface Grant {
  room: string;
  roomJoin: boolean;
  canPublish: boolean;
  canSubscribe: boolean;
  canPublishSources?: string[];
  roomAdmin?: boolean;
  roomCreate?: boolean;
}

function decodeGrants(jwt: string): Grant {
  const payload = JSON.parse(Buffer.from(jwt.split('.')[1] as string, 'base64url').toString());
  return payload.video as Grant;
}

function serviceFor(permissions: bigint, channelType: 'VOICE' | 'TEXT' = 'VOICE'): VoiceService {
  const prisma = {
    channel: {
      findUnique: async () => ({
        id: 'canal-voz',
        type: channelType,
        serverId: 'server-1',
        name: 'Sala de voz',
      }),
    },
    user: {
      findUniqueOrThrow: async () => ({ username: 'ana', displayName: 'Ana' }),
    },
    directConversationParticipant: { findUnique: async () => ({ id: 'p1' }) },
  };
  const perms = { resolveChannel: async () => permissions };

  return new VoiceService(
    prisma as never,
    { client: {} } as never,
    perms as never,
    { emit: () => undefined } as never,
    config,
  );
}

describe('token de voz — grants derivados das permissões', () => {
  it('quem tem CONNECT e SPEAK pode publicar o microfone', async () => {
    const service = serviceFor(
      Permission.VIEW_CHANNEL | Permission.CONNECT | Permission.SPEAK,
    );
    const result = await service.issueChannelToken('canal-voz', 'ana');
    const grant = decodeGrants(result.token);

    expect(grant.roomJoin).toBe(true);
    expect(grant.canPublish).toBe(true);
    expect(grant.canPublishSources).toContain('microphone');
    // Sem STREAM, a tela fica de fora dos grants.
    expect(grant.canPublishSources).not.toContain('screen_share');
    expect(result.canStream).toBe(false);
  });

  it('sem SPEAK o token não permite publicar nada — só ouvir', async () => {
    const service = serviceFor(Permission.VIEW_CHANNEL | Permission.CONNECT);
    const result = await service.issueChannelToken('canal-voz', 'ana');
    const grant = decodeGrants(result.token);

    expect(grant.canSubscribe).toBe(true);
    expect(grant.canPublish).toBe(false);
    expect(result.canSpeak).toBe(false);
  });

  it('STREAM libera tela e áudio da tela, não só vídeo', async () => {
    const service = serviceFor(
      Permission.VIEW_CHANNEL | Permission.CONNECT | Permission.SPEAK | Permission.STREAM,
    );
    const grant = decodeGrants((await service.issueChannelToken('canal-voz', 'ana')).token);

    expect(grant.canPublishSources).toContain('screen_share');
    expect(grant.canPublishSources).toContain('screen_share_audio');
  });

  it('sem CONNECT o token nem é emitido', async () => {
    const service = serviceFor(Permission.VIEW_CHANNEL);
    await expect(service.issueChannelToken('canal-voz', 'ana')).rejects.toMatchObject({
      response: { code: 'MISSING_PERMISSION' },
    });
  });

  it('sem VIEW_CHANNEL o token nem é emitido', async () => {
    const service = serviceFor(Permission.CONNECT | Permission.SPEAK);
    await expect(service.issueChannelToken('canal-voz', 'ana')).rejects.toMatchObject({
      response: { code: 'MISSING_PERMISSION' },
    });
  });

  it('o token nunca concede administração do LiveKit', async () => {
    const service = serviceFor(ALL_PERMISSIONS);
    const grant = decodeGrants((await service.issueChannelToken('canal-voz', 'ana')).token);

    // Mesmo o dono do servidor não administra o SFU nem cria salas arbitrárias.
    expect(grant.roomAdmin).toBeFalsy();
    expect(grant.roomCreate).toBeFalsy();
  });

  it('o token vale para UMA sala só', async () => {
    const service = serviceFor(DEFAULT_EVERYONE_PERMISSIONS);
    const grant = decodeGrants((await service.issueChannelToken('canal-voz', 'ana')).token);
    expect(grant.room).toBe('channel:canal-voz');
  });

  it('canal de texto não emite token de voz', async () => {
    const service = serviceFor(ALL_PERMISSIONS, 'TEXT');
    await expect(service.issueChannelToken('canal-texto', 'ana')).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });
  });

  it('salas de canal e de conversa privada não colidem', () => {
    expect(VoiceService.roomName('channel', 'abc')).toBe('channel:abc');
    expect(VoiceService.roomName('dm', 'abc')).toBe('dm:abc');
  });

  it('o @everyone padrão já permite entrar, falar e transmitir', async () => {
    const service = serviceFor(DEFAULT_EVERYONE_PERMISSIONS);
    const result = await service.issueChannelToken('canal-voz', 'ana');
    expect(result.canSpeak).toBe(true);
    expect(result.canStream).toBe(true);
  });

  it('sem LiveKit configurado, a voz recusa em vez de fingir', async () => {
    const semLiveKit = loadConfig({
      DATABASE_URL: 'postgresql://x/y',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'x'.repeat(40),
      JWT_REFRESH_SECRET: 'y'.repeat(40),
    } as never);

    const service = new VoiceService(
      {} as never,
      { client: {} } as never,
      {} as never,
      { emit: () => undefined } as never,
      semLiveKit,
    );

    expect(service.configured).toBe(false);
    await expect(service.issueChannelToken('canal-voz', 'ana')).rejects.toMatchObject({
      response: { code: 'VOICE_NOT_CONFIGURED' },
    });
  });
});
