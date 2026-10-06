// Plan persistence in localStorage: one key per plan plus an index. The backing
// store is injectable so this module stays testable in Node.
import { normalizePlan, serializePlan } from '../model/plan.js';

const PREFIX = 'planboard:';
const INDEX = PREFIX + 'index';
const PREFS = PREFIX + 'prefs';

function memoryStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
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
