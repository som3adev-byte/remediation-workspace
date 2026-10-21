/**
 * Unsaved form input survives a session expiry: it is kept in sessionStorage (this tab
 * only, gone when the tab closes) under draft:<userId>:<itemId|new>, and restored only
 * for the same user. Another user's sign-in, or an explicit sign-out, deletes all drafts.
 */
const PREFIX = 'draft:';
const key = (userId: string, target: string) => `${PREFIX}${userId}:${target}`;

export function saveDraft<T>(userId: string, target: string, values: T) {
  try {
    sessionStorage.setItem(key(userId, target), JSON.stringify(values));
  } catch {
    // Storage full or blocked: the draft is lost, nothing else breaks.
  }
}

export function readDraft<T>(userId: string, target: string): T | null {
  try {
    const raw = sessionStorage.getItem(key(userId, target));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function clearDraft(userId: string, target: string) {
  sessionStorage.removeItem(key(userId, target));
}

function draftKeys() {
  return Object.keys(sessionStorage).filter((k) => k.startsWith(PREFIX));
}

/** After a sign-in: drop drafts that belong to anyone else. */
export function keepOnlyDraftsOf(userId: string) {
  for (const k of draftKeys()) if (!k.startsWith(`${PREFIX}${userId}:`)) sessionStorage.removeItem(k);
}

export function clearAllDrafts() {
  for (const k of draftKeys()) sessionStorage.removeItem(k);
}
