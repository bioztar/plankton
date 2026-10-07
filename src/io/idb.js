// Minimal promise wrapper over one IndexedDB object store (key -> structured-cloneable value).
export function idbKV(dbName = 'planboard', storeName = 'kv') {
  let dbp = null;
  const open = () =>
    dbp ||
    (dbp = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') throw new Error('IndexedDB unavailable');
      const r = indexedDB.open(dbName, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(storeName);
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
