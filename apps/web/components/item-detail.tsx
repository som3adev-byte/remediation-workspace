'use client';

import { availableTransitions, canEdit, formatRef, LIMITS, STATUS_LABELS, type TransitionAction } from '@rw/shared';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiFailure, notifyItemsChanged } from '@/lib/api';
import { clearDraft, readDraft, saveDraft } from '@/lib/drafts';
import { formatTimestamp } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { ActivityEvent, Item } from '@/lib/types';
import { BackIcon } from './icons';
import { useToast } from './toast';
import { Banner, Button, DueDate, Field, StatusBadge } from './ui';

const SUCCESS: Record<TransitionAction, (ref: string) => string> = {
  start: (r) => `Started. ${r} is now In progress.`,
  submit: (r) => `Submitted. ${r} is now Pending review.`,
  approve: (r) => `Approved. ${r} is now Closed.`,
  request_changes: (r) => `Changes requested. ${r} is back In progress.`,
};

export function ItemDetail({ id }: { id: string }) {
  const { me } = useSession();
  const toast = useToast();
  const query = useSearchParams().toString();
  const back = `/items${query ? `?${query}` : ''}`;

  const [item, setItem] = useState<Item | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[] | null>(null);
  const [loadError, setLoadError] = useState<ApiFailure | null>(null);
  const [actionError, setActionError] = useState<ApiFailure | null>(null);
  const [pending, setPending] = useState<TransitionAction | null>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [reasonOpen, setReasonOpen] = useState(false);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [i, a] = await Promise.all([api<Item>(`/items/${id}`), api<ActivityEvent[]>(`/items/${id}/activity`)]);
      setItem(i);
      setActivity(a);
      // Text typed before a session expiry comes back for the same user.
      const draft = readDraft<{ note: string; reason: string; reasonOpen: boolean }>(me.id, `${id}:review`);
      if (draft) {
        setNote(draft.note);
        setReason(draft.reason);
        setReasonOpen(draft.reasonOpen);
      } else {
        setNote((n) => n || i.completionNote || '');
      }
    } catch (err) {
      setLoadError(err as ApiFailure);
    }
  }, [id, me.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (reasonOpen) reasonRef.current?.focus();
  }, [reasonOpen]);

  async function run(action: TransitionAction) {
    if (!item || pending) return;
    setPending(action);
    setActionError(null);
    const body: Record<string, unknown> = { version: item.version };
    if (action === 'submit') body.completionNote = note;
    if (action === 'request_changes') body.reason = reason;
    try {
      const updated = await api<Item>(`/items/${item.id}/transitions/${action}`, { method: 'POST', body });
      setItem(updated);
      clearDraft(me.id, `${item.id}:review`);
      setReason('');
      setReasonOpen(false);
      toast(SUCCESS[action](formatRef(updated.ref)));
      notifyItemsChanged();
      setActivity(await api<ActivityEvent[]>(`/items/${item.id}/activity`).catch(() => activity));
    } catch (err) {
      const failure = err as ApiFailure;
      // The shell shows "session expired"; keep what was typed for after sign-in.
      if (failure.status === 401) saveDraft(me.id, `${item.id}:review`, { note, reason, reasonOpen });
      setActionError(failure);
    } finally {
      setPending(null);
    }
  }

  if (loadError) {
    return (
      <div className="detail">
        <Link href={back} className="back-link">
          <BackIcon /> Inbox
        </Link>
        {loadError.status === 404 ? (
          <Banner tone="error">This item is not available. It may have been reassigned, or the link is wrong.</Banner>
        ) : (
          <Banner
            tone="error"
            reference={loadError.requestId}
            action={
              <Button variant="secondary" onClick={load}>
                Try again
              </Button>
            }
          >
            Couldn&apos;t load this item. {loadError.message}
          </Banner>
        )}
      </div>
    );
  }

  if (!item) {
    return (
      <div className="detail" aria-busy="true" aria-label="Loading item">
        <span className="skeleton" style={{ width: 72 }} />
        <span className="skeleton skeleton-title" />
        <span className="skeleton" style={{ width: 96 }} />
        <span className="skeleton skeleton-block" />
      </div>
    );
  }

  const actor = { userId: me.id, role: me.role };
  const actions = availableTransitions({ status: item.status, assigneeId: item.assignee.id }, actor);
  const editable = canEdit({ status: item.status, assigneeId: item.assignee.id }, actor);
  const ref = formatRef(item.ref);
  const stale = actionError?.code === 'conflict';

  return (
    <article className="detail" key={item.id}>
      <Link href={back} className="back-link">
        <BackIcon /> Inbox
      </Link>
      <div className="detail-top">
        <span className="mono muted" translate="no">
          {ref}
        </span>
        {editable && (
          <Link href={`/items/${item.id}/edit`} className="btn btn-secondary btn-sm">
            Edit
          </Link>
        )}
      </div>
      <h2 className="detail-title">
        {item.title}
      </h2>
      <StatusBadge status={item.status} />

      <dl className="facts">
        <dt>Assignee</dt>
        <dd>{item.assignee.id === me.id ? `${item.assignee.name} (you)` : item.assignee.name}</dd>
        <dt>Due</dt>
        <dd>
          <DueDate date={item.dueDate} overdue={item.overdue} />
        </dd>
        <dt>Created by</dt>
        <dd>{item.createdBy.name}</dd>
      </dl>

      <section className="detail-section">
        <h3 className="section-title">Description</h3>
        <p className="prose">{item.description}</p>
      </section>

      {item.completionNote && item.status !== 'IN_PROGRESS' && (
        <section className="detail-section">
          <h3 className="section-title">Completion note</h3>
          <p className="prose">{item.completionNote}</p>
        </section>
      )}

      {actionError && (
        <Banner
          tone={stale ? 'warning' : 'error'}
          reference={actionError.status >= 500 ? actionError.requestId : undefined}
          action={
            stale || actionError.code === 'invalid_transition' ? (
              <Button
                variant="secondary"
                onClick={async () => {
                  setActionError(null);
                  await load();
                }}
              >
                Reload latest
              </Button>
            ) : undefined
          }
        >
          {stale ? 'Someone else changed this item. Reload the latest version before acting. Your text is kept.' : actionError.message}
        </Banner>
      )}

      {actions.includes('start') && (
        <section className="detail-section">
          <h3 className="section-title">Start work</h3>
          <p className="muted">Move this item to In progress when you begin.</p>
          <Button onClick={() => run('start')} loading={pending === 'start'} loadingLabel="Starting…">
            Start work
          </Button>
        </section>
      )}

      {actions.includes('submit') && (
        <section className="detail-section">
          <h3 className="section-title">Submit for review</h3>
          <Field label="Completion note (required)" count={{ value: note.length, max: LIMITS.completionNote }}>
            {(p) => (
              <textarea {...p} className="input textarea" rows={4} value={note} onChange={(e) => setNote(e.target.value)} />
            )}
          </Field>
          <Button
            onClick={() => run('submit')}
            loading={pending === 'submit'}
            loadingLabel="Submitting…"
            disabled={!note.trim() || note.length > LIMITS.completionNote}
          >
            Submit for review
          </Button>
        </section>
      )}

      {actions.includes('approve') && (
        <section className="detail-section">
          <h3 className="section-title">Review</h3>
          {!reasonOpen ? (
            <div className="button-row">
              <Button onClick={() => run('approve')} loading={pending === 'approve'} loadingLabel="Approving…">
                Approve
              </Button>
              <Button variant="secondary" onClick={() => setReasonOpen(true)} disabled={pending !== null}>
                Request changes
              </Button>
            </div>
          ) : (
            <div className="stack">
              <Field label="Reason for changes" count={{ value: reason.length, max: LIMITS.reason }}>
                {(p) => (
                  <textarea
                    {...p}
                    ref={reasonRef}
                    className="input textarea"
                    rows={3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        setReasonOpen(false);
                      }
                    }}
                  />
                )}
              </Field>
              <div className="button-row">
                <Button
                  onClick={() => run('request_changes')}
                  loading={pending === 'request_changes'}
                  loadingLabel="Sending…"
                  disabled={!reason.trim() || reason.length > LIMITS.reason}
                >
                  Send
                </Button>
                <Button variant="secondary" onClick={() => setReasonOpen(false)} disabled={pending !== null}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </section>
      )}

      {item.status === 'PENDING_REVIEW' && item.assignee.id === me.id && me.role === 'MANAGER' && (
        <p className="muted">Another manager reviews items assigned to you.</p>
      )}

      <section className="detail-section">
        <h3 className="section-title">Activity</h3>
        {activity && activity.length > 0 ? (
          <ol className="timeline">
            {activity.map((e) => (
              <li key={e.id}>
                <time className="mono" dateTime={e.createdAt}>
                  {formatTimestamp(e.createdAt)}
                </time>
                <div>
                  <p>{describe(e)}</p>
                  {detailOf(e) && <p className="timeline-detail">{detailOf(e)}</p>}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">No activity yet.</p>
        )}
      </section>
    </article>
  );
}

const FIELD_NAMES: Record<string, string> = { title: 'title', description: 'description', dueDate: 'due date' };

function describe(e: ActivityEvent): string {
  const who = e.actor.name;
  switch (e.action) {
    case 'CREATED':
      return `${who} created the item`;
    case 'EDITED': {
      const changed = Object.keys(e.changes).map((k) => FIELD_NAMES[k] ?? k);
      return `${who} edited the ${changed.join(', ')}`;
    }
    case 'REASSIGNED': {
      const a = e.changes.assignee as { from?: { name: string } | null; to?: { name: string } | null } | undefined;
      return a?.from && a?.to ? `${who} reassigned from ${a.from.name} to ${a.to.name}` : `${who} reassigned the item`;
    }
    case 'STARTED':
      return `${who} started work`;
    case 'SUBMITTED':
      return `${who} submitted for review`;
    case 'APPROVED':
      return `${who} approved and closed the item`;
    case 'CHANGES_REQUESTED':
      return `${who} requested changes`;
    default:
      return `${who} changed the item to ${STATUS_LABELS[(e.changes.status as { to: keyof typeof STATUS_LABELS })?.to] ?? 'a new state'}`;
  }
}

function detailOf(e: ActivityEvent): string | null {
  if (e.action === 'CHANGES_REQUESTED' && typeof e.changes.reason === 'string') return `“${e.changes.reason}”`;
  if (e.action === 'SUBMITTED' && typeof e.changes.completionNote === 'string') return `“${e.changes.completionNote}”`;
  return null;
}
