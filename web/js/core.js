import { icon } from './icons.js';

// ---------- DOM ----------
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  add(el, kids);
  return el;
}
function add(el, kids) {
  for (const k of kids) {
    if (k === null || k === undefined || k === false) continue;
    if (Array.isArray(k)) add(el, k);
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export const clear = (el) => { while (el.firstChild) el.firstChild.remove(); return el; };
// Leeren und neu befüllen; null/false-Kinder werden ignoriert (anders als Element.append)
export const fill = (el, ...kids) => { clear(el); add(el, kids); return el; };
export const $ = (sel, root = document) => root.querySelector(sel);

export function btn(label, opts = {}) {
  const b = h('button', { type: opts.type || 'button', class: 'btn ' + (opts.cls || ''), title: opts.title, disabled: opts.disabled,
    'aria-label': opts.aria || (label ? null : opts.title) },
    opts.icon ? icon(opts.icon, opts.iconSize || 16) : null, label);
  if (opts.onclick) b.addEventListener('click', async (e) => {
    if (b.dataset.busy) return;
    const r = opts.onclick(e);
    if (r && typeof r.then === 'function') {
      b.dataset.busy = '1'; const prev = b.disabled; b.disabled = true;
      try { await r; } catch (err) { toast(err.message, 'bad'); } finally { delete b.dataset.busy; b.disabled = prev; }
    }
  });
  return b;
}

// ---------- API ----------
export async function api(method, url, body, opts = {}) {
  const init = { method, headers: { 'x-fpanel': '1' }, credentials: 'same-origin' };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) { init.body = JSON.stringify(body); init.headers['content-type'] = 'application/json'; }
  const r = await fetch(url, init);
  if (r.status === 401 && !opts.allow401) { location.hash = '#/login'; throw new Error('Bitte erneut anmelden.'); }
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) {
    let msg = (data && data.detail) || r.statusText;
    if (Array.isArray(msg)) msg = msg.map((d) => d.msg).join('; ');
    throw new Error(msg);
  }
  return data;
}
export const get = (u) => api('GET', u);
export const post = (u, b = {}) => api('POST', u, b);
export const put = (u, b) => api('PUT', u, b);
export const patch = (u, b) => api('PATCH', u, b);
export const del = (u, b) => api('DELETE', u, b);

// Upload mit Fortschritt (XHR, weil fetch keinen Upload-Fortschritt kennt)
export function upload(url, files, extra = {}, onProgress) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(extra)) fd.append(k, v);
    for (const f of files) fd.append('upload', f, f.name);
    const x = new XMLHttpRequest();
    x.open('POST', url);
    x.setRequestHeader('x-fpanel', '1');
    x.upload.onprogress = (e) => e.lengthComputable && onProgress && onProgress(e.loaded / e.total);
    x.onload = () => {
      let d; try { d = JSON.parse(x.responseText); } catch { d = {}; }
      x.status < 300 ? resolve(d) : reject(new Error(d.detail || `Upload fehlgeschlagen (${x.status})`));
    };
    x.onerror = () => reject(new Error('Upload abgebrochen'));
    x.send(fd);
  });
}

// ---------- Live-Events ----------
const listeners = new Set();
let ws, wsTimer;
export function onEvent(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function connectEvents() {
  if (ws && ws.readyState <= 1) return;
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/events`);
  ws.onmessage = (m) => { const ev = JSON.parse(m.data); listeners.forEach((fn) => fn(ev)); };
  ws.onclose = (e) => { if (e.code !== 4401) { clearTimeout(wsTimer); wsTimer = setTimeout(connectEvents, 2000); } };
}
export function disconnectEvents() { clearTimeout(wsTimer); if (ws) { ws.onclose = null; ws.close(); ws = null; } }

// ---------- Format ----------
export function bytes(n, digits = 1) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i === 0 ? 0 : digits).replace('.', ',')} ${u[i]}`;
}
export const mb = (m) => (m >= 1024 ? `${(m / 1024).toFixed(m % 1024 ? 1 : 0).replace('.', ',')} GB` : `${m} MB`);
export function ago(ts) {
  if (!ts) return '–';
  const s = Date.now() / 1000 - ts;
  if (s < 60) return 'gerade eben';
  if (s < 3600) return `vor ${Math.floor(s / 60)} min`;
  if (s < 86400) return `vor ${Math.floor(s / 3600)} h`;
  if (s < 86400 * 30) return `vor ${Math.floor(s / 86400)} Tagen`;
  return new Date(ts * 1000).toLocaleDateString('de-DE');
}
export function dt(ts) {
  return new Date(ts * 1000).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function uptime(since) {
  if (!since) return '';
  let s = Math.max(0, Math.floor(Date.now() / 1000 - since));
  const d = Math.floor(s / 86400); s %= 86400;
  const hh = Math.floor(s / 3600); s %= 3600;
  const m = Math.floor(s / 60);
  return d ? `${d} d ${hh} h` : hh ? `${hh} h ${m} min` : `${m} min`;
}
export const STATE_TEXT = { running: 'Läuft', starting: 'Startet', stopping: 'Stoppt', stopped: 'Gestoppt', crashed: 'Abgestürzt' };
export const lamp = (state) => h('span', { class: `lamp ${state}`, title: STATE_TEXT[state] || state });

// ---------- Graph (Stromnetz-Stil: Stufenlinie auf punktiertem Raster) ----------
export function graph(values, max, { height = 56, step = true } = {}) {
  const W = 300, H = height, n = 150;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'graph'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('preserveAspectRatio', 'none');
  for (const f of [0.25, 0.5, 0.75]) {
    const l = document.createElementNS(NS, 'line');
    l.setAttribute('class', 'gridline'); l.setAttribute('x1', 0); l.setAttribute('x2', W);
    l.setAttribute('y1', H * f); l.setAttribute('y2', H * f); svg.append(l);
  }
  const vals = values.slice(-n);
  if (vals.length > 1) {
    const top = Math.max(max || 0, ...vals, 1e-9);
    const dx = W / (n - 1); const off = (n - vals.length) * dx;
    const y = (v) => H - 1 - (Math.min(v, top) / top) * (H - 3);
    let d = `M${off},${y(vals[0])}`;
    vals.forEach((v, i) => { if (i === 0) return; const x = off + i * dx; d += step ? `H${x}V${y(v)}` : `L${x},${y(v)}`; });
    const area = document.createElementNS(NS, 'path');
    area.setAttribute('class', 'area'); area.setAttribute('d', `${d}V${H}H${off}Z`);
    const line = document.createElementNS(NS, 'path');
    line.setAttribute('class', 'line'); line.setAttribute('d', d);
    svg.append(area, line);
  }
  return svg;
}

// ---------- Meldungen ----------
let toastBox;
export function toast(text, kind = 'ok', sub) {
  toastBox = toastBox || document.body.appendChild(h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }));
  const t = h('div', { class: `toast ${kind}` }, icon(kind === 'bad' ? 'warn' : kind === 'info' ? 'info' : 'check'),
    h('div', { class: 'body' }, h('b', null, text), sub ? h('small', null, sub) : null));
  toastBox.append(t);
  setTimeout(() => t.remove(), kind === 'bad' ? 7000 : 3500);
}
export function taskToast() {
  toastBox = toastBox || document.body.appendChild(h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }));
  const t = h('div', { class: 'toast' });
  toastBox.prepend(t);
  return t;
}

// ---------- Dialoge ----------
export function modal({ title, body, actions = [], wide = false, onclose }) {
  const close = () => { bd.remove(); document.removeEventListener('keydown', esc); onclose && onclose(); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  const dlg = h('div', { class: 'dialog' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('header', null, h('h2', null, title), btn('', { icon: 'x', cls: 'ghost icon sm', title: 'Schließen', onclick: close })),
    h('div', { class: 'body' }, body),
    actions.length ? h('footer', null, actions.map((a) => (a instanceof Node ? a : btn(a.label, {
      cls: a.cls, icon: a.icon, onclick: async () => { const r = await a.onclick?.(); if (r !== false) close(); },
    })))) : null);
  const bd = h('div', { class: 'backdrop', onmousedown: (e) => { if (e.target === bd) close(); } }, dlg);
  document.body.append(bd);
  document.addEventListener('keydown', esc);
  setTimeout(() => (dlg.querySelector('[autofocus], input, select, textarea') || dlg.querySelector('footer .btn:last-child'))?.focus(), 30);
  return { close, el: dlg };
}

export function confirmDialog({ title, text, confirm = 'Bestätigen', danger = false, typeToConfirm }) {
  return new Promise((resolve) => {
    let done = false;
    const inp = typeToConfirm ? h('input', { class: 'input', placeholder: typeToConfirm, autocomplete: 'off' }) : null;
    const body = h('div', { class: 'stack' }, h('p', { style: { margin: 0 } }, text),
      inp ? h('label', { class: 'field' }, h('span', null, `Zum Bestätigen „${typeToConfirm}“ eingeben`), inp) : null);
    const m = modal({
      title, body, onclose: () => { if (!done) resolve(null); },
      actions: [
        { label: 'Abbrechen', cls: 'ghost' },
        { label: confirm, cls: danger ? 'danger solid' : 'primary', onclick: () => {
          if (inp && inp.value !== typeToConfirm) { inp.focus(); return false; }
          done = true; resolve(inp ? inp.value : true);
        } },
      ],
    });
    inp?.addEventListener('keydown', (e) => { if (e.key === 'Enter') m.el.querySelector('footer .btn:last-child').click(); });
  });
}

export function promptDialog({ title, label, value = '', confirm = 'Speichern', placeholder }) {
  return new Promise((resolve) => {
    let done = false;
    const inp = h('input', { class: 'input', value, placeholder, autocomplete: 'off' });
    const m = modal({
      title, body: h('label', { class: 'field' }, h('span', null, label), inp), onclose: () => { if (!done) resolve(null); },
      actions: [{ label: 'Abbrechen', cls: 'ghost' }, { label: confirm, cls: 'primary', onclick: () => { done = true; resolve(inp.value.trim()); } }],
    });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') m.el.querySelector('footer .btn:last-child').click(); });
    setTimeout(() => { inp.focus(); const dot = value.lastIndexOf('.'); inp.setSelectionRange(0, dot > 0 ? dot : value.length); }, 40);
  });
}

export function menu(anchor, items) {
  document.querySelectorAll('.menu').forEach((m) => m.remove());
  const m = h('div', { class: 'menu', role: 'menu' }, items.filter(Boolean).map((it) => it === '-' ? h('hr') :
    h('button', { class: it.danger ? 'danger' : '', role: 'menuitem', onclick: () => { m.remove(); it.onclick(); } }, icon(it.icon || 'chevron'), it.label)));
  document.body.append(m);
  const r = anchor.getBoundingClientRect();
  const mw = m.offsetWidth, mh = m.offsetHeight;
  m.style.left = Math.min(r.right - mw, innerWidth - mw - 8) + 'px';
  m.style.top = (r.bottom + mh + 6 > innerHeight ? r.top - mh - 6 : r.bottom + 6) + 'px';
  setTimeout(() => {
    const off = (e) => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('mousedown', off); } };
    document.addEventListener('mousedown', off);
  });
  m.querySelector('button')?.focus();
}

// ---------- Formularbausteine ----------
export function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', null, label), input, hint ? h('small', null, hint) : null);
}
export function input(attrs = {}) { return h('input', { class: 'input', autocomplete: 'off', ...attrs }); }
export function select(options, value, attrs = {}) {
  return h('select', { class: 'input', ...attrs }, options.map((o) => {
    const [v, l] = Array.isArray(o) ? o : [o, o];
    return h('option', { value: v, selected: String(v) === String(value) }, l);
  }));
}
export function toggle(label, checked, hint, onchange) {
  const cb = h('input', { type: 'checkbox', checked: !!checked, role: 'switch' });
  if (onchange) cb.addEventListener('change', () => onchange(cb.checked, cb));
  const el = h('label', { class: 'switch' }, cb, h('span', { class: 'track' }),
    h('span', { class: 'txt' }, h('span', null, label), hint ? h('small', null, hint) : null));
  el.input = cb;
  return el;
}
export function note(text, kind = '', ic = 'info') {
  return h('div', { class: 'note ' + kind }, icon(kind === 'warn' || kind === 'bad' ? 'warn' : ic), h('div', null, text));
}
export function copyText(text) {
  if (navigator.clipboard && isSecureContext) return navigator.clipboard.writeText(text).then(() => toast('Kopiert', 'ok', text));
  const ta = h('textarea', { style: { position: 'fixed', opacity: 0 } }, text);
  document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
  toast('Kopiert', 'ok', text);
  return Promise.resolve();
}
