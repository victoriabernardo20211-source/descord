import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { usernameSchema } from '@nexus/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthenticatedUser, CurrentUser } from '../common/current-user.decorator';
import { FriendsService } from './friends.service';

const requestSchema = z.object({ username: usernameSchema });

@Controller('friends')
export class FriendsController {
  constructor(private readonly friends: FriendsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.friends.list(user.id);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('requests')
  request(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(requestSchema)) body: z.infer<typeof requestSchema>,
  ) {
    return this.friends.request(user.id, body.username);
  }

  @Post('requests/:id/accept')
  async accept(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.friends.accept(user.id, id);
    return { ok: true };
  }

  @Post('requests/:id/reject')
  async reject(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.friends.reject(user.id, id);
    return { ok: true };
  }

  @Delete('requests/:id')
  async cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.friends.cancel(user.id, id);
    return { ok: true };
  }

  @Delete(':userId')
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('userId') targetId: string) {
    await this.friends.remove(user.id, targetId);
    return { ok: true };
  }

  @Post('blocks/:userId')
  async block(@CurrentUser() user: AuthenticatedUser, @Param('userId') targetId: string) {
    await this.friends.block(user.id, targetId);
    return { ok: true };
  }

  @Delete('blocks/:userId')
  async unblock(@CurrentUser() user: AuthenticatedUser, @Param('userId') targetId: string) {
    await this.friends.unblock(user.id, targetId);
    return { ok: true };
  }
}
