// Minimal promise wrapper over one IndexedDB object store (key -> structured-cloneable value).
export const DB_NAME = 'plankton';
/** IndexedDB database of planboard 1.x (remembered Save file handles). */
export const LEGACY_DB_NAME = 'planboard';

/** `create: false` opens an existing database only (never creates an empty one). */
export function idbKV(dbName = DB_NAME, storeName = 'kv', { create = true } = {}) {
  let dbp = null;
  const open = () =>
    dbp ||
    (dbp = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') throw new Error('IndexedDB unavailable');
      const r = indexedDB.open(dbName, 1);
      r.onupgradeneeded = () => {
        if (!create) return r.transaction.abort();
        r.result.createObjectStore(storeName);
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  const run = (mode, fn) =>
    open().then(
      (db) =>
        new Promise((resolve, reject) => {
          const t = db.transaction(storeName, mode);
          const req = fn(t.objectStore(storeName));
          t.oncomplete = () => resolve(req.result);
          t.onerror = () => reject(t.error);
          t.onabort = () => reject(t.error);
        })
    );
  return {
    get: (k) => run('readonly', (s) => s.get(k)),
    set: (k, v) => run('readwrite', (s) => s.put(v, k)),
    del: (k) => run('readwrite', (s) => s.delete(k)),
  };
}

/**
 * A kv store that falls back to `legacy` (planboard 1.x) for keys it does not
 * have yet, copying a found value into the new store. Deletes clear both, so a
 * forgotten value cannot come back from the old store. Legacy failures are ignored.
 */
export function withLegacyKV(kv, legacy) {
  return {
    async get(k) {
      const v = await kv.get(k);
      if (v != null || !legacy) return v;
      let old;
      try {
        old = await legacy.get(k);
      } catch (e) {
        return v;
      }
      if (old == null) return v;
      try {
        await kv.set(k, old);
      } catch (e) {
        /* still usable this session */
      }
      return old;
    },
    set: (k, v) => kv.set(k, v),
    async del(k) {
      await kv.del(k);
      if (!legacy) return;
      try {
        await legacy.del(k);
      } catch (e) {
        /* ignore */
      }
    },
  };
}
