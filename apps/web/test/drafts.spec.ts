import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearAllDrafts, clearDraft, keepOnlyDraftsOf, readDraft, saveDraft } from '@/lib/drafts';

describe('drafts when the browser blocks storage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('never throws, so a successful save or sign-in is not reported as a failure', () => {
    const blocked = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(blocked);
    vi.spyOn(Object, 'keys').mockImplementationOnce(blocked);
    expect(() => saveDraft('u1', 'new', { a: 1 })).not.toThrow();
    expect(readDraft('u1', 'new')).toBeNull();
    expect(() => clearDraft('u1', 'new')).not.toThrow();
    expect(() => keepOnlyDraftsOf('u1')).not.toThrow();
    expect(() => clearAllDrafts()).not.toThrow();
  });
});
