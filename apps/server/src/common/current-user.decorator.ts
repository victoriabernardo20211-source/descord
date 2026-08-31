import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthenticatedUser {
  id: string;
  username: string;
  sessionId: string;
  isGlobalAdmin: boolean;
}

/**
 * Identidade SEMPRE derivada do token validado pelo guard.
 * Nenhum endpoint aceita userId vindo do corpo da requisição.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    return ctx.switchToHttp().getRequest().user as AuthenticatedUser;
  },
);
