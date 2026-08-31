import { Global, Module } from '@nestjs/common';
import { EventsService } from './events.service';
import { RealtimeGateway } from './realtime.gateway';

@Global()
@Module({ providers: [EventsService, RealtimeGateway], exports: [EventsService] })
export class RealtimeModule {}
