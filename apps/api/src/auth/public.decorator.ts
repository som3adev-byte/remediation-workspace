import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';
/** Skips AuthGuard (login, logout). ProxySecretGuard and OriginGuard still apply. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
