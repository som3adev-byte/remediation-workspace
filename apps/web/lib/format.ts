const pad = (n: number) => String(n).padStart(2, '0');

/** Timestamps render in the browser's local time as YYYY-MM-DD HH:mm. Due dates are shown as-is. */
export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

export const ROLE_LABEL = { MANAGER: 'Manager', MEMBER: 'Member' } as const;
