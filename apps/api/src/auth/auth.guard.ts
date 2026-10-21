import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { AppError } from '../common/errors';
import { AUTH } from '../config/env';
import { AuthService } from './auth.service';
import { clearSessionCookie, setSessionCookie } from './cookies';
import { IS_PUBLIC } from './public.decorator';

/** Global: every route needs a valid session unless marked @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();
    try {
      const { actor, reissuedToken } = await this.auth.authenticate(req.cookies?.[AUTH.cookieName]);
      req.actor = actor;
      if (reissuedToken) setSessionCookie(res, reissuedToken);
      return true;
    } catch (err) {
      // Only a rejected session clears the cookie. A database hiccup (503) must not sign everyone out.
      if (err instanceof AppError && err.status === 401) clearSessionCookie(res);
      throw err;
    }
  }
}
