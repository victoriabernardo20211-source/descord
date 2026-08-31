import { Injectable } from '@nestjs/common';
import { createId } from '@paralleldrive/cuid2';
import { RedisService } from '../redis/redis.service';
import { FilesService, PreparedUpload } from './files.service';

const PENDING_TTL_MS = 60 * 60 * 1000;
const key = (id: string) => `upload:pending:${id}`;

/**
 * Um arquivo enviado só vira anexo quando a mensagem é criada. Entre um passo e
 * outro os metadados ficam no Redis por 1h; o blob órfão é removido pelo job
 * `purge-pending-upload`.
 */
@Injectable()
export class PendingUploadService {
  constructor(
    private readonly redis: RedisService,
    private readonly files: FilesService,
  ) {}

  async create(userId: string, upload: PreparedUpload): Promise<string> {
    const id = createId();
    await this.redis.client.set(
      key(id),
      JSON.stringify({ userId, upload }),
      'PX',
      PENDING_TTL_MS,
    );
    return id;
  }

  /** Consome os pendentes. Descarta silenciosamente ids de outro usuário. */
  async claim(userId: string, ids: string[]): Promise<PreparedUpload[]> {
    const claimed: PreparedUpload[] = [];
    for (const id of ids) {
      const raw = await this.redis.client.get(key(id));
      if (!raw) continue;
      const parsed = JSON.parse(raw) as { userId: string; upload: PreparedUpload };
      if (parsed.userId !== userId) continue;
      await this.redis.client.del(key(id));
      claimed.push(parsed.upload);
    }
    return claimed;
  }

  async discardIfUnclaimed(id: string): Promise<void> {
    const raw = await this.redis.client.get(key(id));
    if (!raw) return;
    const parsed = JSON.parse(raw) as { upload: PreparedUpload };
    await this.redis.client.del(key(id));
    await this.files.remove([parsed.upload.storageKey, parsed.upload.thumbnailKey]);
  }
}
