import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ItemDetail } from '@/components/item-detail';
import type { Item } from '@/lib/types';
import { member, mockApi, renderAs, routerMock } from './helpers';

vi.mock('next/navigation', () => ({ useRouter: () => routerMock, useSearchParams: () => new URLSearchParams() }));

const ITEM: Item = {
  id: '77777777-7777-4777-8777-777777777777',
  ref: 3,
  title: 'Enable MFA for admin accounts',
  description: 'Turn it on.',
  status: 'IN_PROGRESS',
  dueDate: '2099-01-01',
  overdue: false,
  completionNote: null,
  version: 2,
  createdAt: '2026-10-20T08:00:00Z',
  updatedAt: '2026-10-20T08:00:00Z',
  assignee: { id: member.id, name: member.name },
  createdBy: { id: 'm', name: 'Dana Reyes' },
};

describe('item detail: session expiry keeps the completion note', () => {
  beforeEach(() => vi.clearAllMocks());

  it('saves the note on 401 and restores it for the same user', async () => {
    mockApi({
      [`GET /items/${ITEM.id}`]: () => ({ status: 200, body: ITEM }),
      [`GET /items/${ITEM.id}/activity`]: () => ({ status: 200, body: [] }),
      [`POST /items/${ITEM.id}/transitions/submit`]: () => ({ status: 401, body: { code: 'session_expired', message: 'Expired' } }),
    });
    const first = renderAs(member, <ItemDetail id={ITEM.id} />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Completion note (required)'), 'Enforced MFA for all 14 admins.');
    await user.click(screen.getByRole('button', { name: 'Submit for review' }));
    await waitFor(() => expect(sessionStorage.length).toBe(1));
    first.unmount();

    renderAs(member, <ItemDetail id={ITEM.id} />);
    expect(await screen.findByDisplayValue('Enforced MFA for all 14 admins.')).toBeInTheDocument();
  });
});
