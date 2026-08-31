import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthenticatedUser, CurrentUser } from '../common/current-user.decorator';
import { UsersService } from './users.service';

const profileSchema = z.object({
  displayName: z.string().min(1).max(48).optional(),
  bio: z.string().max(300).nullish(),
  avatarUrl: z.string().url().optional(),
  bannerUrl: z.string().url().optional(),
});

const settingsSchema = z.object({
  theme: z.enum(['dark', 'light', 'system']).optional(),
  inputMode: z.enum(['VOICE_ACTIVITY', 'PUSH_TO_TALK']).optional(),
  pushToTalkKey: z.string().max(40).nullish(),
  inputDeviceId: z.string().max(200).nullish(),
  outputDeviceId: z.string().max(200).nullish(),
  inputVolume: z.number().int().min(0).max(200).optional(),
  outputVolume: z.number().int().min(0).max(200).optional(),
  noiseSuppression: z.boolean().optional(),
  echoCancellation: z.boolean().optional(),
  autoGainControl: z.boolean().optional(),
  minimizeToTray: z.boolean().optional(),
  launchOnStartup: z.boolean().optional(),
  notificationSounds: z.boolean().optional(),
  shareActivity: z.boolean().optional(),
});

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.users.me(user.id);
  }

  @Patch('me')
  updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(profileSchema)) body: z.infer<typeof profileSchema>,
  ) {
    return this.users.updateProfile(user.id, body);
  }

  @Patch('me/settings')
  updateSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(settingsSchema)) body: z.infer<typeof settingsSchema>,
  ) {
    return this.users.updateSettings(user.id, body);
  }

  @Get('search')
  search(@Query('q') q = '') {
    return this.users.search(q);
  }

  @Get(':id')
  profile(@Param('id') id: string) {
    return this.users.profile(id);
  }
}
