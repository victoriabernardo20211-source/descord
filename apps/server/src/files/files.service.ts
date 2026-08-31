import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { createId } from '@paralleldrive/cuid2';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { AppConfig, CONFIG } from '../config/configuration';
import { StorageProvider } from '../storage/storage.provider';

export interface PreparedUpload {
  storageKey: string;
  thumbnailKey: string | null;
  fileName: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
}

/** Tipos aceitos. Executáveis nunca entram. */
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'application/pdf',
  'application/zip',
  'text/plain',
  'application/json',
]);

const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const THUMBNAIL_MAX = 400;

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    private readonly storage: StorageProvider,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Valida e grava o arquivo. O MIME é detectado pelo conteúdo (magic bytes),
   * nunca pela extensão ou pelo header enviado pelo cliente.
   */
  async store(file: Express.Multer.File, scope: string): Promise<PreparedUpload> {
    if (file.size > this.config.MAX_UPLOAD_SIZE) {
      throw new BadRequestException({
        code: 'FILE_TOO_LARGE',
        message: `Arquivo maior que o limite de ${Math.round(this.config.MAX_UPLOAD_SIZE / 1024 / 1024)} MB.`,
      });
    }

    const sniffed = await fileTypeFromBuffer(file.buffer);
    // text/plain e application/json não têm magic bytes; são aceitos pelo header declarado.
    const mimeType =
      sniffed?.mime ??
      (file.mimetype === 'text/plain' || file.mimetype === 'application/json'
        ? file.mimetype
        : 'application/octet-stream');

    if (!ALLOWED_MIME.has(mimeType)) {
      throw new BadRequestException({
        code: 'FILE_TYPE_NOT_ALLOWED',
        message: 'Esse tipo de arquivo não é permitido.',
      });
    }

    // Nome aleatório: o nome original nunca vira caminho no disco.
    const id = createId();
    const storageKey = `${scope}/${id}`;
    await this.storage.put(storageKey, file.buffer, mimeType);

    let width: number | null = null;
    let height: number | null = null;
    let thumbnailKey: string | null = null;

    if (IMAGE_MIME.has(mimeType)) {
      try {
        const image = sharp(file.buffer, { animated: false });
        const meta = await image.metadata();
        width = meta.width ?? null;
        height = meta.height ?? null;

        // Miniatura para não servir a imagem cheia só para o preview do chat.
        const thumb = await image
          .resize(THUMBNAIL_MAX, THUMBNAIL_MAX, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 80 })
          .toBuffer();
        thumbnailKey = `${scope}/${id}_thumb`;
        await this.storage.put(thumbnailKey, thumb, 'image/webp');
      } catch (err) {
        this.logger.warn(`Sem miniatura para ${storageKey}: ${(err as Error).message}`);
      }
    }

    return {
      storageKey,
      thumbnailKey,
      fileName: sanitizeFileName(file.originalname),
      mimeType,
      size: file.size,
      width,
      height,
    };
  }

  async read(key: string): Promise<Buffer> {
    return this.storage.get(key);
  }

  /** Remoção idempotente — usada pela expiração de DM. */
  async remove(keys: (string | null | undefined)[]): Promise<void> {
    await Promise.all(keys.filter((k): k is string => !!k).map((k) => this.storage.delete(k)));
  }
}

export function sanitizeFileName(name: string): string {
  return (name || 'arquivo')
    .replace(/[\r\n\t]/g, '')
    .replace(/[/\\]/g, '_')
    .slice(0, 180);
}
