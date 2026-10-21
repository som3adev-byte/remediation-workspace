import { Suspense, type ReactNode } from 'react';
import { Inbox } from '@/components/inbox';

export default function ItemsLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense>
      <Inbox>{children}</Inbox>
    </Suspense>
  );
}
