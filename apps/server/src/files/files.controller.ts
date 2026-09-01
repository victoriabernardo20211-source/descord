import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { AuthenticatedUser, CurrentUser } from '../common/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsService } from '../permissions/permissions.service';
import { Permission, has } from '@nexus/shared';
import { FilesService } from './files.service';
import { PendingUploadService } from './pending-upload.service';

@Controller('files')
export class FilesController {
  constructor(
    private readonly files: FilesService,
    private readonly pending: PendingUploadService,
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException({ code: 'NO_FILE', message: 'Nenhum arquivo enviado.' });
    const prepared = await this.files.store(file, `uploads/${user.id}`);
    const id = await this.pending.create(user.id, prepared);
    return {
      id,
      fileName: prepared.fileName,
      mimeType: prepared.mimeType,
      size: prepared.size,
      width: prepared.width,
      height: prepared.height,
    };
  }

  /**
   * Upload de anexo de conversa privada. O arquivo chega cifrado pelo
   * dispositivo; o servidor guarda bytes opacos e nunca sabe o que são.
   */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('upload/encrypted')
  @UseInterceptors(FileInterceptor('file'))
  async uploadEncrypted(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException({ code: 'NO_FILE', message: 'Nenhum arquivo enviado.' });
    const prepared = await this.files.storeEncrypted(file, `uploads/${user.id}`);
    const id = await this.pending.create(user.id, prepared);
    return { id, size: prepared.size, encrypted: true };
  }

  /** Anexo de canal: exige VIEW_CHANNEL + READ_MESSAGE_HISTORY no canal. */
  @Get('channel/:attachmentId')
  async channelAttachment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('attachmentId') attachmentId: string,
    @Query('thumb') thumb: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const attachment = await this.prisma.messageAttachment.findUnique({
      where: { id: attachmentId },
      include: { message: { select: { channelId: true } } },
    });
    if (!attachment) throw this.notFound();

    const bits = await this.permissions.resolveChannel(attachment.message.channelId, user.id);
    if (!has(bits, Permission.VIEW_CHANNEL) || !has(bits, Permission.READ_MESSAGE_HISTORY)) {
      throw this.notFound();
    }
    await this.send(res, attachment, thumb === '1');
  }

  /**
   * Anexo de DM. Além de exigir participação na conversa, confere expiresAt:
   * anexo de mensagem vencida nunca é servido, mesmo que o job ainda não tenha
   * apagado o arquivo.
   */
  @Get('dm/:attachmentId')
  async dmAttachment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('attachmentId') attachmentId: string,
    @Query('thumb') thumb: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const attachment = await this.prisma.directMessageAttachment.findUnique({
      where: { id: attachmentId },
      include: { message: { select: { conversationId: true, expiresAt: true } } },
    });
    if (!attachment) throw this.notFound();
    if (attachment.message.expiresAt <= new Date()) throw this.notFound();

    const participant = await this.prisma.directConversationParticipant.findUnique({
      where: {
        conversationId_userId: {
          conversationId: attachment.message.conversationId,
          userId: user.id,
        },
      },
      select: { id: true },
    });
    if (!participant) throw this.notFound();

    await this.send(res, attachment, thumb === '1');
  }

  private async send(
    res: Response,
    attachment: { storageKey: string; thumbnailKey: string | null; mimeType: string; fileName: string },
    wantThumb: boolean,
  ): Promise<void> {
    const useThumb = wantThumb && attachment.thumbnailKey;
    const key = useThumb ? (attachment.thumbnailKey as string) : attachment.storageKey;
    let data: Buffer;
    try {
      data = await this.files.read(key);
    } catch {
      throw this.notFound();
    }
    res.setHeader('Content-Type', useThumb ? 'image/webp' : attachment.mimeType);
    // Nunca renderiza HTML/SVG inline vindo de upload.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.fileName)}"`);
    // Privado: proxies e caches compartilhados não podem guardar isso.
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(data);
  }

  private notFound(): NotFoundException {
    return new NotFoundException({ code: 'NOT_FOUND', message: 'Arquivo não encontrado.' });
  }
}
