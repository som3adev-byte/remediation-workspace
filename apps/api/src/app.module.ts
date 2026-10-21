import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { AllExceptionsFilter } from './common/exception.filter';
import { OriginGuard } from './common/guards/origin.guard';
import { ProxySecretGuard } from './common/guards/proxy-secret.guard';
import { DbModule } from './db/db.module';

/**
 * Guards run in this order on every request:
 *   1. ProxySecretGuard: the request came through the web app's /api proxy
 *   2. OriginGuard:      state-changing requests come from the web app's origin
 *   3. AuthGuard:        valid JWT + live session + active user (unless @Public)
 */
@Module({
  imports: [DbModule, AuthModule],
  providers: [
    { provide: APP_GUARD, useClass: ProxySecretGuard },
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
