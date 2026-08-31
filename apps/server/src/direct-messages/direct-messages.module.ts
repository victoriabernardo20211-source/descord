import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { DirectMessagesController } from './direct-messages.controller';
import { DirectMessagesService } from './direct-messages.service';
import { ExpirationService } from './expiration.service';

@Module({
  imports: [FilesModule],
  controllers: [DirectMessagesController],
  providers: [DirectMessagesService, ExpirationService],
  exports: [DirectMessagesService, ExpirationService],
})
export class DirectMessagesModule {}
