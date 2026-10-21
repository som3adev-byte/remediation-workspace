import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { env } from '../../config/env';
import { Errors } from '../errors';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defense in depth. The session cookie is SameSite=Strict, so other sites cannot
 * send it; on top of that every state-changing request (login included) must carry an
 * Origin header equal to the web app's origin. Missing or foreign Origin -> 403.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly allowed = new URL(env().WEB_ORIGIN).origin;

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (SAFE.has(req.method)) return true;
    if (req.headers.origin !== this.allowed) throw Errors.originRejected();
    return true;
  }
}
