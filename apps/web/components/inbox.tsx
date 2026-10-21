'use client';

import { formatRef, LIMITS, STATUSES, STATUS_LABELS, type Status } from '@rw/shared';
import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiFailure, ITEMS_CHANGED_EVENT } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { ItemPage } from '@/lib/types';
import { FilterIcon } from './icons';
import { Banner, Button, DueDate, StatusBadge } from './ui';

type Load =
  | { state: 'loading' }
  | { state: 'error'; error: ApiFailure; last?: ItemPage }
  | { state: 'ready'; data: ItemPage; refreshing: boolean };

export function Inbox({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { id: selectedId } = useParams<{ id?: string }>();

  const status = (STATUSES as readonly string[]).includes(params.get('status') ?? '') ? (params.get('status') as Status) : null;
  const overdue = params.get('overdue') === 'true';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const query = params.toString();
  const filtered = Boolean(status || overdue);

  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const requestNo = useRef(0);
  const lastOpened = useRef<string | null>(null);

  const fetchPage = useCallback(async () => {
    const n = ++requestNo.current;
    setLoad((prev) => (prev.state === 'ready' ? { ...prev, refreshing: true } : prev.state === 'error' && prev.last ? { state: 'ready', data: prev.last, refreshing: true } : { state: 'loading' }));
    const q = new URLSearchParams({ page: String(page), pageSize: String(LIMITS.pageSizeDefault) });
    if (status) q.set('status', status);
    if (overdue) q.set('overdue', 'true');
    try {
      const data = await api<ItemPage>(`/items?${q}`);
      if (n === requestNo.current) setLoad({ state: 'ready', data, refreshing: false });
    } catch (err) {
      if (n !== requestNo.current) return;
      setLoad((prev) => ({ state: 'error', error: err as ApiFailure, last: prev.state === 'ready' ? prev.data : undefined }));
    }
  }, [page, status, overdue]);

  useEffect(() => {
    void fetchPage();
  }, [fetchPage]);

  useEffect(() => {
    const onChange = () => void fetchPage();
    window.addEventListener(ITEMS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(ITEMS_CHANGED_EVENT, onChange);
  }, [fetchPage]);

  // Escape closes the detail pane and puts focus back on the row that opened it.
  useEffect(() => {
    if (selectedId) lastOpened.current = selectedId;
    if (!selectedId) {
      const id = lastOpened.current;
      if (id) document.querySelector<HTMLElement>(`[data-row-id="${id}"]`)?.focus();
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('[aria-modal="true"]')) return;
      router.push(`/items${query ? `?${query}` : ''}`);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, query, router]);

  function setParams(next: Record<string, string | null>) {
    const q = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    if (!('page' in next)) q.delete('page');
    const s = q.toString();
    router.push(`${pathname}${s ? `?${s}` : ''}`);
  }

  const data = load.state === 'ready' ? load.data : null;
  const filterSummary = [status ? STATUS_LABELS[status] : 'All', overdue ? 'Overdue only' : null].filter(Boolean).join(' · ');

  return (
    <div className={`split ${selectedId ? 'has-detail' : ''}`}>
      <section className="list-pane" aria-labelledby="inbox-title">
        <div className="page-head">
          <h1 id="inbox-title" className="display">
            Inbox
          </h1>
          {me.role === 'MANAGER' && (
            <Link href="/items/new" className="btn btn-primary">
              New item
            </Link>
          )}
        </div>

        <button
          type="button"
          className="btn btn-secondary filters-toggle"
          aria-expanded={filtersOpen}
          aria-controls="filters"
          onClick={() => setFiltersOpen((o) => !o)}
        >
          <FilterIcon />
          Filters <span className="filters-summary">{filterSummary}</span>
        </button>

        <div id="filters" className={`filters ${filtersOpen ? 'is-open' : ''}`}>
          <fieldset className="segmented">
            <legend className="label">Status</legend>
            <div className="segmented-track">
              {[null, ...STATUSES].map((s) => (
                <label key={s ?? 'all'} className={`segment ${status === s ? 'is-selected' : ''}`}>
                  <input
                    type="radio"
                    name="status"
                    checked={status === s}
                    onChange={() => setParams({ status: s })}
                  />
                  {s ? STATUS_LABELS[s] : 'All'}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="toggle">
            <input
              type="checkbox"
              role="switch"
              checked={overdue}
              onChange={(e) => setParams({ overdue: e.target.checked ? 'true' : null })}
            />
            <span className="toggle-track" aria-hidden />
            <span className="label">Overdue only</span>
          </label>
        </div>

        <div className="panel list-panel">
          {load.state === 'error' && (
            <Banner
              tone="error"
              reference={load.error.requestId}
              action={
                <Button variant="secondary" onClick={fetchPage}>
                  Try again
                </Button>
              }
            >
              Couldn&apos;t load items. Check your connection and try again.
            </Banner>
          )}

          <div className="table-head" aria-hidden>
            <span>ID</span>
            <span>Title</span>
            <span>Due</span>
            <span>Status</span>
          </div>

          {load.state === 'loading' && (
            <ul className="rows" aria-busy="true" aria-label="Loading items">
              {Array.from({ length: 8 }, (_, i) => (
                <li key={i} className="row skeleton-row">
                  <span className="skeleton" />
                  <span className="skeleton" />
                  <span className="skeleton" />
                  <span className="skeleton" />
                </li>
              ))}
            </ul>
          )}

          {data && data.items.length === 0 && (
            <div className="empty">
              {filtered ? (
                <>
                  <h2 className="heading">No items match these filters</h2>
                  <p>Try another status or turn off Overdue only.</p>
                  <Button variant="secondary" onClick={() => router.push(pathname)}>
                    Clear filters
                  </Button>
                </>
              ) : me.role === 'MANAGER' ? (
                <>
                  <h2 className="heading">No remediation items yet</h2>
                  <p>Create the first item and assign it to someone on your team.</p>
                  <Link href="/items/new" className="btn btn-primary">
                    New item
                  </Link>
                </>
              ) : (
                <>
                  <h2 className="heading">Nothing assigned to you</h2>
                  <p>Items a manager assigns to you will show up here.</p>
                </>
              )}
            </div>
          )}

          {data && data.items.length > 0 && (
            <ul className={`rows ${load.state === 'ready' && load.refreshing ? 'is-refreshing' : ''}`} aria-busy={load.state === 'ready' && load.refreshing}>
              {data.items.map((item) => (
                <li key={item.id}>
                  <Link
                    href={`/items/${item.id}${query ? `?${query}` : ''}`}
                    className={`row ${item.id === selectedId ? 'is-selected' : ''}`}
                    aria-current={item.id === selectedId ? 'page' : undefined}
                    data-row-id={item.id}
                  >
                    <span className="mono row-ref">{formatRef(item.ref)}</span>
                    <span className="row-title">{item.title}</span>
                    <span className="row-due">
                      <DueDate date={item.dueDate} overdue={item.overdue} />
                    </span>
                    <span className="row-status">
                      <StatusBadge status={item.status} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {data && data.total > 0 && (
            <div className="pager">
              <span className="mono">
                {(data.page - 1) * data.pageSize + 1}–{Math.min(data.page * data.pageSize, data.total)} of {data.total}
              </span>
              <div className="pager-buttons">
                <Button variant="secondary" disabled={data.page <= 1} onClick={() => setParams({ page: String(data.page - 1) })}>
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  disabled={data.page * data.pageSize >= data.total}
                  onClick={() => setParams({ page: String(data.page + 1) })}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="detail-pane" aria-label="Item details">
        {children}
      </section>
    </div>
  );
}
