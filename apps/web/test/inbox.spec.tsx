import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Inbox } from '@/components/inbox';
import type { Item } from '@/lib/types';
import { manager, member, mockApi, renderAs, routerMock } from './helpers';

let search = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => '/items',
  useSearchParams: () => search,
  useParams: () => ({}),
}));

const empty = { items: [], total: 0, page: 1, pageSize: 20 };
const row: Item = {
  id: 'a1',
  ref: 142,
  title: 'Patch OpenSSL on edge proxies',
  description: '',
  status: 'IN_PROGRESS',
  dueDate: '2026-10-18',
  overdue: true,
  completionNote: null,
  version: 2,
  createdAt: '',
  updatedAt: '',
  assignee: { id: member.id, name: member.name },
  createdBy: { id: manager.id, name: manager.name },
};

describe('inbox states', () => {
  beforeEach(() => {
    search = new URLSearchParams();
    vi.clearAllMocks();
  });

  it('shows skeleton rows, then items with mono ref, ISO due date and the Overdue word', async () => {
    mockApi({ 'GET /items': () => ({ status: 200, body: { ...empty, items: [row], total: 1 } }) });
    renderAs(manager, <Inbox>{null}</Inbox>);
    expect(screen.getByLabelText('Loading items')).toBeInTheDocument();
    const link = await screen.findByRole('link', { name: /Patch OpenSSL/ });
    expect(link).toHaveTextContent('RW-0142');
    expect(link).toHaveTextContent('2026-10-18');
    expect(link).toHaveTextContent('Overdue');
    expect(screen.getByText('1–1 of 1')).toBeInTheDocument();
  });

  it('shows the load error with a request reference, and Try again reloads', async () => {
    const { calls } = mockApi({
      'GET /items': [
        () => ({ status: 503, body: { code: 'service_unavailable', message: 'Down', requestId: 'req_abc123' } }),
        () => ({ status: 200, body: empty }),
      ],
    });
    renderAs(manager, <Inbox>{null}</Inbox>);
    expect(await screen.findByText(/Couldn.t load items/)).toBeInTheDocument();
    expect(screen.getByText('req_abc123')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No remediation items yet')).toBeInTheDocument();
    expect(calls).toHaveLength(2);
  });

  it('uses role-specific empty copy, and filtered copy with Clear filters', async () => {
    mockApi({ 'GET /items': () => ({ status: 200, body: empty }) });
    const m = renderAs(member, <Inbox>{null}</Inbox>);
    expect(await screen.findByText('Nothing assigned to you')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'New item' })).not.toBeInTheDocument();
    m.unmount();

    search = new URLSearchParams('status=CLOSED&overdue=true');
    renderAs(manager, <Inbox>{null}</Inbox>);
    expect(await screen.findByText('No items match these filters')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Closed' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Overdue only' })).toBeChecked();
  });
});
