import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { createMessageSchema, updateMessageSchema } from '@nexus/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthenticatedUser, CurrentUser } from '../common/current-user.decorator';
import { DirectMessagesService } from './direct-messages.service';

const openSchema = z.object({ userIds: z.array(z.string()).min(1).max(9) });

@Controller('dm')
export class DirectMessagesController {
  constructor(private readonly dms: DirectMessagesService) {}

  @Get('conversations')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.dms.listConversations(user.id);
  }

  @Post('conversations')
  open(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(openSchema)) body: z.infer<typeof openSchema>,
  ) {
    return this.dms.openConversation(user.id, body.userIds);
  }

  @Get('conversations/:id/messages')
  messages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    return this.dms.listMessages(id, user.id, {
      before,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Throttle({ default: { limit: 30, ttl: 10_000 } })
  @Post('conversations/:id/messages')
  send(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createMessageSchema)) body: z.infer<typeof createMessageSchema>,
  ) {
    return this.dms.send(id, user.id, body);
  }

  @Patch('messages/:id')
  edit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateMessageSchema)) body: z.infer<typeof updateMessageSchema>,
  ) {
    return this.dms.edit(id, user.id, body.content);
  }

  @Delete('messages/:id')
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.dms.remove(id, user.id);
    return { ok: true };
  }
}
