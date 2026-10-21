import type { ErrorCode } from '@rw/shared';

/** The only error type services throw on purpose. The filter turns it into { code, message, requestId }. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const Errors = {
  invalidCredentials: () => new AppError(401, 'invalid_credentials', 'Invalid email or password.'),
  sessionExpired: () => new AppError(401, 'session_expired', 'Your session expired. Sign in again.'),
  unauthenticated: () => new AppError(401, 'unauthenticated', 'Sign in to continue.'),
  forbidden: (message = 'You are not allowed to do that.') => new AppError(403, 'forbidden', message),
  originRejected: () => new AppError(403, 'origin_rejected', 'Request origin not allowed.'),
  notFound: () => new AppError(404, 'not_found', 'This item is not available.'),
  conflict: () =>
    new AppError(409, 'conflict', 'Someone else changed this item. Reload the latest version to continue.'),
  invalidTransition: () => new AppError(409, 'invalid_transition', 'That action is not available in the current status.'),
  invalidAssignee: () =>
    new AppError(422, 'invalid_assignee', 'Choose an active person from your organization.', {
      assigneeId: 'Choose an active person from your organization.',
    }),
  rateLimited: () => new AppError(429, 'rate_limited', 'Too many attempts. Try again later.'),
};
