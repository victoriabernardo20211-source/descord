export interface StoredObject {
  key: string;
  size: number;
}

/**
 * Abstração de armazenamento. Nada no sistema fala com o filesystem diretamente,
 * então trocar para S3/R2/MinIO é só registrar outro provider.
 */
export abstract class StorageProvider {
  abstract put(key: string, data: Buffer, mimeType: string): Promise<StoredObject>;
  abstract get(key: string): Promise<Buffer>;
  abstract delete(key: string): Promise<void>;
  abstract exists(key: string): Promise<boolean>;
}
