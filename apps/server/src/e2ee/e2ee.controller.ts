import { Body, Controller, Delete, Get, Headers, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthenticatedUser, CurrentUser } from '../common/current-user.decorator';
import { E2eeService } from './e2ee.service';

const keyString = z.string().min(20).max(200);

const registerDeviceSchema = z.object({
  deviceId: z.string().min(8).max(64),
  identityKey: keyString,
  signingKey: keyString,
  displayName: z.string().max(80).optional(),
  oneTimeKeys: z.record(keyString).optional(),
});

const uploadKeysSchema = z.object({
  deviceId: z.string().min(8).max(64),
  oneTimeKeys: z.record(keyString),
});

const querySchema = z.object({ userIds: z.array(z.string()).min(1).max(50) });

const claimSchema = z.object({
  requests: z
    .array(z.object({ userId: z.string(), deviceId: z.string() }))
    .min(1)
    .max(50),
});

const toDeviceSchema = z.object({
  deviceId: z.string().min(8).max(64),
  messages: z
    .array(
      z.object({
        userId: z.string(),
        deviceId: z.string(),
        // Envelope Olm serializado — opaco para o servidor.
        payload: z.string().min(1).max(64_000),
      }),
    )
    .min(1)
    .max(100),
});

@Controller('e2ee')
export class E2eeController {
  constructor(private readonly e2ee: E2eeService) {}

  @Post('devices')
  register(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(registerDeviceSchema)) body: z.infer<typeof registerDeviceSchema>,
  ) {
    return this.e2ee.registerDevice(user.id, body);
  }

  @Get('devices')
  listDevices(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-device-id') deviceId?: string,
  ) {
    return this.e2ee.listMyDevices(user.id, deviceId);
  }

  @Delete('devices/:deviceId')
  async deleteDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('deviceId') deviceId: string,
  ) {
    await this.e2ee.deleteDevice(user.id, deviceId);
    return { ok: true };
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('keys/upload')
  uploadKeys(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(uploadKeysSchema)) body: z.infer<typeof uploadKeysSchema>,
  ) {
    return this.e2ee.uploadOneTimeKeys(user.id, body.deviceId, body.oneTimeKeys);
  }

  @Post('keys/query')
  queryKeys(@Body(new ZodValidationPipe(querySchema)) body: z.infer<typeof querySchema>) {
    // Chaves públicas de qualquer usuário: é um diretório, como no Signal.
    return this.e2ee.queryKeys(body.userIds);
  }

  @Post('keys/claim')
  claimKeys(@Body(new ZodValidationPipe(claimSchema)) body: z.infer<typeof claimSchema>) {
    return this.e2ee.claimOneTimeKeys(body.requests);
  }

  @Post('to-device')
  sendToDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(toDeviceSchema)) body: z.infer<typeof toDeviceSchema>,
  ) {
    return this.e2ee.sendToDevice(user.id, body.deviceId, body.messages);
  }

  @Get('to-device/:deviceId')
  drain(@CurrentUser() user: AuthenticatedUser, @Param('deviceId') deviceId: string) {
    return this.e2ee.drainToDevice(user.id, deviceId);
  }
}
