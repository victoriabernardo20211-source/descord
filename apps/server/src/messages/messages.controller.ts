import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { createMessageSchema, updateMessageSchema } from '@nexus/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthenticatedUser, CurrentUser } from '../common/current-user.decorator';
import { MessagesService } from './messages.service';

const readSchema = z.object({ messageId: z.string() });

@Controller()
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get('channels/:id/messages')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    return this.messages.list(id, user.id, { before, limit: limit ? Number(limit) : undefined });
  }

  @Throttle({ default: { limit: 30, ttl: 10_000 } })
  @Post('channels/:id/messages')
  send(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createMessageSchema)) body: z.infer<typeof createMessageSchema>,
  ) {
    return this.messages.send(id, user.id, body);
  }

  @Patch('messages/:id')
  edit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateMessageSchema)) body: z.infer<typeof updateMessageSchema>,
  ) {
    return this.messages.edit(id, user.id, body.content);
  }

  @Delete('messages/:id')
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.messages.remove(id, user.id);
    return { ok: true };
  }

  @Put('messages/:id/reactions/:emoji')
  async addReaction(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('emoji') emoji: string,
  ) {
    await this.messages.react(id, user.id, decodeURIComponent(emoji), true);
    return { ok: true };
  }

  @Delete('messages/:id/reactions/:emoji')
  async removeReaction(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('emoji') emoji: string,
  ) {
    await this.messages.react(id, user.id, decodeURIComponent(emoji), false);
    return { ok: true };
  }

  @Put('messages/:id/pin')
  async pin(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.messages.setPin(id, user.id, true);
    return { ok: true };
  }

  @Delete('messages/:id/pin')
  async unpin(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.messages.setPin(id, user.id, false);
    return { ok: true };
  }

  @Get('channels/:id/pins')
  pins(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.messages.listPins(id, user.id);
  }

  @Post('channels/:id/read')
  async markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(readSchema)) body: z.infer<typeof readSchema>,
  ) {
    await this.messages.markRead(id, user.id, body.messageId);
    return { ok: true };
  }

  @Get('servers/:id/search')
  search(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query('q') q = '',
    @Query('from') from?: string,
    @Query('in') channelId?: string,
    @Query('has') hasFilter?: string,
  ) {
    return this.messages.search(id, user.id, q, {
      authorId: from,
      channelId,
      hasFile: hasFilter === 'file' || hasFilter === 'image',
    });
  }
}
