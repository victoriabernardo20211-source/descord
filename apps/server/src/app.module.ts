import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { StorageModule } from './storage/storage.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './auth/auth.guard';
import { PermissionsModule } from './permissions/permissions.module';
import { AuditModule } from './audit/audit.module';
import { RealtimeModule } from './realtime/realtime.module';
import { PresenceModule } from './presence/presence.module';
import { UsersModule } from './users/users.module';
import { FriendsModule } from './friends/friends.module';
import { ServersModule } from './servers/servers.module';
import { ChannelsModule } from './channels/channels.module';
import { MessagesModule } from './messages/messages.module';
import { DirectMessagesModule } from './direct-messages/direct-messages.module';
import { E2eeModule } from './e2ee/e2ee.module';
import { VoiceModule } from './voice/voice.module';
import { FilesModule } from './files/files.module';
import { NotificationsModule } from './notifications/notifications.module';
import { HealthModule } from './health/health.module';
import { AllExceptionsFilter } from './common/http-exception.filter';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    RedisModule,
    StorageModule,
    ScheduleModule.forRoot(),
    // Limites generosos, mas suficientes para conter spam e loops acidentais.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    AuthModule,
    PermissionsModule,
    AuditModule,
    PresenceModule,
    RealtimeModule,
    UsersModule,
    FriendsModule,
    ServersModule,
    ChannelsModule,
    FilesModule,
    NotificationsModule,
    MessagesModule,
    DirectMessagesModule,
    E2eeModule,
    VoiceModule,
    HealthModule,
  ],
  providers: [
    // Autenticação é padrão: uma rota só é aberta com @Public().
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
