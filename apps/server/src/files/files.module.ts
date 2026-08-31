import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { PendingUploadService } from './pending-upload.service';

@Module({
  controllers: [FilesController],
  providers: [FilesService, PendingUploadService],
  exports: [FilesService, PendingUploadService],
})
export class FilesModule {}
