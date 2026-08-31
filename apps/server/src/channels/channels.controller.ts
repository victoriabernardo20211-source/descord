import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { createCategorySchema, createChannelSchema } from '@nexus/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthenticatedUser, CurrentUser } from '../common/current-user.decorator';
import { ChannelsService } from './channels.service';

const updateChannelSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  topic: z.string().max(512).nullish(),
  categoryId: z.string().nullish(),
  position: z.number().int().min(0).optional(),
});
const overrideSchema = z.object({
  roleId: z.string().optional(),
  userId: z.string().optional(),
  allow: z.string().regex(/^\d+$/).default('0'),
  deny: z.string().regex(/^\d+$/).default('0'),
});

@Controller()
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  @Post('servers/:serverId/categories')
  createCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('serverId') serverId: string,
    @Body(new ZodValidationPipe(createCategorySchema)) body: z.infer<typeof createCategorySchema>,
  ) {
    return this.channels.createCategory(serverId, user.id, body.name);
  }

  @Post('servers/:serverId/channels')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('serverId') serverId: string,
    @Body(new ZodValidationPipe(createChannelSchema)) body: z.infer<typeof createChannelSchema>,
  ) {
    return this.channels.create(serverId, user.id, body);
  }

  @Patch('channels/:id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateChannelSchema)) body: z.infer<typeof updateChannelSchema>,
  ) {
    return this.channels.update(id, user.id, body);
  }

  @Delete('channels/:id')
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.channels.remove(id, user.id);
    return { ok: true };
  }

  @Get('channels/:id/permissions')
  overrides(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.channels.listOverrides(id, user.id);
  }

  @Post('channels/:id/permissions')
  async setOverride(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(overrideSchema)) body: z.infer<typeof overrideSchema>,
  ) {
    await this.channels.setOverride(
      id,
      user.id,
      { roleId: body.roleId, userId: body.userId },
      BigInt(body.allow),
      BigInt(body.deny),
    );
    return { ok: true };
  }
}
