import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('pages run under a nonce-based CSP with no inline-script allowance and no violations', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });

  const first = await page.goto('/login');
  const csp = first!.headers()['content-security-policy'] ?? '';
  const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src')) ?? '';
  expect(scriptSrc).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
  expect(scriptSrc).not.toContain("'unsafe-inline'");

  // A fresh nonce on every response.
  const second = await page.request.get('/login');
  expect(second.headers()['content-security-policy']).not.toBe(csp);

  await signIn(page, 'dana@acme.test');
  await page.getByRole('link', { name: /Patch OpenSSL on edge proxies/ }).click();
  await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible();
  expect(violations).toEqual([]);
});
