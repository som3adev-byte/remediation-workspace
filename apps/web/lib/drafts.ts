/**
 * Unsaved form input survives a session expiry: it is kept in sessionStorage (this tab
 * only, gone when the tab closes) under draft:<userId>:<target>, and restored only
 * for the same user. Another user's sign-in, or an explicit sign-out, deletes all drafts.
 * Storage can be blocked or full; every call is best-effort and never throws, so a
 * successful save or sign-in is never reported as a failure because of it.
 */
const PREFIX = 'draft:';
const key = (userId: string, target: string) => `${PREFIX}${userId}:${target}`;

const quietly = <T>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

export function saveDraft<T>(userId: string, target: string, values: T) {
  quietly(() => sessionStorage.setItem(key(userId, target), JSON.stringify(values)), undefined);
}

export function readDraft<T>(userId: string, target: string): T | null {
  return quietly(() => {
    const raw = sessionStorage.getItem(key(userId, target));
    return raw ? (JSON.parse(raw) as T) : null;
  }, null);
}

export function clearDraft(userId: string, target: string) {
  quietly(() => sessionStorage.removeItem(key(userId, target)), undefined);
}

const draftKeys = () => quietly(() => Object.keys(sessionStorage).filter((k) => k.startsWith(PREFIX)), [] as string[]);

/** After a sign-in: drop drafts that belong to anyone else. */
export function keepOnlyDraftsOf(userId: string) {
  for (const k of draftKeys()) if (!k.startsWith(`${PREFIX}${userId}:`)) quietly(() => sessionStorage.removeItem(k), undefined);
}

export function clearAllDrafts() {
  for (const k of draftKeys()) quietly(() => sessionStorage.removeItem(k), undefined);
}
