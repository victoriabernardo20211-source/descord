import { Body, Controller, Delete, Get, Param, Post, Req, UsePipes } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { z } from 'zod';
import { loginSchema, passwordSchema, registerSchema } from '@nexus/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Public } from '../common/public.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/current-user.decorator';
import { AuthService } from './auth.service';

const refreshSchema = z.object({ refreshToken: z.string().min(1) });
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

function device(req: Request) {
  return {
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    deviceName: (req.headers['x-device-name'] as string | undefined) ?? undefined,
  };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  @UsePipes(new ZodValidationPipe(registerSchema))
  register(@Body() body: z.infer<typeof registerSchema>, @Req() req: Request) {
    return this.auth.register(body, device(req));
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @UsePipes(new ZodValidationPipe(loginSchema))
  login(@Body() body: z.infer<typeof loginSchema>, @Req() req: Request) {
    return this.auth.login(body, device(req));
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @UsePipes(new ZodValidationPipe(refreshSchema))
  refresh(@Body() body: z.infer<typeof refreshSchema>, @Req() req: Request) {
    return this.auth.refresh(body.refreshToken, device(req));
  }

  @Post('logout')
  async logout(@CurrentUser() user: AuthenticatedUser) {
    await this.auth.logout(user.sessionId);
    return { ok: true };
  }

  @Get('sessions')
  sessions(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.listSessions(user.id, user.sessionId);
  }

  @Delete('sessions/:id')
  async revoke(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.auth.revokeSession(user.id, id);
    return { ok: true };
  }

  @Post('password')
  @UsePipes(new ZodValidationPipe(changePasswordSchema))
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: z.infer<typeof changePasswordSchema>,
  ) {
    await this.auth.changePassword(user.id, body.currentPassword, body.newPassword);
    return { ok: true };
  }
}
