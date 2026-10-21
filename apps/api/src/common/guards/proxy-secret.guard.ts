import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { env } from '../../config/env';
import { Errors } from '../errors';

export const PROXY_SECRET_HEADER = 'x-internal-proxy-secret';

/**
 * The API listens on 127.0.0.1 and only serves requests that came through the web app's
 * /api proxy, which adds this secret. That also makes X-Forwarded-For trustworthy: only
 * the proxy can set it.
 */
@Injectable()
export class ProxySecretGuard implements CanActivate {
  private readonly expected = Buffer.from(env().PROXY_SECRET, 'utf8');

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const got = Buffer.from(String(req.headers[PROXY_SECRET_HEADER] ?? ''), 'utf8');
    if (got.length !== this.expected.length || !timingSafeEqual(got, this.expected)) {
      throw Errors.forbidden('Requests must go through the web app.');
    }
    return true;
  }
}
