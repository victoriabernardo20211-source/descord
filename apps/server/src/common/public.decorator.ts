import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'nexus:isPublic';
/** Marca uma rota como acessível sem access token. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
