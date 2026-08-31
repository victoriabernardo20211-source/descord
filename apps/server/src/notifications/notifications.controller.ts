import { Controller, Get, Post } from '@nestjs/common';
import { AuthenticatedUser, CurrentUser } from '../common/current-user.decorator';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.list(user.id);
  }

  @Get('unread')
  unread(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.unreadState(user.id);
  }

  @Post('read')
  async markAllRead(@CurrentUser() user: AuthenticatedUser) {
    await this.notifications.markAllRead(user.id);
    return { ok: true };
  }
}
