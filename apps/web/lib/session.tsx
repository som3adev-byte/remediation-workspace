'use client';

import { createContext, useContext } from 'react';
import type { Me } from './types';

export interface Session {
  me: Me;
  inboxCount: number | null;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession outside the app shell');
  return s;
}
