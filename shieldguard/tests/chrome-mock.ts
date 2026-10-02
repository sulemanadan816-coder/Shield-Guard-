/** Minimal in-memory mock of chrome.storage.local for unit tests. */
export function installChromeStorageMock(): void {
  const store = new Map<string, unknown>();

  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (key: string) => {
          return { [key]: store.get(key) };
        },
        set: async (obj: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(obj)) store.set(k, v);
        },
        clear: async () => {
          store.clear();
        }
      }
    }
  };
}
