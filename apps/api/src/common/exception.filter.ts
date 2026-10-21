import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ApiError } from '@rw/shared';
import type { Request, Response } from 'express';
import { AppError } from './errors';
import { logger } from './logger';

/**
 * One place that turns any thrown error into { code, message, requestId[, fields] }.
 * Stack traces, SQL and internal messages are logged with the request id, never sent.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(err: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const requestId = req.requestId;
    const [status, body] = this.toResponse(err);
    if (status >= 500) {
      logger.error({ requestId, err: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err });
    }
    res.status(status).json({ ...body, requestId });
  }

  private toResponse(err: unknown): [number, Omit<ApiError, 'requestId'>] {
    if (err instanceof AppError) {
      return [err.status, { code: err.code, message: err.message, ...(err.fields && { fields: err.fields }) }];
    }
    // Database unreachable or an interactive transaction timed out: retryable, say so.
    if (
      err instanceof Prisma.PrismaClientInitializationError ||
      (err instanceof Prisma.PrismaClientKnownRequestError && ['P1001', 'P1002', 'P1017', 'P2024', 'P2028'].includes(err.code))
    ) {
      return [503, { code: 'service_unavailable', message: 'The service is temporarily unavailable. Try again.' }];
    }
    // express.json() rejects oversized bodies before Nest sees them; its error is not an HttpException.
    if (typeof err === 'object' && err !== null && (err as { type?: unknown }).type === 'entity.too.large') {
      return [413, { code: 'validation_failed', message: 'Request body too large.' }];
    }
    if (err instanceof HttpException) {
      const status = err.getStatus();
      if (status === 404) return [404, { code: 'not_found', message: 'Not found.' }];
      if (status === 413) return [413, { code: 'validation_failed', message: 'Request body too large.' }];
      if (status === 400) return [400, { code: 'validation_failed', message: 'Malformed request.' }];
      if (status < 500) return [status, { code: 'forbidden', message: 'Request not allowed.' }];
    }
    return [500, { code: 'internal_error', message: 'Something went wrong. Try again.' }];
  }
}
