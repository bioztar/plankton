// Interactive Gantt chart: virtualised SVG window, drag to move / resize bars,
// drag between bar handles to create links, click links to edit them.
import { renderGantt, renderHeader, HEADER_H, barGeom } from './render.js';
import { projectRange, fitPpd, ZOOMS } from './scale.js';
import { moveTaskBy, resizeTaskTo, addLink } from '../../model/edit.js';
import { parseISO, toISO, nextWorkday, prevWorkday } from '../../schedule/calendar.js';
import { fmtDateLong } from '../format.js';
import { openLinkEditor } from '../dialogs/link.js';

const OVERSCAN = 10;

export function createGantt(app, root) {
  const store = app.store;
  root.innerHTML = `<div class="gt-scroll" aria-label="Gantt chart"><div class="gt-head"></div><div class="gt-body"><div class="gt-win"></div><svg class="gt-over" aria-hidden="true"><path class="gt-tmp" d=""/></svg><div class="gt-tip" hidden></div></div></div>`;
  const scroll = root.querySelector('.gt-scroll');
  const head = root.querySelector('.gt-head');
  const body = root.querySelector('.gt-body');
  const winEl = root.querySelector('.gt-win');
  const over = root.querySelector('.gt-over');
  const tmp = root.querySelector('.gt-tmp');
  const tip = root.querySelector('.gt-tip');
  let range = null;
  let ppd = 16;
  let width = 0;
  let win = { from: -1, to: -1 };
  let lastZoom = null;
  let firstRender = true;

  const rowH = () => app.rowH();

  function layout() {
    const d = store.d;
    range = projectRange(d.tree.tasks, app.todayDay());
    const z = store.plan.settings.zoom;
    ppd = z === 'fit' ? fitPpd(range, Math.max(200, scroll.clientWidth - 4)) : ZOOMS[z] || ZOOMS.week;
    width = Math.ceil((range.end - range.start + 1) * ppd);
  }

  function render() {
    const prev = range && { start: range.start, ppd };
    const centerDay = prev ? prev.start + (scroll.scrollLeft + scroll.clientWidth / 2) / prev.ppd : null;
    layout();
    head.style.width = `${width}px`;
    head.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="gsvg" width="${width}" height="${HEADER_H}">${renderHeader(range, ppd, width, { todayDay: app.todayDay() })}</svg>`;
    body.style.width = `${width}px`;
    body.style.height = `${store.d.visible.length * rowH() + 40}px`;
    over.setAttribute('width', width);
    over.setAttribute('height', store.d.visible.length * rowH() + 40);
    const zoomKey = `${store.plan.settings.zoom}:${ppd.toFixed(3)}`;
    if (firstRender) {
      firstRender = false;
      requestAnimationFrame(() => scrollToDay(app.todayDay() - 7 * (ppd >= 10 ? 1 : 4), 'start'));
    } else if (lastZoom && zoomKey !== lastZoom && centerDay != null) {
      scroll.scrollLeft = Math.max(0, (centerDay - range.start) * ppd - scroll.clientWidth / 2);
    } else if (prev && prev.start !== range.start) {
      scroll.scrollLeft += (prev.start - range.start) * ppd;
    }
    lastZoom = zoomKey;
    renderWindow(true);
  }

  function renderWindow(force) {
    if (!range) return;
    const h = rowH();
    const n = store.d.visible.length;
    const first = Math.floor(scroll.scrollTop / h);
    const from = Math.max(0, first - OVERSCAN);
    const to = Math.min(n, first + Math.ceil(scroll.clientHeight / h) + OVERSCAN);
    if (!force && from === win.from && to === win.to) return;
    win = { from, to };
    const d = store.d;
    const s = store.plan.settings;
    const { svg } = renderGantt({
      rows: d.visible,
      tree: d.tree,
      from,
      to,
      range,
      ppd,
      rowH: h,
      indexOf: d.indexOf,
      sectionColor: d.sectionColor,
      critical: d.critical,
      conflicts: d.conflictKeys,
      showBaseline: s.showBaseline,
      labelMode: s.labelMode,
      selection: store.selection,
      todayDay: app.todayDay(),
      interactive: !store.readOnly,
      prefix: 'g',
    });
    winEl.style.top = `${from * h}px`;
    winEl.innerHTML = svg;
  }

  function scrollToDay(day, where = 'center') {
    if (!range) return;
    const x = (day - range.start) * ppd;
    scroll.scrollLeft = Math.max(0, where === 'start' ? x : x - scroll.clientWidth / 2);
  }

  // ---- pointer interactions ---------------------------------------------
  let act = null;
  let suppressClick = false;
  const bodyPoint = (e) => {
    const r = body.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const showTip = (text, p) => {
    tip.hidden = false;
    tip.textContent = text;
    tip.style.left = `${p.x + 14}px`;
    tip.style.top = `${p.y + 16}px`;
  };

  winEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const bar = e.target.closest('.bar');
    if (!bar) return;
    const id = Number(bar.dataset.id);
    const t = store.d.tree.byId.get(id);
    if (!t) return;
    if (store.readOnly) return;
    const cl = e.target.classList;
    const summary = store.d.tree.isSummary(id);
    const mode = cl.contains('hd') ? 'link' : cl.contains('rz') && !summary && !t.milestone ? 'resize' : 'move';
    const rect = bar.querySelector('rect.b');
    act = {
      mode, id, t, bar, x0: e.clientX, y0: e.clientY, dd: 0, moved: false, handle: e.target.dataset.h,
      w0: rect ? Number(rect.getAttribute('width')) : 0, rect,
      hx: cl.contains('hd') ? Number(e.target.getAttribute('cx')) : 0,
      hy: cl.contains('hd') ? Number(e.target.getAttribute('cy')) + win.from * rowH() : 0,
    };
    e.preventDefault();
    try {
      winEl.setPointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }
  });

  winEl.addEventListener('pointermove', (e) => {
    if (!act) return;
    const dx = e.clientX - act.x0;
    if (!act.moved && Math.abs(dx) < 4 && Math.abs(e.clientY - act.y0) < 4) return;
    act.moved = true;
    const p = bodyPoint(e);
    if (act.mode === 'move') {
      act.dd = Math.round(dx / ppd);
      act.bar.setAttribute('transform', `translate(${act.dd * ppd},0)`);
      const ns = nextWorkday(parseISO(act.t.start) + act.dd);
      showTip(`Start ${fmtDateLong(toISO(ns))}`, p);
    } else if (act.mode === 'resize') {
      act.dd = Math.round(dx / ppd);
      if (act.rect) act.rect.setAttribute('width', Math.max(ppd, act.w0 + act.dd * ppd));
      const nf = Math.max(parseISO(act.t.start), prevWorkday(parseISO(act.t.finish) + act.dd));
      showTip(`Finish ${fmtDateLong(toISO(nf))}`, p);
    } else {
      tmp.setAttribute('d', `M${act.hx},${act.hy}L${p.x},${p.y}`);
      winEl.querySelectorAll('.link-target').forEach((n) => n.classList.remove('link-target'));
      const tgt = targetBar(e);
      if (tgt && tgt.id !== act.id) {
        tgt.el.classList.add('link-target');
        showTip(`${linkType(act.handle, tgt, p)} link to ${store.d.tree.outline.get(tgt.id)}`, p);
      } else tip.hidden = true;
    }
  });

  function targetBar(e) {
    const n = document.elementFromPoint(e.clientX, e.clientY);
    const el = n && n.closest && n.closest('.gt-win .bar');
    return el ? { el, id: Number(el.dataset.id) } : null;
  }
  function linkType(handle, tgt, p) {
    const t = store.d.tree.byId.get(tgt.id);
    const g = barGeom(t, range, ppd);
    const toStart = p.x < g.cx;
    const fromStart = handle === 'start';
    return fromStart ? (toStart ? 'SS' : 'SF') : toStart ? 'FS' : 'FF';
  }

  const finish = (e, cancel) => {
    if (!act) return;
    const a = act;
    act = null;
    tip.hidden = true;
    tmp.setAttribute('d', '');
    winEl.querySelectorAll('.link-target').forEach((n) => n.classList.remove('link-target'));
    if (!a.moved) {
      if (a.mode !== 'link') app.select(a.id, { col: 'name', keepCard: true });
      return;
    }
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 0);
    if (cancel) return renderWindow(true);
    if (a.mode === 'move') {
      if (!a.dd) return renderWindow(true);
      store.commit('Move task', (plan) => (moveTaskBy(plan.rows, a.id, a.dd) ? undefined : false));
    } else if (a.mode === 'resize') {
      if (!a.dd) return renderWindow(true);
      store.commit('Resize task', (plan) => {
        const t = plan.rows.find((r) => r.id === a.id);
        resizeTaskTo(t, prevWorkday(parseISO(t.finish) + a.dd));
      });
    } else {
      const tgt = targetBar(e);
      if (!tgt || tgt.id === a.id) return undefined;
      const type = linkType(a.handle, tgt, bodyPoint(e));
      const ok = store.commit('Add link', (plan) => addLink(plan.rows, a.id, tgt.id, type, 0) || undefined);
      if (ok) {
        const o = store.d.tree.outline;
        app.toast(`Linked ${o.get(a.id)} → ${o.get(tgt.id)} (${type}). Click the arrow to change type or lag.`);
      }
    }
    return undefined;
  };
  winEl.addEventListener('pointerup', (e) => finish(e, false));
  winEl.addEventListener('pointercancel', (e) => finish(e, true));
  winEl.addEventListener('lostpointercapture', (e) => act && finish(e, false));

  winEl.addEventListener('click', (e) => {
    if (suppressClick) return;
    const lk = e.target.closest('.lk');
    if (lk) {
      const [p, s] = lk.dataset.link.split('>').map(Number);
      openLinkEditor(app, p, s);
      return;
    }
    if (store.readOnly) {
      const bar = e.target.closest('.bar');
      if (bar) app.select(Number(bar.dataset.id), { col: 'name', keepCard: true });
    }
  });
  winEl.addEventListener('dblclick', (e) => {
    const bar = e.target.closest('.bar');
    if (bar) app.openCard(Number(bar.dataset.id));
  });

  scroll.addEventListener('scroll', () => {
    app.syncScroll('gantt', scroll.scrollTop);
    renderWindow();
  });

  return {
    el: root,
    render,
    renderWindow,
    scrollToDay,
    metrics: () => ({ range, ppd, width }),
    setScrollTop(top) {
      if (Math.abs(scroll.scrollTop - top) > 0.5) scroll.scrollTop = top;
      renderWindow();
    },
  };
}
