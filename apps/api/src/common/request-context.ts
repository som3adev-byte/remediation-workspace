import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@rw/shared';
import { logger } from './logger';

export interface Actor {
  userId: string;
  orgId: string;
  role: Role;
  sessionId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      actor?: Actor;
    }
  }
}

/**
 * Gives every request an id (echoed in X-Request-Id and in every error body) and writes
 * one access-log line when the response finishes: method, path, status, duration and the
 * actor's ids. Never the body, cookies or headers.
 */
export function requestContext(req: Request, res: Response, next: NextFunction) {
  req.requestId = `req_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  res.setHeader('X-Request-Id', req.requestId);
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    logger.info({
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Number(process.hrtime.bigint() - start) / 1e6,
      userId: req.actor?.userId,
      orgId: req.actor?.orgId,
    });
  });
  next();
}
