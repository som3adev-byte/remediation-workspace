import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ItemForm } from '@/components/item-form';
import { SESSION_EXPIRED_EVENT } from '@/lib/api';
import { keepOnlyDraftsOf } from '@/lib/drafts';
import type { Item } from '@/lib/types';
import { manager, mockApi, otherManager, renderAs, routerMock } from './helpers';

vi.mock('next/navigation', () => ({ useRouter: () => routerMock }));

// Brief test 9: one frontend interaction — validation, submission failure and session expiration.

const PEOPLE = [
  { id: '44444444-4444-4444-8444-444444444444', name: 'Sam Patel', role: 'MEMBER' },
  { id: '55555555-5555-4555-8555-555555555555', name: 'Lee Wong', role: 'MEMBER' },
];
const ITEM: Item = {
  id: '66666666-6666-4666-8666-666666666666',
  ref: 139,
  title: 'Rotate leaked API key',
  description: 'Found in a public repo.',
  status: 'OPEN',
  dueDate: '2026-10-24',
  overdue: false,
  completionNote: null,
  version: 3,
  createdAt: '2026-10-20T08:00:00Z',
  updatedAt: '2026-10-20T08:00:00Z',
  assignee: { id: PEOPLE[0]!.id, name: 'Sam Patel' },
  createdBy: { id: manager.id, name: manager.name },
};

async function fillCreateForm() {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Title'), 'Patch nginx');
  await user.type(screen.getByLabelText('Description'), 'CVE-2026-0001 on edge');
  await user.selectOptions(screen.getByLabelText('Assignee'), PEOPLE[0]!.id);
  await user.type(screen.getByLabelText('Due date'), '2026-11-01');
  return user;
}

describe('item form', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows field errors on submit without calling the API, linked to the field', async () => {
    const { calls } = mockApi({ 'GET /items/assignees': () => ({ status: 200, body: PEOPLE }) });
    renderAs(manager, <ItemForm mode="create" />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Create item' }));

    const title = screen.getByLabelText('Title');
    expect(title).toHaveAttribute('aria-invalid', 'true');
    expect(title).toHaveAccessibleDescription('Title is required.');
    expect(calls.filter((c) => c.key === 'POST /items')).toHaveLength(0);
  });

  it('shows server validation errors and keeps every value typed', async () => {
    mockApi({
      'GET /items/assignees': () => ({ status: 200, body: PEOPLE }),
      'POST /items': () => ({
        status: 422,
        body: { code: 'invalid_assignee', message: 'Choose an active person from your organization.', fields: { assigneeId: 'Choose an active person from your organization.' } },
      }),
    });
    renderAs(manager, <ItemForm mode="create" />);
    const user = await fillCreateForm();
    await user.click(screen.getByRole('button', { name: 'Create item' }));

    expect(await screen.findByText('Choose an active person from your organization.')).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue('Patch nginx');
    expect(screen.getByLabelText('Description')).toHaveValue('CVE-2026-0001 on edge');
    expect(screen.getByRole('button', { name: 'Create item' })).toBeEnabled();
  });

  it('sends one request on a double click and shows the saving state', async () => {
    let release!: () => void;
    const { calls } = mockApi({
      'GET /items/assignees': () => ({ status: 200, body: PEOPLE }),
      'POST /items': () => ({ status: 201, body: { ...ITEM, id: 'new-id' } }),
    });
    const fetchSpy = vi.mocked(globalThis.fetch);
    const original = fetchSpy.getMockImplementation()!;
    fetchSpy.mockImplementation(async (input, init) => {
      if (init?.method === 'POST') await new Promise<void>((r) => (release = r));
      return original(input, init);
    });
    renderAs(manager, <ItemForm mode="create" />);
    const user = await fillCreateForm();
    const button = screen.getByRole('button', { name: 'Create item' });
    await user.dblClick(button);
    expect(await screen.findByRole('button', { name: /Saving/ })).toBeDisabled();
    release();
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith('/items/new-id'));
    expect(calls.filter((c) => c.key === 'POST /items')).toHaveLength(1);
  });

  it('on a 409 shows the conflict banner, keeps the edits, and sends the version it rendered', async () => {
    const { calls } = mockApi({
      'GET /items/assignees': () => ({ status: 200, body: PEOPLE }),
      [`GET /items/${ITEM.id}`]: () => ({ status: 200, body: ITEM }),
      [`PATCH /items/${ITEM.id}`]: () => ({ status: 409, body: { code: 'conflict', message: 'Someone else changed this item.' } }),
    });
    renderAs(manager, <ItemForm mode="edit" id={ITEM.id} />);
    const user = userEvent.setup();
    const title = await screen.findByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'Rotate key and purge history');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText(/Someone else changed this item while you were editing/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload latest' })).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue('Rotate key and purge history');
    expect(calls.find((c) => c.key.startsWith('PATCH'))?.body).toEqual({ title: 'Rotate key and purge history', version: 3 });
  });

  it('on session expiry saves the draft, and restores it only for the same user', async () => {
    const expired = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    mockApi({
      'GET /items/assignees': () => ({ status: 200, body: PEOPLE }),
      'POST /items': () => ({ status: 401, body: { code: 'session_expired', message: 'Your session expired.' } }),
    });
    const first = renderAs(manager, <ItemForm mode="create" />);
    const user = await fillCreateForm();
    await user.click(screen.getByRole('button', { name: 'Create item' }));

    await waitFor(() => expect(expired).toHaveBeenCalledTimes(1));
    expect(JSON.parse(sessionStorage.getItem(`draft:${manager.id}:new`)!).values.title).toBe('Patch nginx');
    window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
    first.unmount();

    // Same user signs back in: the form comes back filled.
    const again = renderAs(manager, <ItemForm mode="create" />);
    expect(await screen.findByDisplayValue('Patch nginx')).toBeInTheDocument();
    expect(screen.getByText(/We restored the changes/)).toBeInTheDocument();
    again.unmount();

    // A different user signs in on this tab: other users' drafts are deleted and nothing is shown.
    keepOnlyDraftsOf(otherManager.id);
    expect(sessionStorage.getItem(`draft:${manager.id}:new`)).toBeNull();
    renderAs(otherManager, <ItemForm mode="create" />);
    expect(await screen.findByLabelText('Title')).toHaveValue('');
    expect(screen.queryByText(/We restored the changes/)).not.toBeInTheDocument();
  });
});
