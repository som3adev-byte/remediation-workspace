'use client';

import { loginSchema } from '@rw/shared';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiFailure } from '@/lib/api';
import { keepOnlyDraftsOf } from '@/lib/drafts';
import { safeNext } from '@/lib/safe-next';
import type { Me } from '@/lib/types';
import { EyeIcon, EyeOffIcon, ShieldIcon } from './icons';
import { Banner, Button, Field } from './ui';

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Focus the email field on desktop only; on phones it would pop the keyboard over the page.
  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) emailRef.current?.focus();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      const f: Record<string, string> = {};
      for (const issue of parsed.error.issues) f[String(issue.path[0])] ??= issue.message;
      setFields(f);
      (f.email ? emailRef : passwordRef).current?.focus();
      return;
    }
    setFields({});
    setError(null);
    setBusy(true);
    try {
      await api('/auth/login', { method: 'POST', body: parsed.data });
      const me = await api<Me>('/auth/me');
      keepOnlyDraftsOf(me.id);
      router.replace(safeNext(params.get('next'), window.location.origin));
    } catch (err) {
      setError(err instanceof ApiFailure ? err : new ApiFailure(0, 'internal_error', 'Something went wrong. Try again.'));
      setBusy(false);
    }
  }

  return (
    <div className="login-card">
      <div className="brand">
        <ShieldIcon className="brand-mark" width={28} height={28} />
        <span className="brand-name">Remediation Workspace</span>
      </div>
      <h1 className="heading">Sign in</h1>
      {params.get('expired') === '1' && !error && (
        <Banner tone="info">Your session expired. Sign in again to continue where you left off.</Banner>
      )}
      {error && (
        <Banner tone="error" reference={error.status >= 500 ? error.requestId : undefined}>
          {error.message}
        </Banner>
      )}
      <form onSubmit={submit} noValidate className="stack">
        <Field label="Email" error={fields.email}>
          {(p) => (
            <input
              {...p}
              className="input"
              type="email"
              name="email"
              autoComplete="username"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              ref={emailRef}
            />
          )}
        </Field>
        <Field label="Password" error={fields.password}>
          {(p) => (
            <div className="input-with-action">
              <input
                {...p}
                className="input"
                type={showPassword ? 'text' : 'password'}
                name="password"
                ref={passwordRef}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="input-action"
                aria-pressed={showPassword}
                aria-controls={p.id}
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                <span>{showPassword ? 'Hide' : 'Show'}</span>
                <span className="sr-only"> password</span>
              </button>
            </div>
          )}
        </Field>
        <Button type="submit" loading={busy} loadingLabel="Signing in…" className="btn-block">
          Sign in
        </Button>
      </form>
    </div>
  );
}
