/**
 * tour-storage — flag round-trip + defensive fallbacks.
 *
 * The tour surface is a UX polish path; localStorage can throw
 * (Safari private mode, third-party-cookie blocking). Any of these
 * failures must degrade to "flag not set" so the tour has a chance
 * to run, not blow up the app.
 *
 * We mock `globalThis.window` directly (instead of pulling in
 * jsdom) so this test stays in the fast node runner alongside the
 * rest of the lib suite.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Minimal in-memory localStorage mock. We only need the three
// methods the module touches: getItem, setItem, removeItem.
interface StorageStub {
  store: Map<string, string>;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
}

function makeStorageStub(): StorageStub {
  const store = new Map<string, string>();
  return {
    store,
    getItem(key) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key, value) {
      store.set(key, value);
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
}

let originalWindow: unknown;

beforeEach(async () => {
  originalWindow = (globalThis as Record<string, unknown>).window;
  const storage = makeStorageStub();
  (globalThis as Record<string, unknown>).window = { localStorage: storage };
});

afterEach(() => {
  (globalThis as Record<string, unknown>).window = originalWindow;
});

async function loadModule() {
  // Re-import fresh so we don't share module state across tests.
  // vi.resetModules requires the vi import; simpler to just use a
  // dynamic import inside each test since the module has no state
  // beyond the one function reference.
  return await import('@/lib/onboarding/tour-storage');
}

describe('tour-storage', () => {
  it('returns false when no flag is set', async () => {
    const { hasCompletedTour } = await loadModule();
    expect(hasCompletedTour()).toBe(false);
  });

  it('writes and reads the flag', async () => {
    const { hasCompletedTour, markTourCompleted } = await loadModule();
    markTourCompleted();
    expect(hasCompletedTour()).toBe(true);
  });

  it('clears the flag', async () => {
    const { hasCompletedTour, markTourCompleted, clearTourFlag } =
      await loadModule();
    markTourCompleted();
    clearTourFlag();
    expect(hasCompletedTour()).toBe(false);
  });

  it('uses the documented key', async () => {
    const { markTourCompleted, TOUR_STORAGE_KEY } = await loadModule();
    expect(TOUR_STORAGE_KEY).toBe('vizzor.tour.completed_at');
    markTourCompleted();
    const win = (globalThis as unknown as { window: { localStorage: StorageStub } }).window;
    const raw = win.localStorage.getItem('vizzor.tour.completed_at');
    expect(raw).not.toBeNull();
    expect(Number(raw)).toBeGreaterThan(0);
  });

  it('is safe when localStorage.getItem throws', async () => {
    const win = (globalThis as unknown as { window: { localStorage: StorageStub } }).window;
    const origGet = win.localStorage.getItem.bind(win.localStorage);
    win.localStorage.getItem = () => {
      throw new Error('QuotaExceededError');
    };
    const { hasCompletedTour } = await loadModule();
    expect(() => hasCompletedTour()).not.toThrow();
    expect(hasCompletedTour()).toBe(false);
    win.localStorage.getItem = origGet;
  });

  it('is safe when localStorage.setItem throws', async () => {
    const win = (globalThis as unknown as { window: { localStorage: StorageStub } }).window;
    const origSet = win.localStorage.setItem.bind(win.localStorage);
    win.localStorage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    const { markTourCompleted } = await loadModule();
    expect(() => markTourCompleted()).not.toThrow();
    win.localStorage.setItem = origSet;
  });

  it('returns false in SSR (no window)', async () => {
    delete (globalThis as Record<string, unknown>).window;
    const { hasCompletedTour } = await loadModule();
    expect(hasCompletedTour()).toBe(false);
  });
});
