import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from '@/app/api/[...path]/route';

const ctx = (path: string[]) => ({ params: Promise.resolve({ path }) });

describe('API proxy route', () => {
  let sent: { url: string; headers: Headers; body?: ArrayBuffer };

  beforeEach(() => {
    process.env.API_URL = 'http://127.0.0.1:4000';
    process.env.PROXY_SECRET = 'test-secret';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      sent = { url: String(url), headers: new Headers(init?.headers), body: init?.body as ArrayBuffer };
      const headers = new Headers({ 'content-type': 'application/json', 'x-request-id': 'req_1' });
      headers.append('set-cookie', 'rw_session=abc; HttpOnly; SameSite=Strict; Path=/');
      return new Response('{"ok":true}', { status: 200, headers });
    });
  });

  it('forwards Origin unchanged, overwrites X-Forwarded-For and adds the proxy secret', async () => {
    const req = new NextRequest('http://localhost:3100/api/auth/login', {
      method: 'POST',
      headers: {
        origin: 'https://evil.test',
        'x-forwarded-for': '6.6.6.6',
        'x-internal-proxy-secret': 'guessed',
        'content-type': 'application/json',
        cookie: 'rw_session=old',
        authorization: 'Bearer smuggled',
      },
      body: '{"email":"a@b.c"}',
    });
    await POST(req, ctx(['auth', 'login']));
    expect(sent.url).toBe('http://127.0.0.1:4000/auth/login');
    expect(sent.headers.get('origin')).toBe('https://evil.test'); // the API decides, not the proxy
    expect(sent.headers.get('x-forwarded-for')).toBe('127.0.0.1');
    expect(sent.headers.get('x-internal-proxy-secret')).toBe('test-secret');
    expect(sent.headers.get('cookie')).toBe('rw_session=old');
    expect(sent.headers.get('authorization')).toBeNull();
    expect(new TextDecoder().decode(sent.body)).toBe('{"email":"a@b.c"}');
  });

  it('relays Set-Cookie and the request id, and keeps the query string', async () => {
    const res = await GET(new NextRequest('http://localhost:3100/api/items?status=OPEN&page=2'), ctx(['items']));
    expect(sent.url).toBe('http://127.0.0.1:4000/items?status=OPEN&page=2');
    expect(res.headers.getSetCookie()).toEqual(['rw_session=abc; HttpOnly; SameSite=Strict; Path=/']);
    expect(res.headers.get('x-request-id')).toBe('req_1');
  });

  it('cannot be steered to another host through the path', async () => {
    await GET(new NextRequest('http://localhost:3100/api/x'), ctx(['..', '..', '%2F%2Fevil.test']));
    expect(new URL(sent.url).host).toBe('127.0.0.1:4000');
  });

  it('answers 503 when the API is unreachable', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new TypeError('fetch failed'));
    const res = await GET(new NextRequest('http://localhost:3100/api/items'), ctx(['items']));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('service_unavailable');
  });
});
