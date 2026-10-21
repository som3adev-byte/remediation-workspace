'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

const ToastContext = createContext<(message: string) => void>(() => {});
export const useToast = () => useContext(ToastContext);

/** Bottom-right, 4 seconds, announced politely, never takes focus. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((m: string) => {
    clearTimeout(timer.current);
    setMessage(m);
    timer.current = setTimeout(() => setMessage(null), 4000);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-region" aria-live="polite" role="status">
        {message && <div className="toast">{message}</div>}
      </div>
    </ToastContext.Provider>
  );
}
