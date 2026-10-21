import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { ToastProvider } from '@/components/toast';
import { SessionContext } from '@/lib/session';
import type { Me } from '@/lib/types';

export const manager: Me = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Dana Reyes',
  email: 'dana@acme.test',
  role: 'MANAGER',
  org: { id: 'org-a', name: 'Acme Security' },
};
export const member: Me = { ...manager, id: '22222222-2222-4222-8222-222222222222', name: 'Sam Patel', role: 'MEMBER' };
export const otherManager: Me = { ...manager, id: '33333333-3333-4333-8333-333333333333', name: 'Omar Haddad' };

export function renderAs(me: Me, ui: ReactNode) {
  return render(
    <SessionContext.Provider value={{ me, inboxCount: 0 }}>
      <ToastProvider>{ui}</ToastProvider>
    </SessionContext.Provider>,
  );
}

type Handler = (body: unknown) => { status: number; body?: unknown };

/** Stubs fetch for "/api/..." calls by "METHOD /path" (query string ignored unless given). Records every call. */
export function mockApi(routes: Record<string, Handler | Handler[]>) {
  const calls: { key: string; body: unknown }[] = [];
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://localhost');
    const path = url.pathname.replace(/^\/api/, '');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const key = routes[`${method} ${path}${url.search}`] ? `${method} ${path}${url.search}` : `${method} ${path}`;
    calls.push({ key, body });
    const route = routes[key];
    if (!route) throw new Error(`unmocked ${key}`);
    const handler = Array.isArray(route) ? (route.length > 1 ? route.shift()! : route[0]!) : route;
    const res = handler(body);
    return new Response(res.status === 204 ? null : JSON.stringify(res.body ?? {}), {
      status: res.status,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { calls, spy };
}

export const routerMock = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() };
