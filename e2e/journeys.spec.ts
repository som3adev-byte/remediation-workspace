import { expect, test } from '@playwright/test';
import { asUser, itemIds, signIn } from './helpers';

test('sign in shows only my items; sign out ends the session @phone', async ({ page, context }) => {
  await signIn(page, 'sam@acme.test');
  await expect(page.getByRole('link', { name: /Enable MFA for admin accounts/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Rotate leaked API key/ })).toHaveCount(0); // Lee's item
  await expect(page.getByRole('link', { name: 'New item' })).toHaveCount(0); // members can't create

  const before = await context.cookies();
  expect(before.find((c) => c.name === 'rw_session')?.httpOnly).toBe(true);

  const menu = page.getByRole('button', { name: 'Open menu' });
  if (await menu.isVisible()) await menu.click(); // phones keep Sign out in the menu
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/items');
  await expect(page).toHaveURL(/\/login\?next=/);

  // The old token is refused by the server, not just forgotten by the browser.
  const old = before.find((c) => c.name === 'rw_session')!;
  const replay = await page.request.get('/api/auth/me', { headers: { cookie: `rw_session=${old.value}` } });
  expect(replay.status()).toBe(401);
});

test('wrong password shows a generic error and keeps the email', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('sam@acme.test');
  await page.getByLabel('Password', { exact: true }).fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Invalid email or password.')).toBeVisible();
  await expect(page.getByLabel('Email')).toHaveValue('sam@acme.test');
});

test('member starts and submits; manager approves; history records each step', async ({ browser }) => {
  const sam = await asUser(browser, 'sam@acme.test');
  await sam.page.getByRole('link', { name: /Upgrade lodash to fix prototype pollution/ }).click();
  await sam.page.getByRole('button', { name: 'Start work' }).click();
  await expect(sam.page.getByRole('button', { name: 'Submit for review' })).toBeVisible();
  await sam.page.getByLabel('Completion note (required)').fill('Bumped lodash to 4.17.21 in web and worker.');
  await sam.page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(sam.page.getByText('Pending review').first()).toBeVisible();
  await expect(sam.page.getByRole('button', { name: 'Approve' })).toHaveCount(0); // members can't review
  const url = sam.page.url();

  const dana = await asUser(browser, 'dana@acme.test');
  await dana.page.goto(new URL(url).pathname);
  await dana.page.getByRole('button', { name: 'Approve' }).click();
  await expect(dana.page.getByText('Closed').first()).toBeVisible();
  await expect(dana.page.getByRole('link', { name: 'Edit' })).toHaveCount(0); // closed is read-only
  const activity = dana.page.getByRole('region', { name: 'Activity' }).or(dana.page.locator('section', { hasText: 'Activity' }));
  await expect(activity.getByText(/approved/i).first()).toBeVisible();
  await expect(activity.getByText(/submitted/i).first()).toBeVisible();

  await sam.context.close();
  await dana.context.close();
});

test('other people’s and other orgs’ items are not available, in the UI and the API', async ({ browser }) => {
  const dana = await asUser(browser, 'dana@acme.test');
  const acme = await itemIds(dana.page.request);
  const nina = await asUser(browser, 'nina@globex.test');
  const globex = await itemIds(nina.page.request);

  const sam = await asUser(browser, 'sam@acme.test');
  for (const id of [acme['Rotate leaked API key in billing service']!, globex['Disable TLS 1.0 on the payments gateway']!]) {
    await sam.page.goto(`/items/${id}`);
    await expect(sam.page.getByText('This item is not available.', { exact: false })).toBeVisible();
    const res = await sam.page.request.post(`/api/items/${id}/transitions/start`, {
      data: { version: 1 },
      headers: { origin: 'http://localhost:3100' },
    });
    expect(res.status()).toBe(404);
  }

  // A manager can't reach another org's item either.
  await dana.page.goto(`/items/${globex['Apply kernel updates on bastions']!}`);
  await expect(dana.page.getByText('This item is not available.', { exact: false })).toBeVisible();

  for (const s of [dana, nina, sam]) await s.context.close();
});
