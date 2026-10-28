import { h, clear, fill, btn, get, post, upload, toast, confirmDialog, toggle, note, input } from './core.js';
import { icon } from './icons.js';
import { S, onLive, addCleanup, upsertInstance } from './app.js';

const fmtN = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace('.', ',')} Mio.` : n >= 1e3 ? `${Math.round(n / 1e3)} Tsd.` : String(n));

export async function renderMods({ id, body, inst }) {
  const wrap = h('div', { class: 'stack' });
  body.append(wrap);
  const instBox = h('div');
  const searchBox = h('div');
  let data;

  async function loadInstalled() {
    data = await get(`/api/instances/${id}/mods`);
    drawInstalled();
  }

  const running = () => ['running', 'starting'].includes(inst().status.state);
  const restartHint = () => (running() ? toast('Gespeichert', 'ok', 'Wird beim nächsten Neustart geladen') : null);

  function drawInstalled() {
    const fileIn = h('input', { type: 'file', accept: '.zip', multiple: true, class: 'hidden', onchange: async () => {
      try { await upload(`/api/instances/${id}/mods/upload`, fileIn.files); toast('Mod hochgeladen'); loadInstalled(); }
      catch (e) { toast(e.message, 'bad'); }
    } });
    const dlc = data.space_age !== null ? h('div', { class: 'panel' }, h('div', { class: 'dlc' }, icon('rocket', 22),
      h('div', { class: 'body' }, h('h3', null, 'Space Age'), h('p', null, 'Erweiterung mit Planeten, Qualität und Hochschienen. Neue Karten mit Space Age nutzen die neuen Planeten.')),
      toggle('', data.space_age, null, async (v, cb) => {
        try { await post(`/api/instances/${id}/mods/space-age`, { enabled: v }); data.space_age = v; upsertInstance({ id, space_age: v }); restartHint(); }
        catch (e) { cb.checked = !v; toast(e.message, 'bad'); }
      }))) : null;

    const rows = data.mods.map((m) => h('div', { class: 'mod-row' },
      icon('mods', 18),
      h('div', { class: 'body' },
        h('div', { class: 'title' }, m.title, h('span', { class: 'tag' }, m.version || '?'),
          m.factorio_version && m.factorio_version !== data.factorio_version ? h('span', { class: 'tag bad', title: 'Passt nicht zur Server-Version' }, `für ${m.factorio_version}`) : null,
          m.broken ? h('span', { class: 'tag bad' }, 'Defekt') : null),
        h('div', { class: 'sub mono', style: { fontSize: '12px' } }, m.name)),
      toggle('', m.enabled, null, async (v, cb) => {
        try { await post(`/api/instances/${id}/mods/toggle`, { name: m.name, enabled: v }); m.enabled = v; restartHint(); }
        catch (e) { cb.checked = !v; toast(e.message, 'bad'); }
      }),
      btn('', { icon: 'trash', cls: 'ghost icon sm', title: `${m.title} entfernen`, onclick: async () => {
        if (!await confirmDialog({ title: `${m.title} entfernen?`, text: 'Die Mod-Datei wird gelöscht. Spielstände, die sie nutzen, verlieren deren Inhalte beim Laden.', confirm: 'Entfernen', danger: true })) return;
        await post(`/api/instances/${id}/mods/remove`, { name: m.name }); loadInstalled();
      } })));

    const updatesBox = h('span');
    fill(instBox, h('div', { class: 'stack' },
      dlc,
      !data.credentials ? note(S.user.role === 'admin'
        ? h('span', null, 'Für Downloads aus dem Mod-Portal fehlen Factorio-Benutzername und Token. ', h('a', { href: '#/settings' }, 'In den Einstellungen hinterlegen'), '. Hochladen von ZIPs geht auch ohne.')
        : 'Downloads aus dem Mod-Portal sind noch nicht eingerichtet (Admin: Factorio-Konto in den Einstellungen). Hochladen von ZIPs geht trotzdem.', 'warn') : null,
      h('div', { class: 'panel' },
        h('div', { class: 'panel-head' }, h('div', { style: { flex: 1 } }, h('h3', null, `Installiert (${data.mods.length})`),
          h('p', null, `Server-Version ${data.factorio_version} · Änderungen gelten ab dem nächsten Start`)),
          updatesBox,
          btn('Updates prüfen', { icon: 'refresh', cls: 'sm', disabled: !data.mods.length, onclick: async () => {
            const ups = await get(`/api/instances/${id}/mods/updates`);
            fill(updatesBox, ups.length ? btn(`${ups.length} aktualisieren`, { cls: 'sm primary', icon: 'download', onclick: async () => {
              await post(`/api/instances/${id}/mods/update-all`); clear(updatesBox);
            } }) : h('span', { class: 'faint', style: { fontSize: '13px' } }, 'Alles aktuell'));
          } }),
          btn('ZIP hochladen', { icon: 'upload', cls: 'sm', onclick: () => fileIn.click() }), fileIn),
        rows.length ? rows : h('div', { class: 'empty', style: { padding: '26px' } }, h('p', null, 'Keine Mods installiert. Unten im Portal suchen oder ZIP hochladen.')))));
  }

  // ---- Portal-Suche ----
  const q = input({ placeholder: 'Mod-Portal durchsuchen …', type: 'search', 'aria-label': 'Mod-Portal durchsuchen' });
  const allCb = h('input', { type: 'checkbox' });
  const results = h('div');
  let page = 1, timer;
  async function search() {
    fill(results, h('div', { class: 'empty', style: { padding: '26px' } }, h('span', { class: 'spin', style: { display: 'inline-block' } })));
    try {
      const r = await get(`/api/instances/${id}/mods/search?q=${encodeURIComponent(q.value)}&page=${page}&all=${allCb.checked}`);
      const installed = new Set(data.mods.map((m) => m.name));
      fill(results, 
        r.results.length ? r.results.map((m) => h('div', { class: 'mod-row' },
          h('div', { class: 'body' },
            h('div', { class: 'title' }, h('a', { href: `https://mods.factorio.com/mod/${encodeURIComponent(m.name)}`, target: '_blank', rel: 'noopener' }, m.title),
              h('span', { class: 'tag' }, m.version || '–'),
              m.factorio_version !== data.factorio_version ? h('span', { class: 'tag bad' }, `für ${m.factorio_version || '?'}`) : null,
              h('span', { class: 'faint', style: { fontSize: '12.5px', fontWeight: 400 } }, `von ${m.owner} · ${fmtN(m.downloads)} Downloads`)),
            h('div', { class: 'sub' }, m.summary)),
          installed.has(m.name) ? h('span', { class: 'tag ok' }, icon('check', 12), 'Installiert') :
            btn('Installieren', { cls: 'sm', icon: 'download', disabled: !data.credentials || m.factorio_version !== data.factorio_version, onclick: async () => {
              await post(`/api/instances/${id}/mods/install`, { name: m.name });
            } }))) : h('div', { class: 'empty', style: { padding: '26px' } }, h('p', null, 'Keine passenden Mods gefunden.')),
        r.total > 30 ? h('div', { class: 'btn-row', style: { padding: '12px 18px', borderTop: '1px solid var(--line-soft)', justifyContent: 'space-between' } },
          h('span', { class: 'muted', style: { fontSize: '13px' } }, `${r.total} Treffer · Seite ${r.page} von ${Math.ceil(r.total / 30)}`),
          h('div', { class: 'btn-row' },
            btn('Zurück', { cls: 'sm', disabled: page <= 1, onclick: () => { page--; search(); } }),
            btn('Weiter', { cls: 'sm', disabled: page * 30 >= r.total, onclick: () => { page++; search(); } }))) : null);
    } catch (e) { fill(results, h('div', { class: 'panel-body' }, note(e.message, 'bad'))); }
  }
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { page = 1; search(); }, 300); });
  allCb.addEventListener('change', () => { page = 1; search(); });
  searchBox.append(h('div', { class: 'panel' },
    h('div', { class: 'panel-head', style: { flexWrap: 'wrap' } }, h('h3', null, 'Mod-Portal'),
      h('div', { style: { flex: '2 1 260px' } }, q),
      h('label', { class: 'check', style: { fontSize: '13px', color: 'var(--muted)' } }, allCb, 'Auch inkompatible zeigen')),
    results));

  addCleanup(onLive((ev) => {
    if (ev.type === 'task' && ev.task.instance_id === id && ev.task.state === 'done' && ev.task.kind === 'mod') { loadInstalled().then(search); }
  }));

  wrap.append(instBox, searchBox);
  await loadInstalled();
  search();
}
