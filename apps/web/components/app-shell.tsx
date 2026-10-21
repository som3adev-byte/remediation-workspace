'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiFailure, ITEMS_CHANGED_EVENT, SESSION_EXPIRED_EVENT } from '@/lib/api';
import { clearAllDrafts } from '@/lib/drafts';
import { initials, ROLE_LABEL } from '@/lib/format';
import { SessionContext } from '@/lib/session';
import type { ItemPage, Me } from '@/lib/types';
import { CloseIcon, InboxIcon, MenuIcon, ShieldIcon, SignOutIcon } from './icons';
import { ToastProvider } from './toast';
import { Banner, Button } from './ui';

function currentPath() {
  return window.location.pathname + window.location.search;
}

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [loadError, setLoadError] = useState<ApiFailure | null>(null);
  const [inboxCount, setInboxCount] = useState<number | null>(null);
  const [expired, setExpired] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const loadMe = useCallback(async () => {
    setLoadError(null);
    try {
      setMe(await api<Me>('/auth/me'));
    } catch (err) {
      if (err instanceof ApiFailure && err.status === 401) {
        router.replace(`/login?next=${encodeURIComponent(currentPath())}`);
      } else {
        setLoadError(err as ApiFailure);
      }
    }
  }, [router]);

  const loadCount = useCallback(async () => {
    try {
      setInboxCount((await api<ItemPage>('/items?pageSize=1')).total);
    } catch {
      // The count is decoration; the list shows its own errors.
    }
  }, []);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  useEffect(() => {
    if (!me) return;
    void loadCount();
    const onChange = () => void loadCount();
    const onExpired = () => setExpired(true);
    window.addEventListener(ITEMS_CHANGED_EVENT, onChange);
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => {
      window.removeEventListener(ITEMS_CHANGED_EVENT, onChange);
      window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
    };
  }, [me, loadCount]);

  useEffect(() => setMenuOpen(false), [pathname]);

  // Escape closes the mobile menu and returns focus to its button.
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setMenuOpen(false);
      menuButton.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  async function signOut() {
    setSigningOut(true);
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      // Even if the call fails, local state is cleared and the user leaves.
    }
    clearAllDrafts();
    router.replace('/login');
  }

  if (loadError) {
    return (
      <main className="center-page">
        <Banner tone="error" reference={loadError.requestId} action={<Button variant="secondary" onClick={loadMe}>Try again</Button>}>
          Couldn&apos;t load your workspace. {loadError.message}
        </Banner>
      </main>
    );
  }
  if (!me) return <div className="shell-loading" aria-busy="true" aria-label="Loading" />;

  const nav = (
    <>
      <nav aria-label="Main">
        <Link href="/items" className="nav-link is-active" aria-current={pathname === '/items' ? 'page' : undefined}>
          <InboxIcon />
          <span>Inbox</span>
          <span className="mono nav-count">{inboxCount ?? ''}</span>
        </Link>
      </nav>
      <div className="sidebar-foot">
        <div className="user">
          <span className="avatar" aria-hidden>
            {initials(me.name)}
          </span>
          <span>
            {me.name}, {ROLE_LABEL[me.role]}
          </span>
        </div>
        <button type="button" className="signout" onClick={signOut} disabled={signingOut}>
          <SignOutIcon />
          <span>{signingOut ? 'Signing out…' : 'Sign out'}</span>
        </button>
      </div>
    </>
  );

  return (
    <SessionContext.Provider value={{ me, inboxCount }}>
      <ToastProvider>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <div className="shell" inert={expired || undefined}>
          <aside className="sidebar">
            <div className="brand">
              <ShieldIcon className="brand-mark" width={28} height={28} />
              <div>
                <div className="brand-name" translate="no">
                  Remediation Workspace
                </div>
                <div className="brand-org">{me.org.name}</div>
              </div>
            </div>
            {nav}
          </aside>
          <header className="topbar">
            <div className="brand">
              <ShieldIcon className="brand-mark" width={24} height={24} />
              <span className="brand-name" translate="no">
                Remediation Workspace
              </span>
            </div>
            <button
              ref={menuButton}
              type="button"
              className="icon-btn"
              aria-expanded={menuOpen}
              aria-controls="mobile-menu"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              onClick={() => setMenuOpen((o) => !o)}
            >
              {menuOpen ? <CloseIcon /> : <MenuIcon />}
            </button>
            {menuOpen && (
              <div id="mobile-menu" className="mobile-menu">
                <div className="brand-org">{me.org.name}</div>
                {nav}
              </div>
            )}
          </header>
          <main className="main" id="main" tabIndex={-1}>
            {children}
          </main>
        </div>
        {expired && <SessionExpiredDialog />}
      </ToastProvider>
    </SessionContext.Provider>
  );
}

/** Shown once any request reports the session ended. Unsaved form input was already kept as a draft. */
function SessionExpiredDialog() {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => button.current?.focus(), []);
  return (
    <div className="scrim">
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="expired-title" aria-describedby="expired-body">
        <h2 id="expired-title" className="heading">
          Your session expired
        </h2>
        <p id="expired-body">Sign in again to continue. Anything you were typing has been kept and will be restored.</p>
        <Button
          ref={button}
          onClick={() => window.location.assign(`/login?expired=1&next=${encodeURIComponent(currentPath())}`)}
        >
          Sign in again
        </Button>
      </div>
    </div>
  );
}
