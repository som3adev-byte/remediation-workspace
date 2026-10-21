import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { Actor } from '../common/request-context';

/** The authenticated user as loaded from the database by AuthGuard. */
export const CurrentActor = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor => {
  const actor = ctx.switchToHttp().getRequest<Request>().actor;
  if (!actor) throw new Error('CurrentActor used on a public route');
  return actor;
});
