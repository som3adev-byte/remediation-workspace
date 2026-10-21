import type { Role, Status } from '@rw/shared';

export interface Me {
  id: string;
  name: string;
  email: string;
  role: Role;
  org: { id: string; name: string };
}

export interface PersonRef {
  id: string;
  name: string;
}

export interface Item {
  id: string;
  ref: number;
  title: string;
  description: string;
  status: Status;
  dueDate: string;
  overdue: boolean;
  completionNote: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  assignee: PersonRef;
  createdBy: PersonRef;
}

export interface ItemPage {
  items: Item[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ActivityEvent {
  id: string;
  action: 'CREATED' | 'EDITED' | 'REASSIGNED' | 'STARTED' | 'SUBMITTED' | 'APPROVED' | 'CHANGES_REQUESTED';
  changes: Record<string, unknown>;
  createdAt: string;
  actor: PersonRef;
}

export interface Assignee extends PersonRef {
  role: Role;
}
