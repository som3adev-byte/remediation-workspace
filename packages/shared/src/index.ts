import { z } from 'zod';

// ---------------------------------------------------------------------------
// Domain constants shared by the API (enforcement) and the web app (display).
// The API is the only authority; the web app uses these only to decide which
// buttons to show. Hiding a button is never the security control.
// ---------------------------------------------------------------------------

export const ROLES = ['MANAGER', 'MEMBER'] as const;
export type Role = (typeof ROLES)[number];

export const STATUSES = ['OPEN', 'IN_PROGRESS', 'PENDING_REVIEW', 'CLOSED'] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  PENDING_REVIEW: 'Pending review',
  CLOSED: 'Closed',
};

/** Managers may edit or reassign only while an item is in one of these states. */
export const EDITABLE_STATUSES: readonly Status[] = ['OPEN', 'IN_PROGRESS'];

export const LIMITS = {
  title: 200,
  description: 5000,
  completionNote: 2000,
  reason: 2000,
  pageSizeMax: 50,
  pageSizeDefault: 20,
  activityMax: 100,
} as const;

// ---------------------------------------------------------------------------
// Workflow
//
//   OPEN --start(assignee)--> IN_PROGRESS --submit(assignee, note)--> PENDING_REVIEW
//   PENDING_REVIEW --approve(manager != assignee)--> CLOSED
//   PENDING_REVIEW --request_changes(manager != assignee, reason)--> IN_PROGRESS
//
// Any other (status, action) pair is an invalid transition (409).
// ---------------------------------------------------------------------------

export const TRANSITION_ACTIONS = ['start', 'submit', 'approve', 'request_changes'] as const;
export type TransitionAction = (typeof TRANSITION_ACTIONS)[number];

/** Who may perform a transition: the current assignee, or a manager who is not the assignee. */
export type TransitionActor = 'ASSIGNEE' | 'REVIEWER';

export interface Transition {
  from: Status;
  to: Status;
  actor: TransitionActor;
}

export const TRANSITIONS: Record<TransitionAction, Transition> = {
  start: { from: 'OPEN', to: 'IN_PROGRESS', actor: 'ASSIGNEE' },
  submit: { from: 'IN_PROGRESS', to: 'PENDING_REVIEW', actor: 'ASSIGNEE' },
  approve: { from: 'PENDING_REVIEW', to: 'CLOSED', actor: 'REVIEWER' },
  request_changes: { from: 'PENDING_REVIEW', to: 'IN_PROGRESS', actor: 'REVIEWER' },
};

export interface ActorRef {
  userId: string;
  role: Role;
}

export interface ItemRef {
  status: Status;
  assigneeId: string;
}

/** True when this actor may perform this action on this item right now. Mirrors the API's guards. */
export function canTransition(action: TransitionAction, item: ItemRef, actor: ActorRef): boolean {
  const t = TRANSITIONS[action];
  if (item.status !== t.from) return false;
  if (t.actor === 'ASSIGNEE') return item.assigneeId === actor.userId;
  return actor.role === 'MANAGER' && item.assigneeId !== actor.userId;
}

export function availableTransitions(item: ItemRef, actor: ActorRef): TransitionAction[] {
  return TRANSITION_ACTIONS.filter((a) => canTransition(a, item, actor));
}

export function canEdit(item: ItemRef, actor: ActorRef): boolean {
  return actor.role === 'MANAGER' && EDITABLE_STATUSES.includes(item.status);
}

/** Display reference for an item, e.g. 142 -> "RW-0142". */
export function formatRef(ref: number): string {
  return `RW-${String(ref).padStart(4, '0')}`;
}

// ---------------------------------------------------------------------------
// Request schemas. All object schemas are .strict(): unknown fields such as
// orgId, status, version (where not expected), actorId or audit data are rejected.
// ---------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar date "YYYY-MM-DD" that exists (rejects 2026-02-30). */
export const calendarDate = z
  .string()
  .regex(ISO_DATE, 'Use the format YYYY-MM-DD.')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Enter a real calendar date.');

const trimmed = (max: number, label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be ${max.toLocaleString('en-US')} characters or fewer.`);

const uuid = z.string().uuid('Invalid id.');

export const loginSchema = z
  .object({
    email: z.string().trim().toLowerCase().email('Enter a valid email.').max(254),
    password: z.string().min(1, 'Password is required.').max(256),
  })
  .strict();
export type LoginInput = z.infer<typeof loginSchema>;

export const createItemSchema = z
  .object({
    title: trimmed(LIMITS.title, 'Title'),
    description: trimmed(LIMITS.description, 'Description'),
    assigneeId: uuid,
    dueDate: calendarDate,
  })
  .strict();
export type CreateItemInput = z.infer<typeof createItemSchema>;

/** Edit and reassign. `version` is the version the client rendered (optimistic concurrency). */
export const updateItemSchema = z
  .object({
    version: z.number().int().positive(),
    title: trimmed(LIMITS.title, 'Title').optional(),
    description: trimmed(LIMITS.description, 'Description').optional(),
    assigneeId: uuid.optional(),
    dueDate: calendarDate.optional(),
  })
  .strict()
  .refine(
    (v) => v.title !== undefined || v.description !== undefined || v.assigneeId !== undefined || v.dueDate !== undefined,
    'Change at least one field.',
  );
export type UpdateItemInput = z.infer<typeof updateItemSchema>;

export const startSchema = z.object({ version: z.number().int().positive() }).strict();
export const submitSchema = z
  .object({ version: z.number().int().positive(), completionNote: trimmed(LIMITS.completionNote, 'Completion note') })
  .strict();
export const approveSchema = z.object({ version: z.number().int().positive() }).strict();
export const requestChangesSchema = z
  .object({ version: z.number().int().positive(), reason: trimmed(LIMITS.reason, 'Reason') })
  .strict();

export const TRANSITION_SCHEMAS = {
  start: startSchema,
  submit: submitSchema,
  approve: approveSchema,
  request_changes: requestChangesSchema,
} as const;

export const listQuerySchema = z
  .object({
    status: z.enum(STATUSES).optional(),
    overdue: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => v === 'true'),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(LIMITS.pageSizeMax).default(LIMITS.pageSizeDefault),
  })
  .strict();
export type ListQuery = z.infer<typeof listQuerySchema>;

// ---------------------------------------------------------------------------
// API error codes (stable strings the web app switches on)
// ---------------------------------------------------------------------------

export const ERROR_CODES = [
  'validation_failed',
  'invalid_credentials',
  'session_expired',
  'unauthenticated',
  'forbidden',
  'origin_rejected',
  'not_found',
  'conflict',
  'invalid_transition',
  'invalid_assignee',
  'rate_limited',
  'service_unavailable',
  'internal_error',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiError {
  code: ErrorCode;
  message: string;
  requestId?: string;
  fields?: Record<string, string>;
}
