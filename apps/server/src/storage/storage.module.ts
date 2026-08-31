import { Global, Module } from '@nestjs/common';
import { LocalStorageProvider } from './local-storage.provider';
import { StorageProvider } from './storage.provider';

/**
 * Hoje só o driver local está implementado. Para S3/R2/MinIO basta criar
 * S3StorageProvider e escolher pelo STORAGE_DRIVER aqui.
 */
@Global()
@Module({
  providers: [{ provide: StorageProvider, useClass: LocalStorageProvider }],
  exports: [StorageProvider],
})
export class StorageModule {}
