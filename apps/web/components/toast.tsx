'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

const ToastContext = createContext<(message: string) => void>(() => {});
export const useToast = () => useContext(ToastContext);

const SHOW_MS = 4000;
const LEAVE_MS = 150;

/** Bottom-right, 4 seconds, announced politely, never takes focus. The timer pauses while the tab is hidden. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const remaining = useRef(0);
  const startedAt = useRef(0);

  const schedule = useCallback((ms: number) => {
    clearTimeout(timer.current);
    remaining.current = ms;
    startedAt.current = Date.now();
    timer.current = setTimeout(() => {
      setLeaving(true);
      timer.current = setTimeout(() => setMessage(null), LEAVE_MS);
    }, ms);
  }, []);

  const show = useCallback(
    (m: string) => {
      setMessage(m);
      setLeaving(false);
      schedule(SHOW_MS);
    },
    [schedule],
  );

  useEffect(() => {
    const onVisibility = () => {
      if (!message || leaving) return;
      if (document.hidden) {
        clearTimeout(timer.current);
        remaining.current -= Date.now() - startedAt.current;
      } else {
        schedule(Math.max(remaining.current, 1000));
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [message, leaving, schedule]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-region" aria-live="polite" role="status">
        {message && (
          <div key={message} className={`toast ${leaving ? 'is-leaving' : ''}`}>
            {message}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
