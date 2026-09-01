import { beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { FilesService, sanitizeFileName } from '../src/files/files.service';
import { loadConfig } from '../src/config/configuration';

/**
 * O tipo de arquivo é decidido pelo CONTEÚDO (magic bytes), nunca pela extensão
 * nem pelo header que o cliente mandou. Estes testes provam isso e também
 * guardam o carregamento dinâmico do `file-type`, que é ESM puro — se alguém
 * trocar por um `require`, eles quebram na hora em vez de só em produção.
 */
const config = loadConfig({
  DATABASE_URL: 'postgresql://x/y',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'x'.repeat(40),
  JWT_REFRESH_SECRET: 'y'.repeat(40),
} as never);

function serviceWith(stored: Record<string, Buffer>): FilesService {
  const storage = {
    put: async (key: string, data: Buffer) => {
      stored[key] = data;
      return { key, size: data.byteLength };
    },
    get: async (key: string) => stored[key] as Buffer,
    delete: async (key: string) => {
      delete stored[key];
    },
    exists: async (key: string) => key in stored,
  };
  return new FilesService(storage as never, config);
}

/** PNG real, gerado pelo próprio sharp — escrever os bytes à mão dá CRC inválido. */
let PNG: Buffer;
beforeAll(async () => {
  PNG = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 90, g: 70, b: 240 } },
  })
    .png()
    .toBuffer();
});
/** Cabeçalho "MZ": executável do Windows. */
const EXE = Buffer.from('4d5a90000300000004000000ffff0000b800000000000000', 'hex');

function upload(buffer: Buffer, originalname: string, mimetype: string) {
  return { buffer, originalname, mimetype, size: buffer.byteLength } as Express.Multer.File;
}

describe('FilesService.store', () => {
  it('aceita uma imagem e gera miniatura', async () => {
    const stored: Record<string, Buffer> = {};
    const result = await serviceWith(stored).store(upload(PNG, 'foto.png', 'image/png'), 'test');

    expect(result.mimeType).toBe('image/png');
    expect(result.width).toBe(8);
    expect(result.thumbnailKey).not.toBeNull();
    // O nome no disco é aleatório: o nome original nunca vira caminho.
    expect(result.storageKey).not.toContain('foto.png');
  });

  it('rejeita executável renomeado como imagem', async () => {
    const service = serviceWith({});
    // Extensão e Content-Type mentem; o conteúdo entrega.
    await expect(
      service.store(upload(EXE, 'gatinho.png', 'image/png'), 'test'),
    ).rejects.toMatchObject({ response: { code: 'FILE_TYPE_NOT_ALLOWED' } });
  });

  it('rejeita arquivo acima do limite configurado', async () => {
    const service = serviceWith({});
    const big = upload(PNG, 'grande.png', 'image/png');
    Object.assign(big, { size: config.MAX_UPLOAD_SIZE + 1 });
    await expect(service.store(big, 'test')).rejects.toMatchObject({
      response: { code: 'FILE_TOO_LARGE' },
    });
  });

  it('remoção é idempotente — a expiração de DM depende disso', async () => {
    const stored: Record<string, Buffer> = {};
    const service = serviceWith(stored);
    const result = await service.store(upload(PNG, 'foto.png', 'image/png'), 'test');

    await service.remove([result.storageKey, result.thumbnailKey]);
    expect(stored[result.storageKey]).toBeUndefined();
    // Rodar de novo sobre o que já sumiu não pode lançar erro.
    await expect(
      service.remove([result.storageKey, result.thumbnailKey, null]),
    ).resolves.toBeUndefined();
  });
});

describe('sanitizeFileName', () => {
  it('remove separadores de caminho e quebras de linha', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('.._.._etc_passwd');
    expect(sanitizeFileName('nome\ncom\tquebra.txt')).toBe('nomecomquebra.txt');
  });

  it('usa um nome padrão quando vem vazio', () => {
    expect(sanitizeFileName('')).toBe('arquivo');
  });
});
