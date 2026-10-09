// Plan persistence in localStorage: one key per plan plus an index. The backing
// store is injectable so this module stays testable in Node.
import { normalizePlan, serializePlan } from '../model/plan.js';

const PREFIX = 'plankton:';
const INDEX = PREFIX + 'index';
const PREFS = PREFIX + 'prefs';
/** Keys written by planboard 1.x (the app's former name). */
export const LEGACY_PREFIX = 'planboard:';

export function memoryStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

function legacyKeys(store) {
  const keys = new Set();
  try {
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (typeof k === 'string' && k.startsWith(LEGACY_PREFIX)) keys.add(k);
    }
  } catch (e) {
    /* store cannot enumerate: fall back to the legacy index */
  }
  try {
    const idx = JSON.parse(store.getItem(LEGACY_PREFIX + 'index') || 'null');
    if (idx && Array.isArray(idx.plans)) for (const p of idx.plans) if (p && typeof p.id === 'string') keys.add(LEGACY_PREFIX + 'plan:' + p.id);
  } catch (e) {
    /* unreadable index */
  }
  for (const k of ['index', 'prefs']) keys.add(LEGACY_PREFIX + k);
  keys.delete(LEGACY_PREFIX + 'probe');
  return [...keys];
}

/**
 * One-time upgrade from planboard 1.x: while this browser has no PLANkton index
 * yet, copy every `planboard:*` key (plans, index, prefs such as theme and author
 * name) to `plankton:*`. Existing new keys are never overwritten and the old keys
 * are kept, so an older planboard file still finds its data. When storage is too
 * full for a copy, that key is moved instead. The index is written last, so an
 * interrupted migration is retried on the next load. Returns the keys migrated.
 */
export function migrateLegacyStorage(store) {
  try {
    if (store.getItem(INDEX) != null) return 0;
    const keys = legacyKeys(store).filter((k) => store.getItem(k) != null);
    if (!keys.length) return 0;
    const idx = LEGACY_PREFIX + 'index';
    keys.sort((a, b) => (a === idx) - (b === idx));
    let n = 0;
    for (const k of keys) {
      const nk = PREFIX + k.slice(LEGACY_PREFIX.length);
      if (store.getItem(nk) != null) continue;
      const v = store.getItem(k);
      try {
        store.setItem(nk, v);
      } catch (e) {
        store.removeItem(k);
        try {
          store.setItem(nk, v);
        } catch (e2) {
          store.setItem(k, v);
          continue;
        }
      }
      n++;
    }
    return n;
  } catch (e) {
    return 0;
  }
}

export function defaultStore() {
  try {
    const s = globalThis.localStorage;
    const k = PREFIX + 'probe';
    s.setItem(k, '1');
    s.removeItem(k);
    return { store: s, persistent: true };
  } catch (e) {
    return { store: memoryStore(), persistent: false };
  }
}

export function createStorage(store = memoryStore()) {
  migrateLegacyStorage(store);
  const readJSON = (k, dflt) => {
    try {
      const v = store.getItem(k);
      return v ? JSON.parse(v) : dflt;
    } catch (e) {
      return dflt;
    }
  };
  const api = {
    index() {
      const idx = readJSON(INDEX, null);
      return idx && Array.isArray(idx.plans) ? idx : { current: null, plans: [] };
    },
    writeIndex(idx) {
      store.setItem(INDEX, JSON.stringify(idx));
    },
    list() {
      return api.index().plans;
    },
    load(id) {
      const raw = readJSON(PREFIX + 'plan:' + id, null);
      if (!raw) return null;
      try {
        return normalizePlan(raw);
      } catch (e) {
        return null;
      }
    },
    /** Returns false when the browser refuses (quota). */
    save(plan) {
      try {
        store.setItem(PREFIX + 'plan:' + plan.id, serializePlan(plan, false));
        const idx = api.index();
        const entry = { id: plan.id, name: plan.name, updatedAt: plan.updatedAt };
        const i = idx.plans.findIndex((p) => p.id === plan.id);
        if (i >= 0) idx.plans[i] = entry;
        else idx.plans.push(entry);
        idx.current = plan.id;
        api.writeIndex(idx);
        return true;
      } catch (e) {
        return false;
      }
    },
    remove(id) {
      store.removeItem(PREFIX + 'plan:' + id);
      const idx = api.index();
      idx.plans = idx.plans.filter((p) => p.id !== id);
      if (idx.current === id) idx.current = idx.plans.length ? idx.plans[0].id : null;
      api.writeIndex(idx);
    },
    setCurrent(id) {
      const idx = api.index();
      idx.current = id;
      api.writeIndex(idx);
    },
    prefs() {
      return readJSON(PREFS, {});
    },
    setPrefs(p) {
      try {
        store.setItem(PREFS, JSON.stringify({ ...api.prefs(), ...p }));
      } catch (e) {
        /* ignore */
      }
    },
  };
  return api;
}
