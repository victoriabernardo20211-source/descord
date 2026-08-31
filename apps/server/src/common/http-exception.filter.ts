import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

/**
 * Resposta de erro padronizada. O cliente recebe uma mensagem legível;
 * o detalhe técnico fica só no log.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      res.status(status).json(
        typeof body === 'string'
          ? { statusCode: status, message: body }
          : { statusCode: status, ...(body as object) },
      );
      return;
    }

    this.logger.error(
      exception instanceof Error ? exception.stack ?? exception.message : String(exception),
    );
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Ocorreu um erro inesperado no servidor.',
    });
  }
}
