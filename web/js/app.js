import { h, clear, fill, btn, api, get, post, onEvent, connectEvents, disconnectEvents, toast, taskToast, modal, field, input,
  select, toggle, note, bytes, mb, lamp, graph, STATE_TEXT, uptime } from './core.js';
import { icon } from './icons.js';
import { renderServer } from './server.js';
import { renderVersions, renderUsers, renderSettings, renderAccount } from './admin.js';
import { renderRatio } from './ratio.js';

// ---------- Zustand ----------
export const S = {
  user: null,
  instances: new Map(),   // id -> Instanz inkl. status
  hist: new Map(),        // id -> {cpu:[], mem:[]}
  tasks: new Map(),
  host: null,
};
const viewHooks = new Set();       // Ansicht reagiert auf Live-Daten
export const onLive = (fn) => { viewHooks.add(fn); return () => viewHooks.delete(fn); };
let cleanup = [];
export const addCleanup = (fn) => cleanup.push(fn);

export function hist(id) {
  if (!S.hist.has(id)) S.hist.set(id, { cpu: [], mem: [] });
  return S.hist.get(id);
}

export async function loadInstances() {
  const list = await get('/api/instances');
  S.instances = new Map(list.map((i) => [i.id, i]));
  for (const i of list) {
    const hh = hist(i.id);
    if (!hh.cpu.length && i.history) { hh.cpu = i.history.cpu.slice(); hh.mem = i.history.mem.slice(); }
  }
  renderRail();
  return list;
}

export function upsertInstance(inst) {
  S.instances.set(inst.id, { ...(S.instances.get(inst.id) || {}), ...inst });
  renderRail();
}

onEvent((ev) => {
  if (ev.type === 'stats' || ev.type === 'status') {
    const i = S.instances.get(ev.id);
    if (!i) return;
    const { type, id, ...st } = ev;
    i.status = { ...i.status, ...st };
    if (ev.type === 'stats') {
      const hh = hist(id); hh.cpu.push(st.cpu); hh.mem.push(st.mem);
      if (hh.cpu.length > 150) { hh.cpu.shift(); hh.mem.shift(); }
    }
    updateRailItem(i);
    viewHooks.forEach((fn) => fn(ev));
  } else if (ev.type === 'task') {
    handleTask(ev.task);
    viewHooks.forEach((fn) => fn(ev));
  }
});

// ---------- Aufgaben-Anzeige ----------
const taskEls = new Map();
function handleTask(t) {
  S.tasks.set(t.id, t);
  let el = taskEls.get(t.id);
  if (!el) { el = taskToast(); taskEls.set(t.id, el); }
  clear(el);
  el.className = 'toast' + (t.state === 'error' ? ' bad' : t.state === 'done' ? ' ok' : '');
  const pr = h('div', { class: 'progress' + (t.progress == null ? ' indet' : '') }, h('i', { style: { width: `${(t.progress || 0) * 100}%` } }));
  el.append(
    t.state === 'running' ? h('span', { class: 'spin', style: { marginTop: '3px', color: 'var(--accent)' } }) : icon(t.state === 'error' ? 'warn' : 'check'),
    h('div', { class: 'body' }, h('b', null, t.title),
      h('small', null, t.state === 'error' ? t.error : t.text || (t.state === 'done' ? 'Erledigt' : 'Läuft …')),
      t.state === 'running' ? pr : null));
  if (t.state !== 'running') {
    setTimeout(() => { el.remove(); taskEls.delete(t.id); }, t.state === 'error' ? 9000 : 3500);
  }
}

// ---------- Rahmen ----------
let root, railList, mainEl;
function shell() {
  root = document.getElementById('app');
  clear(root);
  const app = h('div', { class: 'app' });
  railList = h('div', { class: 'rail-list' });
  const rail = h('nav', { class: 'rail', 'aria-label': 'Navigation' },
    h('a', { class: 'brand', href: '#/', style: { color: 'inherit', textDecoration: 'none' } },
      icon('logo', 22, 'mark'), h('b', null, 'Werk'), h('small', null, 'Factorio')),
    h('div', { class: 'rail-section' },
      navLink('#/', 'server', 'Übersicht', 'home')),
    h('div', { class: 'rail-head', style: { padding: '10px 18px 6px' } }, h('span', null, 'Server'),
      btn('', { icon: 'plus', cls: 'ghost icon sm', title: 'Neuer Server', onclick: () => createDialog() })),
    railList,
    h('div', { class: 'rail-section', style: { borderTop: '1px solid var(--line-soft)', paddingTop: '8px' } },
      navLink('#/rechner', 'ratio', 'Ratio-Rechner', 'ratio'),
      navLink('#/versions', 'versions', 'Versionen', 'versions'),
      S.user.role === 'admin' ? navLink('#/users', 'players', 'Benutzer', 'users') : null,
      S.user.role === 'admin' ? navLink('#/settings', 'settings', 'Einstellungen', 'settings') : null),
    h('div', { class: 'rail-foot' },
      h('div', { class: 'me' },
        h('a', { href: '#/account', class: 'who', style: { color: 'inherit', textDecoration: 'none' } },
          h('div', null, S.user.username), h('small', null, S.user.role === 'admin' ? 'Administrator' : 'Benutzer')),
        btn('', { icon: document.documentElement.dataset.theme === 'light' ? 'moon' : 'sun', cls: 'ghost icon sm', title: 'Hell/Dunkel umschalten', onclick: (e) => toggleTheme(e.currentTarget) }),
        btn('', { icon: 'logout', cls: 'ghost icon sm', title: 'Abmelden', onclick: logout }))));
  mainEl = h('main', { class: 'main' });
  const mobile = h('div', { class: 'mobile-bar' },
    btn('', { icon: 'menu', cls: 'ghost icon', title: 'Menü', onclick: () => app.classList.toggle('nav-open') }),
    icon('logo', 20, 'mark'), h('b', null, 'Werk'));
  app.append(rail, h('div', { style: { minWidth: 0, display: 'flex', flexDirection: 'column', height: '100vh' } }, mobile, mainEl));
  mainEl.style.flex = '1';
  rail.addEventListener('click', (e) => { if (e.target.closest('a')) app.classList.remove('nav-open'); });
  root.append(app);
  renderRail();
}

function navLink(href, ic, label, key) {
  return h('a', { class: 'navitem', href, 'data-nav': key }, icon(ic), h('span', { class: 'label' }, label));
}

function toggleTheme(b) {
  const light = document.documentElement.dataset.theme !== 'light';
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  try { localStorage.setItem('werk-theme', light ? 'light' : 'dark'); } catch {}
  b.replaceChildren(icon(light ? 'moon' : 'sun'));
}

export function renderRail() {
  if (!railList) return;
  clear(railList);
  const list = [...S.instances.values()];
  if (!list.length) {
    railList.append(h('p', { class: 'faint', style: { padding: '4px 8px', fontSize: '13px', margin: 0 } }, 'Noch keine Server.'));
  }
  for (const i of list) {
    railList.append(h('a', { class: 'navitem', href: `#/s/${i.id}`, 'data-srv': i.id },
      lamp(i.status?.state || 'stopped'), h('span', { class: 'label' }, i.name),
      h('span', { class: 'meta' }, i.status?.players?.length ? String(i.status.players.length) : '')));
  }
  markActive();
}

function updateRailItem(i) {
  const a = railList?.querySelector(`[data-srv="${i.id}"]`);
  if (!a) return;
  a.querySelector('.lamp').className = `lamp ${i.status.state}`;
  a.querySelector('.meta').textContent = i.status.players?.length ? String(i.status.players.length) : '';
}

function markActive() {
  const hsh = location.hash || '#/';
  document.querySelectorAll('.rail .navitem').forEach((a) => {
    const href = a.getAttribute('href');
    const on = href === '#/' ? (hsh === '#/' || hsh === '#') : hsh === href || hsh.startsWith(href + '/');
    a.classList.toggle('active', on);
  });
}

async function logout() {
  await post('/api/logout');
  disconnectEvents();
  S.user = null;
  location.hash = '#/login';
}

// ---------- Übersicht ----------
async function renderHome(main) {
  const page = h('div', { class: 'page' });
  main.append(page);
  const list = [...S.instances.values()];
  page.append(h('div', { class: 'page-head' },
    h('div', { class: 'grow' }, h('h1', null, `Hallo ${S.user.username}`),
      h('p', null, list.length ? `${list.length} ${list.length === 1 ? 'Server' : 'Server'}, ${list.filter((i) => i.status?.state === 'running').length} davon laufen.` : 'Leg deinen ersten Factorio-Server an.')),
    btn('Neuer Server', { icon: 'plus', cls: 'primary', onclick: () => createDialog() })));

  const strip = h('div', { class: 'host-strip' });
  page.append(strip);
  const drawHost = async () => {
    try { S.host = await get('/api/host'); } catch { return; }
    const x = S.host;
    const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
    const cls = (p) => (p > 90 ? 'crit' : p > 70 ? 'hot' : '');
    const st = (ic, k, v, sub, p) => h('div', { class: 'stat' }, h('div', { class: 'k' }, icon(ic), k),
      h('div', { class: 'v' }, v, ' ', h('small', null, sub)), p != null ? h('div', { class: 'bar' }, h('i', { class: cls(p), style: { width: `${p}%` } })) : null);
    fill(strip, 
      st('cpu', 'Prozessor', `${Math.round(x.cpu)} %`, `${x.cores} Kerne`, Math.round(x.cpu)),
      st('memory', 'Arbeitsspeicher', bytes(x.mem_used), `von ${bytes(x.mem_total)}`, pct(x.mem_used, x.mem_total)),
      st('disk', 'Speicherplatz', bytes(x.disk_used), `von ${bytes(x.disk_total)}`, pct(x.disk_used, x.disk_total)),
      st('server', 'RAM zugeteilt', mb(x.memory_committed_mb), 'an alle Server', pct(x.memory_committed_mb * 1048576, x.mem_total)));
  };
  drawHost();
  const hostTimer = setInterval(drawHost, 5000);
  addCleanup(() => clearInterval(hostTimer));

  if (!list.length) {
    page.append(h('div', { class: 'panel' }, h('div', { class: 'empty' }, icon('server', 28),
      h('h3', null, 'Noch kein Server'),
      h('p', null, 'Ein Server bekommt eine eigene Adresse, eigene Dateien, Mods und eine Version. Du kannst ihn später mit anderen teilen.'),
      btn('Server anlegen', { icon: 'plus', cls: 'primary', onclick: () => createDialog() }))));
    return;
  }
  const cards = h('div', { class: 'srv-cards' });
  page.append(cards);
  const card = (i) => {
    const s = i.status || {};
    const hh = hist(i.id);
    return h('a', { class: 'srv-card', href: `#/s/${i.id}`, 'data-card': i.id },
      h('div', { class: 'top' }, lamp(s.state || 'stopped'), h('b', null, i.name), h('span', { class: 'tag' }, i.version)),
      h('code', null, i.address),
      h('div', { class: 'row' },
        h('span', null, STATE_TEXT[s.state] || 'Gestoppt', s.since && s.state === 'running' ? ` · ${uptime(s.since)}` : ''),
        h('span', null, icon('players', 14), String(s.players?.length || 0)),
        h('span', null, icon('memory', 14), s.mem ? bytes(s.mem) : '–'),
        i.role !== 'owner' ? h('span', { title: `Gehört ${i.owner.username}` }, icon('share', 14), i.owner.username) : null),
      h('div', { class: 'meter cpu', style: { padding: 0, border: 0, background: 'none' } }, graph(hh.cpu, 100, { height: 28 })));
  };
  const draw = () => fill(cards, ...[...S.instances.values()].map(card));
  draw();
  let last = 0;
  addCleanup(onLive((ev) => {
    if (ev.type !== 'stats' && ev.type !== 'status') return;
    const now = Date.now(); if (now - last < 900) return; last = now;
    draw();
  }));
}

// ---------- Neuer Server ----------
export async function createDialog() {
  let vers = null;
  try { vers = await get('/api/versions'); } catch {}
  const stable = vers?.stable;
  const installed = (vers?.versions || []).filter((v) => v.installed).map((v) => v.version);
  const opts = [['latest', `Neueste stabile${stable ? ` (${stable})` : ''}`]];
  for (const v of vers?.versions || []) opts.push([v.version, v.version + (v.installed ? ' · installiert' : v.cached ? ' · im Cache' : '')]);

  const name = input({ placeholder: 'z. B. Kurs Gruppe A', maxlength: 60, autofocus: true });
  const sub = input({ placeholder: 'factorio', maxlength: 32 });
  let subTouched = false;
  sub.addEventListener('input', () => { subTouched = true; });
  name.addEventListener('input', () => { if (!subTouched) sub.value = slug(name.value); });
  const base = S.baseDomain;
  const subField = base ? h('div', { class: 'addon' }, sub, h('span', { class: 'suffix' }, '.' + base)) : sub;
  const version = select(opts, installed[0] && installed[0] === stable ? 'latest' : 'latest');
  const memory = select([[1024, '1 GB'], [2048, '2 GB'], [3072, '3 GB'], [4096, '4 GB'], [6144, '6 GB'], [8192, '8 GB']], 2048);
  const preset = select([['default', 'Standard'], ['rich-resources', 'Reiche Ressourcen'], ['marathon', 'Marathon'], ['death-world', 'Todeswelt'],
    ['death-world-marathon', 'Todeswelt-Marathon'], ['rail-world', 'Eisenbahnwelt'], ['ribbon-world', 'Bandwelt'], ['island', 'Insel']], 'default');
  const seed = input({ placeholder: 'zufällig', inputmode: 'numeric' });
  const pw = input({ placeholder: 'ohne Passwort', type: 'text' });
  const sa = toggle('Space Age aktivieren', true, 'Ab Factorio 2.0. Lässt sich später unter Mods umschalten.');
  let dedicated = null;
  if (S.user.role === 'admin' && S.dedicatedIps?.length) {
    dedicated = select([['', 'Gemeinsame IP (Port wird vergeben)'], ...S.dedicatedIps.map((d) => [d.bind, `${d.bind}${d.public ? ` → ${d.public}` : ''} (eigene IP, Port 34197)`])], '');
  }
  const err = h('div', { class: 'faint', style: { color: 'var(--bad)', minHeight: '20px', fontSize: '13.5px' } });
  const body = h('div', { class: 'stack' },
    field('Name', name),
    field('Adresse', subField, base ? 'Unter dieser Adresse verbinden sich die Spieler.' : 'Ohne Basisdomain wird die IP angezeigt (Einstellungen → Domain).'),
    h('div', { class: 'grid2' }, field('Factorio-Version', version), field('Arbeitsspeicher', memory)),
    h('div', { class: 'grid2' }, field('Karte', preset), field('Seed', seed)),
    field('Spielpasswort', pw),
    dedicated ? field('Netzwerk', dedicated) : null,
    sa, err);
  const m = modal({
    title: 'Neuer Server', body,
    actions: [{ label: 'Abbrechen', cls: 'ghost' }, { label: 'Server anlegen', cls: 'primary', icon: 'plus', onclick: async () => {
      err.textContent = '';
      try {
        const r = await post('/api/instances', {
          name: name.value, subdomain: sub.value || undefined, version: version.value, memory_mb: Number(memory.value),
          preset: preset.value, seed: seed.value, game_password: pw.value, space_age: sa.input.checked,
          dedicated_ip: dedicated?.value || undefined,
        });
        upsertInstance(r.instance);
        if (r.dns_error) toast('DNS-Eintrag nicht gesetzt', 'bad', r.dns_error);
        location.hash = `#/s/${r.instance.id}`;
      } catch (e) { err.textContent = e.message; return false; }
    } }],
  });
  return m;
}
const slug = (s) => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);

// ---------- Anmeldung / Einrichtung ----------
function renderAuth(mode) {
  root = document.getElementById('app');
  clear(root);
  railList = null;
  const user = input({ autocomplete: 'username', autofocus: true });
  const pw = input({ type: 'password', autocomplete: mode === 'setup' ? 'new-password' : 'current-password' });
  const pw2 = mode === 'setup' ? input({ type: 'password', autocomplete: 'new-password' }) : null;
  const err = h('div', { class: 'err', role: 'alert' });
  const submit = btn(mode === 'setup' ? 'Konto anlegen' : 'Anmelden', { cls: 'primary', type: 'submit' });
  submit.style.width = '100%'; submit.style.justifyContent = 'center'; submit.style.height = '36px';
  const form = h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    if (pw2 && pw.value !== pw2.value) { err.textContent = 'Die Passwörter stimmen nicht überein.'; return; }
    submit.disabled = true;
    try {
      await api('POST', mode === 'setup' ? '/api/setup' : '/api/login', { username: user.value, password: pw.value }, { allow401: true });
      await boot();
      location.hash = '#/';
    } catch (ex) { err.textContent = ex.message; } finally { submit.disabled = false; }
  } },
  field('Benutzername', user), field('Passwort', pw, mode === 'setup' ? 'Mindestens 8 Zeichen.' : null),
  pw2 ? field('Passwort wiederholen', pw2) : null, err, submit);
  root.append(h('div', { class: 'auth' }, h('div', { class: 'auth-box' },
    h('div', { class: 'brand' }, icon('logo', 26, 'mark'), h('b', { style: { fontSize: '17px' } }, 'Werk')),
    h('h1', null, mode === 'setup' ? 'Panel einrichten' : 'Anmelden'),
    h('p', null, mode === 'setup' ? 'Lege das Administrator-Konto an. Weitere Benutzer erstellst du danach im Panel.' : 'Factorio-Server verwalten.'),
    form)));
}

// ---------- Router ----------
async function route() {
  cleanup.forEach((fn) => { try { fn(); } catch {} });
  cleanup = [];
  viewHooks.clear();
  document.querySelectorAll('.menu').forEach((m) => m.remove());
  const hsh = location.hash.replace(/^#/, '') || '/';
  if (!S.user) {
    const st = await api('GET', '/api/state', undefined, { allow401: true });
    if (st.setup) return renderAuth('setup');
    if (!st.user) return renderAuth('login');
    await boot();
  }
  if (hsh === '/login' || hsh === '/setup') { location.hash = '#/'; return; }
  if (!railList) shell();
  markActive();
  clear(mainEl);
  mainEl.scrollTop = 0;
  const parts = hsh.split('/').filter(Boolean);
  try {
    if (parts[0] === 's' && parts[1]) await renderServer(mainEl, parts[1], parts[2] || 'console', parts.slice(3));
    else if (parts[0] === 'rechner') await renderRatio(mainEl);
    else if (parts[0] === 'versions') await renderVersions(mainEl);
    else if (parts[0] === 'users') await renderUsers(mainEl);
    else if (parts[0] === 'settings') await renderSettings(mainEl);
    else if (parts[0] === 'account') await renderAccount(mainEl);
    else await renderHome(mainEl);
  } catch (e) {
    mainEl.append(h('div', { class: 'page' }, note(e.message, 'bad')));
  }
}

async function boot() {
  const st = await get('/api/state');
  S.user = st.user;
  S.baseDomain = st.base_domain;
  S.dedicatedIps = st.dedicated_ips || [];
  connectEvents();
  await loadInstances();
}

try { const t = localStorage.getItem('werk-theme'); if (t) document.documentElement.dataset.theme = t; } catch {}
addEventListener('hashchange', route);
route();
