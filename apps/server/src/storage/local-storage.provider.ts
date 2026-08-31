import { Inject, Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { AppConfig, CONFIG } from '../config/configuration';
import { StorageProvider, StoredObject } from './storage.provider';

@Injectable()
export class LocalStorageProvider extends StorageProvider {
  private readonly logger = new Logger(LocalStorageProvider.name);
  private readonly root: string;

  constructor(@Inject(CONFIG) config: AppConfig) {
    super();
    this.root = resolve(config.STORAGE_PATH);
  }

  /** Impede path traversal: nenhuma chave pode escapar do diretório raiz. */
  private pathFor(key: string): string {
    const full = resolve(join(this.root, normalize(key)));
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new Error(`Chave de storage inválida: ${key}`);
    }
    return full;
  }

  async put(key: string, data: Buffer): Promise<StoredObject> {
    const path = this.pathFor(key);
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, data);
    return { key, size: data.byteLength };
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.pathFor(key));
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.pathFor(key));
    } catch (err) {
      // Apagar algo que já não existe não é erro — a expiração precisa ser idempotente.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn(`Falha ao remover ${key}: ${(err as Error).message}`);
      }
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.pathFor(key));
      return true;
    } catch {
      return false;
    }
  }
}
