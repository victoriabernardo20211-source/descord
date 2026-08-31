import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Permission, createInviteSchema, createServerSchema } from '@nexus/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthenticatedUser, CurrentUser } from '../common/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { PermissionsService } from '../permissions/permissions.service';
import { ServersService } from './servers.service';

const updateServerSchema = z.object({
  name: z.string().min(2).max(64).optional(),
  iconUrl: z.string().url().optional(),
});
const roleSchema = z.object({ name: z.string().min(1).max(48) });
const updateRoleSchema = z.object({
  name: z.string().min(1).max(48).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  permissions: z.string().regex(/^\d+$/).optional(),
});
const banSchema = z.object({ reason: z.string().max(400).optional() });

@Controller('servers')
export class ServersController {
  constructor(
    private readonly servers: ServersService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.servers.listForUser(user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createServerSchema)) body: z.infer<typeof createServerSchema>,
  ) {
    return this.servers.create(user.id, body.name);
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.servers.detail(id, user.id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateServerSchema)) body: z.infer<typeof updateServerSchema>,
  ) {
    return this.servers.update(id, user.id, body);
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.servers.remove(id, user.id);
    return { ok: true };
  }

  @Post(':id/leave')
  async leave(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.servers.leave(id, user.id);
    return { ok: true };
  }

  @Post(':id/owner/:userId')
  async transfer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('userId') targetId: string,
  ) {
    await this.servers.transferOwnership(id, user.id, targetId);
    return { ok: true };
  }

  @Post(':id/invites')
  invite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createInviteSchema)) body: z.infer<typeof createInviteSchema>,
  ) {
    return this.servers.createInvite(id, user.id, body);
  }

  @Post('invites/:code')
  accept(@CurrentUser() user: AuthenticatedUser, @Param('code') code: string) {
    return this.servers.acceptInvite(code, user.id);
  }

  @Delete(':id/members/:userId')
  async kick(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('userId') targetId: string,
  ) {
    await this.servers.kick(id, user.id, targetId);
    return { ok: true };
  }

  @Post(':id/bans/:userId')
  async ban(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('userId') targetId: string,
    @Body(new ZodValidationPipe(banSchema)) body: z.infer<typeof banSchema>,
  ) {
    await this.servers.ban(id, user.id, targetId, body.reason);
    return { ok: true };
  }

  @Delete(':id/bans/:userId')
  async unban(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('userId') targetId: string,
  ) {
    await this.servers.unban(id, user.id, targetId);
    return { ok: true };
  }

  @Post(':id/roles')
  createRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(roleSchema)) body: z.infer<typeof roleSchema>,
  ) {
    return this.servers.createRole(id, user.id, body.name);
  }

  @Patch(':id/roles/:roleId')
  updateRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('roleId') roleId: string,
    @Body(new ZodValidationPipe(updateRoleSchema)) body: z.infer<typeof updateRoleSchema>,
  ) {
    return this.servers.updateRole(id, user.id, roleId, body);
  }

  @Delete(':id/roles/:roleId')
  async deleteRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('roleId') roleId: string,
  ) {
    await this.servers.deleteRole(id, user.id, roleId);
    return { ok: true };
  }

  @Post(':id/members/:userId/roles/:roleId')
  async assignRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('userId') targetId: string,
    @Param('roleId') roleId: string,
  ) {
    await this.servers.assignRole(id, user.id, targetId, roleId, true);
    return { ok: true };
  }

  @Delete(':id/members/:userId/roles/:roleId')
  async unassignRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('userId') targetId: string,
    @Param('roleId') roleId: string,
  ) {
    await this.servers.assignRole(id, user.id, targetId, roleId, false);
    return { ok: true };
  }

  @Get(':id/audit')
  async auditLog(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    await this.permissions.assertServerPermission(id, user.id, Permission.VIEW_AUDIT_LOG);
    return this.audit.list(id, limit ? Number(limit) : undefined);
  }
}
