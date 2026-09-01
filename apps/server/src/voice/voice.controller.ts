import { Body, Controller, Get, Headers, Param, Post, RawBodyRequest, Req } from '@nestjs/common';
import { WebhookReceiver } from 'livekit-server-sdk';
import { Request } from 'express';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Public } from '../common/public.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/current-user.decorator';
import { AppConfig, CONFIG } from '../config/configuration';
import { Inject } from '@nestjs/common';
import { VoiceService } from './voice.service';

const selfStateSchema = z.object({
  selfMuted: z.boolean().optional(),
  selfDeafened: z.boolean().optional(),
  streaming: z.boolean().optional(),
});

const moderateSchema = z.object({
  action: z.enum(['mute', 'unmute', 'deafen', 'undeafen', 'disconnect']),
});

@Controller('voice')
export class VoiceController {
  private readonly receiver: WebhookReceiver | null;

  constructor(
    private readonly voice: VoiceService,
    @Inject(CONFIG) config: AppConfig,
  ) {
    this.receiver =
      config.LIVEKIT_API_KEY && config.LIVEKIT_API_SECRET
        ? new WebhookReceiver(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET)
        : null;
  }

  @Get('status')
  status() {
    return { configured: this.voice.configured };
  }

  /** Token de entrada num canal de voz, com os grants derivados das permissões. */
  @Post('channels/:channelId/token')
  channelToken(@CurrentUser() user: AuthenticatedUser, @Param('channelId') channelId: string) {
    return this.voice.issueChannelToken(channelId, user.id);
  }

  @Post('calls/:conversationId/token')
  callToken(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
  ) {
    return this.voice.issueCallToken(conversationId, user.id);
  }

  @Post('channels/:channelId/join')
  join(@CurrentUser() user: AuthenticatedUser, @Param('channelId') channelId: string) {
    return this.voice.join(channelId, user.id);
  }

  @Post('channels/:channelId/leave')
  async leave(@CurrentUser() user: AuthenticatedUser, @Param('channelId') channelId: string) {
    await this.voice.leave(channelId, user.id);
    return { ok: true };
  }

  @Get('channels/:channelId')
  participants(@Param('channelId') channelId: string) {
    return this.voice.participants(channelId);
  }

  @Get('servers/:serverId')
  serverState(@Param('serverId') serverId: string) {
    return this.voice.serverVoiceState(serverId);
  }

  @Post('state')
  async updateState(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(selfStateSchema)) body: z.infer<typeof selfStateSchema>,
  ) {
    await this.voice.updateSelfState(user.id, body);
    return { ok: true };
  }

  @Post('members/:userId/moderate')
  async moderate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId') targetId: string,
    @Body(new ZodValidationPipe(moderateSchema)) body: z.infer<typeof moderateSchema>,
  ) {
    await this.voice.moderate(user.id, targetId, body.action);
    return { ok: true };
  }

  /**
   * Webhook do LiveKit. É como descobrimos que alguém caiu sem avisar — o app
   * travou, o PC desligou — e limpamos o estado em vez de deixar a pessoa
   * marcada como conectada para sempre.
   *
   * Público porque quem chama é o LiveKit, não um usuário: a autenticidade vem
   * da assinatura do corpo, verificada com a nossa API secret.
   */
  @Public()
  @Post('webhook')
  async webhook(@Req() req: RawBodyRequest<Request>, @Headers('authorization') auth?: string) {
    if (!this.receiver || !auth) return { ok: true };

    const body = req.rawBody?.toString('utf8') ?? '';
    let event;
    try {
      event = await this.receiver.receive(body, auth);
    } catch {
      // Assinatura inválida: descartamos em silêncio, sem revelar nada.
      return { ok: true };
    }

    if (event.event === 'participant_left' && event.room?.name && event.participant?.identity) {
      await this.voice.handleParticipantLeft(event.room.name, event.participant.identity);
    }
    return { ok: true };
  }
}
