import { describe, expect, it } from 'vitest';
import { safeNext } from '@/lib/safe-next';

const ORIGIN = 'http://localhost:3100';

describe('safeNext', () => {
  it.each([
    ['/items/abc?status=OPEN', '/items/abc?status=OPEN'],
    ['/items/new', '/items/new'],
  ])('keeps the same-origin path %s', (raw, expected) => {
    expect(safeNext(raw, ORIGIN)).toBe(expected);
  });

  it.each([
    null,
    '',
    'https://evil.test/items',
    '//evil.test/items',
    '/\\evil.test',
    'javascript:alert(1)',
    'items',
    '/login?next=/items',
    '/%2e%2e//evil.test',
    '/%2e%2e///evil.test',
    '/%2e%2e/\\\\evil.test',
    '/./%2e%2e//evil.test',
  ])('falls back to /items for %s', (raw) => {
    expect(safeNext(raw, ORIGIN)).toBe('/items');
  });
});
