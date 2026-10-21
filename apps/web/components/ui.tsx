'use client';

import { STATUS_LABELS, type Status } from '@rw/shared';
import { forwardRef, useId, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ErrorIcon, InfoIcon, WarningIcon } from './icons';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary';
  loading?: boolean;
  loadingLabel?: string;
};

/** While loading the button keeps its size, shows a spinner and stays disabled (no double submit). */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', loading = false, loadingLabel = 'Saving…', disabled, children, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`btn btn-${variant} ${className ?? ''}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <>
          <span className="spinner" aria-hidden />
          {loadingLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
});

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`badge badge-${status.toLowerCase()}`}>{STATUS_LABELS[status]}</span>;
}

export function DueDate({ date, overdue }: { date: string; overdue: boolean }) {
  return (
    <span className={`due ${overdue ? 'is-overdue' : ''}`}>
      <span className="mono">{date}</span>
      {overdue && <span className="overdue-word">Overdue</span>}
    </span>
  );
}

const BANNER_ICON = { warning: WarningIcon, error: ErrorIcon, info: InfoIcon };

export function Banner({
  tone,
  children,
  action,
  reference,
}: {
  tone: 'warning' | 'error' | 'info';
  children: ReactNode;
  action?: ReactNode;
  reference?: string;
}) {
  const Icon = BANNER_ICON[tone];
  return (
    <div className={`banner banner-${tone}`} role={tone === 'info' ? 'status' : 'alert'}>
      <Icon className="banner-icon" />
      <div className="banner-text">
        <p>{children}</p>
        {reference && (
          <p className="banner-ref">
            Reference <span className="mono">{reference}</span>
          </p>
        )}
      </div>
      {action && <div className="banner-action">{action}</div>}
    </div>
  );
}

interface FieldProps {
  label: string;
  error?: string;
  hint?: ReactNode;
  count?: { value: number; max: number };
  children: (props: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string }) => ReactNode;
}

/** Label above, control, then the error (linked with aria-describedby) and an optional counter. */
export function Field({ label, error, hint, count, children }: FieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const over = count && count.value > count.max;
  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <label htmlFor={id} className="label">
        {label}
      </label>
      {hint && <p className="field-hint">{hint}</p>}
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': error ? errorId : undefined })}
      {(error || count) && (
        <div className="field-foot">
          {error ? (
            <p id={errorId} className="field-error">
              {error}
            </p>
          ) : (
            <span />
          )}
          {count && (
            <span className={`mono counter ${over ? 'is-over' : ''}`}>
              {count.value.toLocaleString('en-US')} / {count.max.toLocaleString('en-US')}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
