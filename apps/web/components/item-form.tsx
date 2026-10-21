'use client';

import { canEdit, createItemSchema, formatRef, LIMITS } from '@rw/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiFailure, notifyItemsChanged } from '@/lib/api';
import { clearDraft, readDraft, saveDraft } from '@/lib/drafts';
import { ROLE_LABEL } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { Assignee, Item } from '@/lib/types';
import { useToast } from './toast';
import { Banner, Button, Field } from './ui';

export interface FormValues {
  title: string;
  description: string;
  assigneeId: string;
  dueDate: string;
}

interface Draft {
  values: FormValues;
  version: number | null;
}

const EMPTY: FormValues = { title: '', description: '', assigneeId: '', dueDate: '' };

function fromItem(item: Item): FormValues {
  return { title: item.title, description: item.description, assigneeId: item.assignee.id, dueDate: item.dueDate };
}

type Props = { mode: 'create' } | { mode: 'edit'; id: string };

export function ItemForm(props: Props) {
  const { me } = useSession();
  const router = useRouter();
  const toast = useToast();
  const itemId = props.mode === 'edit' ? props.id : null;
  const draftKey = itemId ?? 'new';

  const [assignees, setAssignees] = useState<Assignee[] | null>(null);
  const [item, setItem] = useState<Item | null>(null);
  const [values, setValues] = useState<FormValues>(EMPTY);
  const [version, setVersion] = useState<number | null>(null);
  const [fields, setFields] = useState<Partial<Record<keyof FormValues, string>>>({});
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [loadError, setLoadError] = useState<ApiFailure | null>(null);
  const [restored, setRestored] = useState(false);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [dirty, setDirty] = useState(false);

  // After a failed submit, move focus to the first field with an error.
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [fields]);

  // Warn before closing or reloading the tab with unsaved input.
  useEffect(() => {
    if (!dirty || saving) return;
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [dirty, saving]);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [people, current] = await Promise.all([
        api<Assignee[]>('/items/assignees'),
        itemId ? api<Item>(`/items/${itemId}`) : Promise.resolve(null),
      ]);
      setAssignees(people);
      setItem(current);
      const draft = readDraft<Draft>(me.id, draftKey);
      if (draft) {
        setValues(draft.values);
        setVersion(draft.version ?? current?.version ?? null);
        setRestored(true);
      } else {
        setValues(current ? fromItem(current) : EMPTY);
        setVersion(current?.version ?? null);
      }
    } catch (err) {
      setLoadError(err as ApiFailure);
    }
  }, [itemId, me.id, draftKey]);

  useEffect(() => {
    if (me.role === 'MANAGER') void load();
  }, [load, me.role]);

  const set = (k: keyof FormValues) => (v: string) => {
    setValues((prev) => ({ ...prev, [k]: v }));
    setDirty(true);
    if (fields[k]) setFields((f) => ({ ...f, [k]: undefined }));
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;

    const parsed = createItemSchema.safeParse(values);
    if (!parsed.success) {
      const f: Partial<Record<keyof FormValues, string>> = {};
      for (const issue of parsed.error.issues) f[issue.path[0] as keyof FormValues] ??= issue.message;
      setFields(f);
      return;
    }

    let body: Record<string, unknown> = parsed.data;
    if (item) {
      const base = fromItem(item);
      const changed = Object.fromEntries(
        Object.entries(parsed.data).filter(([k, v]) => base[k as keyof FormValues] !== v),
      );
      if (Object.keys(changed).length === 0) {
        clearDraft(me.id, draftKey);
        router.push(`/items/${item.id}`);
        return;
      }
      body = { ...changed, version };
    }

    inFlight.current = true;
    setSaving(true);
    setFailure(null);
    setFields({});
    try {
      const saved = await api<Item>(item ? `/items/${item.id}` : '/items', {
        method: item ? 'PATCH' : 'POST',
        body,
      });
      clearDraft(me.id, draftKey);
      setDirty(false);
      notifyItemsChanged();
      toast(item ? `Saved ${formatRef(saved.ref)}.` : `Created ${formatRef(saved.ref)}.`);
      router.push(`/items/${saved.id}`);
    } catch (err) {
      const f = err as ApiFailure;
      if (f.status === 401) {
        // The shell shows the "session expired" dialog; keep what was typed for after sign-in.
        saveDraft<Draft>(me.id, draftKey, { values, version });
      } else if (f.status === 400 || f.status === 422) {
        setFields(f.fields as Partial<Record<keyof FormValues, string>>);
      }
      setFailure(f);
      inFlight.current = false;
      setSaving(false);
    }
  }

  async function reloadLatest() {
    if (!itemId) return;
    try {
      const latest = await api<Item>(`/items/${itemId}`);
      setItem(latest);
      setValues(fromItem(latest));
      setVersion(latest.version);
      setFailure(null);
      clearDraft(me.id, draftKey);
    } catch (err) {
      setFailure(err as ApiFailure);
    }
  }

  const cancelHref = itemId ? `/items/${itemId}` : '/items';
  const title = itemId ? 'Edit item' : 'New item';

  if (me.role !== 'MANAGER') {
    return (
      <FormPage title={title} crumb={null}>
        <Banner tone="error">Only managers can create or edit items.</Banner>
      </FormPage>
    );
  }
  if (loadError) {
    return (
      <FormPage title={title} crumb={null}>
        <Banner
          tone="error"
          reference={loadError.requestId}
          action={
            loadError.status === 404 ? undefined : (
              <Button variant="secondary" onClick={load}>
                Try again
              </Button>
            )
          }
        >
          {loadError.status === 404 ? 'This item is not available.' : `Couldn't load the form. ${loadError.message}`}
        </Banner>
      </FormPage>
    );
  }
  if (!assignees) {
    return (
      <FormPage title={title} crumb={null}>
        <div className="panel form-panel" aria-busy="true" aria-label="Loading form">
          <span className="skeleton skeleton-block" />
        </div>
      </FormPage>
    );
  }
  if (item && !canEdit({ status: item.status, assigneeId: item.assignee.id }, { userId: me.id, role: me.role })) {
    return (
      <FormPage title={title} crumb={formatRef(item.ref)}>
        <Banner tone="error" action={<Link href={cancelHref} className="btn btn-secondary">Back to item</Link>}>
          Items can only be edited while Open or In progress.
        </Banner>
      </FormPage>
    );
  }

  const conflict = failure?.code === 'conflict';
  const bannerText = (() => {
    if (!failure || failure.status === 400 || failure.status === 422 || failure.status === 401) return null;
    if (conflict) return 'Someone else changed this item while you were editing. Your changes are kept below.';
    if (failure.code === 'invalid_transition') return 'This item moved to a status that can no longer be edited. Your changes are kept below.';
    return `${failure.message} Your changes are kept below.`;
  })();

  return (
    <FormPage title={title} crumb={item ? formatRef(item.ref) : 'New'}>
      {restored && <Banner tone="info">We restored the changes you hadn&apos;t saved before signing in again.</Banner>}
      {bannerText && (
        <Banner
          tone={conflict ? 'warning' : 'error'}
          reference={failure && failure.status >= 500 ? failure.requestId : undefined}
          action={
            conflict ? (
              <Button variant="secondary" onClick={reloadLatest}>
                Reload latest
              </Button>
            ) : undefined
          }
        >
          {bannerText}
        </Banner>
      )}
      <form ref={formRef} onSubmit={submit} noValidate aria-label={title}>
        <div className="panel form-panel stack">
          <Field label="Title" error={fields.title} count={{ value: values.title.length, max: LIMITS.title }}>
            {(p) => <input {...p} name="title" autoComplete="off" className="input" value={values.title} onChange={(e) => set('title')(e.target.value)} />}
          </Field>
          <Field
            label="Description"
            error={fields.description}
            count={{ value: values.description.length, max: LIMITS.description }}
          >
            {(p) => (
              <textarea
                {...p}
                name="description"
                className="input textarea"
                rows={6}
                value={values.description}
                onChange={(e) => set('description')(e.target.value)}
              />
            )}
          </Field>
          <Field label="Assignee" error={fields.assigneeId}>
            {(p) => (
              <select {...p} name="assigneeId" className="input select" value={values.assigneeId} onChange={(e) => set('assigneeId')(e.target.value)}>
                <option value="">Choose a person</option>
                {assignees.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {ROLE_LABEL[a.role]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Due date" error={fields.dueDate}>
            {(p) => (
              <input
                {...p}
                name="dueDate"
                autoComplete="off"
                className="input mono"
                type="date"
                value={values.dueDate}
                onChange={(e) => set('dueDate')(e.target.value)}
              />
            )}
          </Field>
        </div>
        <div className="button-row form-actions">
          <Button type="submit" loading={saving}>
            {item ? 'Save changes' : 'Create item'}
          </Button>
          <Link href={cancelHref} className="btn btn-secondary">
            Cancel
          </Link>
        </div>
      </form>
    </FormPage>
  );
}

function FormPage({ title, crumb, children }: { title: string; crumb: string | null; children: React.ReactNode }) {
  return (
    <div className="form-page">
      <nav aria-label="Breadcrumb" className="crumbs">
        <Link href="/items">Inbox</Link>
        {crumb && (
          <>
            <span aria-hidden>/</span>
            <span className="mono">{crumb}</span>
          </>
        )}
      </nav>
      <h1 className="display">{title}</h1>
      {children}
    </div>
  );
}
