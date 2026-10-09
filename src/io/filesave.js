// Save the plan back into its own .html file. Pure pieces (save-state machine,
// handle keying, on-disk conflict check) plus a save flow whose browser APIs
// (showSaveFilePicker, download, confirm, handle registry) are injected.
import { extractPayload, payloadStamp } from './standalone.js';

// ---- save state: clean -> dirty -> saving -> saved | failed ----------------

/** `dirty`: the plan shown differs from the file it came from (e.g. newer browser edits). */
export function initialSaveState(dirty = false) {
  return { status: dirty ? 'dirty' : 'clean', rev: dirty ? 1 : 0, savedRev: 0, savingRev: null, savedAt: null, target: null, error: null };
}

export function saveReducer(s, ev) {
  switch (ev.type) {
    case 'edit':
      return { ...s, rev: s.rev + 1, status: s.status === 'saving' ? 'saving' : 'dirty' };
    case 'start':
      return { ...s, status: 'saving', savingRev: s.rev, error: null };
    case 'success': {
      const savedRev = s.savingRev == null ? s.rev : s.savingRev;
      return { ...s, savedRev, savingRev: null, savedAt: ev.at, target: ev.target || 'file', status: savedRev === s.rev ? 'saved' : 'dirty' };
    }
    case 'fail':
      return { ...s, savingRev: null, status: 'failed', error: ev.error || 'Save failed' };
    case 'cancel':
      return { ...s, savingRev: null, status: s.rev !== s.savedRev ? 'dirty' : s.savedAt ? 'saved' : 'clean' };
    case 'reset':
      return initialSaveState(!!ev.dirty);
    default:
      return s;
  }
}

/** Edits not yet written to a file (drives the beforeunload prompt). */
export const hasUnsaved = (s) => s.rev !== s.savedRev;

const hhmm = (t) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export function saveStatusText(s, fmtTime = hhmm) {
  switch (s.status) {
    case 'dirty':
      return 'Unsaved changes';
    case 'saving':
      return 'Saving…';
    case 'saved':
      return `${s.target === 'download' ? 'Downloaded' : 'Saved to file'} ${fmtTime(s.savedAt)}`;
    case 'failed':
      return 'Save failed';
    default:
      return 'No unsaved changes';
  }
}

// ---- handle persistence ----------------------------------------------------

/** The page address without query or hash: one remembered handle per plan per opened file. */
export function pageKey(href) {
  return String(href || '').replace(/[?#].*$/, '');
}

export function handleKey(planId, href) {
  return `${planId}@${pageKey(href)}`;
}

/** File name to suggest on first Save: the opened file's own name, else the fallback. */
export function suggestedFileName(href, fallback) {
  try {
    const seg = decodeURIComponent(new URL(href).pathname.split('/').pop() || '');
    if (/\.html?$/i.test(seg)) return seg;
  } catch (e) {
    /* not a URL */
  }
  return fallback;
}

const within = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

/**
 * kv: { get(k), set(k, v), del(k) } returning promises (IndexedDB in the browser).
 * Never throws; a store that hangs (e.g. blocked IndexedDB) times out after `ms`.
 */
export function createHandleRegistry(kv, ms = 3000) {
  return {
    async get(planId, href) {
      try {
        const r = await within(kv.get(handleKey(planId, href)), ms);
        return r && r.handle ? r : null;
      } catch (e) {
        return null;
      }
    },
    async put(planId, href, handle, stamp) {
      try {
        await within(kv.set(handleKey(planId, href), { planId, page: pageKey(href), handle, name: handle.name || '', stamp: stamp || null }), ms);
        return true;
      } catch (e) {
        return false;
      }
    },
    async forget(planId, href) {
      try {
        await within(kv.del(handleKey(planId, href)), ms);
      } catch (e) {
        /* ignore */
      }
    },
  };
}

// ---- conflict check --------------------------------------------------------

/**
 * Before overwriting a remembered file: does it still hold a version this tab has
 * seen? `known` = stamps of the payload this page opened, the remembered save and
 * saves made from this tab. Returns null (safe) or { kind: 'changed'|'other', ... }.
 */
export function diskConflict(diskText, planId, known) {
  if (!diskText || !diskText.trim()) return null;
  const p = extractPayload(diskText);
  if (!p || !p.plan) return { kind: 'other', name: '' };
  if (p.plan.id !== planId) return { kind: 'other', name: p.plan.name || '' };
  const stamp = payloadStamp(p);
  if (stamp && known.has(stamp)) return null;
  return { kind: 'changed', name: p.plan.name || '', stamp };
}

// ---- save flow -------------------------------------------------------------

async function ensurePermission(h) {
  const opts = { mode: 'readwrite' };
  try {
    if (typeof h.queryPermission !== 'function') return 'granted';
    let p = await h.queryPermission(opts);
    if (p === 'prompt' && typeof h.requestPermission === 'function') p = await h.requestPermission(opts);
    return p;
  } catch (e) {
    return 'denied';
  }
}

const PICKER_TYPES = [{ description: 'PLANkton plan (HTML)', accept: { 'text/html': ['.html', '.htm'] } }];

/**
 * env: { showSaveFilePicker (null when unsupported), registry, href, download(name, text),
 *        confirm(conflict) -> 'overwrite'|'saveas'|'cancel',
 *        explain() -> true to continue (optional; shown before the one-time picker of a plain Save) }
 * save() resolves { status: 'saved'|'downloaded'|'cancelled'|'failed', name?, reason?, error?, picked? }.
 * A remembered handle is written silently; permission "prompt" asks via requestPermission
 * (a small allow prompt, not a picker). Only a Save without any handle, or Save as, opens the picker.
 */
export function createFileSaver(env) {
  const supported = typeof env.showSaveFilePicker === 'function';
  let planId = null;
  let handle = null;
  let known = new Set();
  let ready = Promise.resolve();

  // o.html may be a function (diskPayload | null) => html, called once with the
  // same plan's payload read from the target file (to merge its history).
  const render = async (o, disk = null) => (typeof o.html === 'function' ? o.html(disk) : o.html);
  const fallback = async (o, reason) => {
    env.download(o.downloadName, await render(o));
    return { status: 'downloaded', name: o.downloadName, reason };
  };
  const samePlan = (text, id) => {
    const p = text ? extractPayload(text) : null;
    return p && p.plan && p.plan.id === id ? p : null;
  };

  return {
    supported,
    get fileName() {
      return handle ? handle.name : '';
    },
    get connected() {
      return !!handle;
    },
    /** Remember `h` (e.g. from File › Open & connect file…) as the file of the bound plan. */
    async connect(id, h, stamp) {
      await ready;
      if (id !== planId) return false;
      handle = h;
      if (stamp) known.add(stamp);
      await env.registry.put(id, env.href, h, stamp);
      return true;
    },
    /** Point at a plan: loads its remembered handle. `openedStamp` = stamp of the file payload shown. */
    bind(id, openedStamp) {
      planId = id;
      handle = null;
      known = new Set(openedStamp ? [openedStamp] : []);
      if (!supported) return ready;
      ready = env.registry.get(id, env.href).then((rec) => {
        if (planId !== id || !rec) return;
        handle = rec.handle;
        if (rec.stamp) known.add(rec.stamp);
      });
      return ready;
    },
    /** o: { planId, html, stamp, saveAs, suggestedName, downloadName } */
    async save(o) {
      if (!supported) return fallback(o, 'unsupported');
      await ready;
      let h = o.saveAs || o.planId !== planId ? null : handle;
      let disk = null;
      if (h) {
        if ((await ensurePermission(h)) !== 'granted') return fallback(o, 'denied');
        let text = null;
        try {
          text = await (await h.getFile()).text();
        } catch (e) {
          if (e && e.name === 'NotFoundError') {
            h = null;
            await env.registry.forget(o.planId, env.href);
          }
        }
        const c = h && text != null ? diskConflict(text, o.planId, known) : null;
        if (c) {
          const choice = await env.confirm({ ...c, fileName: h.name });
          if (choice === 'saveas') h = null;
          else if (choice !== 'overwrite') return { status: 'cancelled' };
        }
        if (h) disk = samePlan(text, o.planId);
      }
      let picked = false;
      if (!h) {
        if (!o.saveAs && env.explain && !(await env.explain())) return { status: 'cancelled' };
        picked = true;
        try {
          h = await env.showSaveFilePicker({ suggestedName: o.suggestedName, types: PICKER_TYPES, id: 'plankton' });
        } catch (e) {
          if (e && e.name === 'AbortError') return { status: 'cancelled' };
          return fallback(o, 'picker');
        }
        try {
          disk = samePlan(await (await h.getFile()).text(), o.planId);
        } catch (e) {
          /* new or unreadable file: nothing to merge */
        }
      }
      const html = await render(o, disk);
      try {
        const w = await h.createWritable();
        await w.write(html);
        await w.close();
      } catch (e) {
        if (e && e.name === 'NotAllowedError') return fallback(o, 'denied');
        return { status: 'failed', name: h.name, error: (e && e.message) || String(e) };
      }
      if (o.planId === planId) {
        handle = h;
        known.add(o.stamp);
      }
      await env.registry.put(o.planId, env.href, h, o.stamp);
      return { status: 'saved', name: h.name, picked };
    },
  };
}
