import { type APIRequestContext, type Browser, type Page, expect } from '@playwright/test';

process.loadEnvFile?.('.env');
export const PASSWORD = process.env.SEED_PASSWORD!;

export async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/items/);
}

/** A separate browser context (its own cookies) signed in as `email`. */
export async function asUser(browser: Browser, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email);
  return { context, page };
}

/** Item ids by title, read through the API with the page's own session. */
export async function itemIds(request: APIRequestContext): Promise<Record<string, string>> {
  const res = await request.get('/api/items?pageSize=50');
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { items: { id: string; title: string }[] };
  return Object.fromEntries(body.items.map((i) => [i.title, i.id]));
}
