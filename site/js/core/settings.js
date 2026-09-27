// Persisted user settings (theme, language, dataset choices). Stored in localStorage, which
// can be unavailable (private mode, blocked storage), so every access is guarded and the
// app works with defaults. Datasets keep their own settings under a namespace.

export function createSettings(storageKey, defaults, storage = safeStorage()) {
  let values = { ...defaults, ...read() };
  const listeners = new Set();

  function read() {
    try { return JSON.parse(storage?.getItem(storageKey) || '{}'); } catch { return {}; }
  }
  function write() {
    try { storage?.setItem(storageKey, JSON.stringify(values)); } catch { /* storage unavailable */ }
  }

  return {
    get: (key) => values[key],
    set(key, value) {
      values = { ...values, [key]: value };
      write();
      listeners.forEach(fn => fn(key, value));
    },
    /** A namespaced view for one dataset: its settings live under values[ns]. */
    scope(ns, scopedDefaults) {
      const parent = this;
      const current = () => ({ ...scopedDefaults, ...(values[ns] ?? {}) });
      return {
        get: (key) => current()[key],
        set: (key, value) => parent.set(ns, { ...current(), [key]: value }),
      };
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

function safeStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}
