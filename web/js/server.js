import { h, clear, fill, btn, get, post, put, patch, del, upload, toast, modal, confirmDialog, promptDialog, menu, field, input, select,
  toggle, note, bytes, mb, dt, ago, lamp, graph, STATE_TEXT, uptime, copyText } from './core.js';
import { icon } from './icons.js';
import { S, hist, onLive, addCleanup, upsertInstance, loadInstances } from './app.js';
import { renderFiles } from './files.js';
import { renderMods } from './mods.js';

const TABS = [
  ['console', 'console', 'Konsole'],
  ['files', 'files', 'Dateien'],
  ['mods', 'mods', 'Mods'],
  ['saves', 'saves', 'Spielstände'],
  ['players', 'players', 'Spieler'],
  ['settings', 'settings', 'Einstellungen'],
  ['access', 'share', 'Zugriff'],
];

export async function renderServer(main, id, tab, rest) {
  const data = await get(`/api/instances/${id}`);
  upsertInstance(data);
  const hh = hist(id);
  if (!hh.cpu.length && data.history) { hh.cpu = data.history.cpu.slice(); hh.mem = data.history.mem.slice(); }
  const inst = () => S.instances.get(id);

  const page = h('div', { class: 'page' });
  main.append(page);

  // ---- Kopf ----
  const lampEl = lamp(inst().status.state);
  const stateTxt = h('span', null);
  const powerRow = h('div', { class: 'btn-row' });
  const head = h('div', { class: 'srv-head' },
    h('div', { class: 'srv-title' },
      h('h1', null, inst().name, h('span', { class: 'state' }, lampEl, stateTxt)),
      h('div', { class: 'addr' }, h('code', null, inst().address),
        btn('', { icon: 'copy', cls: 'ghost icon sm', title: 'Adresse kopieren', onclick: () => copyText(inst().address) })),
      h('div', { class: 'facts' },
        h('span', null, icon('versions', 14), `Factorio ${inst().version}`),
        inst().space_age ? h('span', null, icon('rocket', 14), 'Space Age') : null,
        h('span', null, icon('memory', 14), `${mb(inst().memory_mb)} Limit`),
        inst().role !== 'owner' ? h('span', null, icon('share', 14), `Gehört ${inst().owner.username}`) : null,
        !inst().installed ? h('span', { style: { color: 'var(--accent)' } }, icon('download', 14), 'Version wird installiert') : null)),
    powerRow);
  page.append(head);

  const drawPower = () => {
    const s = inst().status.state;
    stateTxt.textContent = (STATE_TEXT[s] || s) + (s === 'running' && inst().status.since ? ` seit ${uptime(inst().status.since)}` : '') +
      (s === 'crashed' && inst().status.exit ? ` (Exit ${inst().status.exit})` : '');
    lampEl.className = `lamp ${s}`;
    const act = (a) => () => post(`/api/instances/${id}/power`, { action: a }).then((st) => { inst().status = { ...inst().status, ...st }; drawPower(); });
    const off = s === 'stopped' || s === 'crashed';
    fill(powerRow, 
      btn('Starten', { icon: 'play', cls: 'go', disabled: !off, onclick: act('start') }),
      btn('Neustarten', { icon: 'restart', disabled: s !== 'running', onclick: act('restart') }),
      btn('Stoppen', { icon: 'stop', cls: 'halt', disabled: off || s === 'stopping', onclick: act('stop') }),
      btn('', { icon: 'more', cls: 'icon', title: 'Weitere Aktionen', onclick: (e) => menu(e.currentTarget, [
        { icon: 'kill', label: 'Prozess beenden (ohne Speichern)', danger: true, onclick: async () => {
          if (await confirmDialog({ title: 'Prozess hart beenden?', text: 'Der Server wird sofort beendet. Nicht gespeicherter Fortschritt seit dem letzten Autosave geht verloren.', confirm: 'Beenden', danger: true })) act('kill')();
        } },
        { icon: 'copy', label: 'Adresse kopieren', onclick: () => copyText(inst().address) },
      ]) }));
  };
  drawPower();

  // ---- Leistungsanzeige ----
  const cpuV = h('span', { class: 'v' }), memV = h('span', { class: 'v' });
  const cpuG = h('div'), memG = h('div');
  const plist = h('div', { class: 'plist' });
  const pcount = h('span', { class: 'v' });
  page.append(h('div', { class: 'meters' },
    h('div', { class: 'meter cpu' }, h('div', { class: 'meter-top' }, h('span', { class: 'k' }, icon('cpu', 14), 'CPU'), cpuV), cpuG),
    h('div', { class: 'meter mem' }, h('div', { class: 'meter-top' }, h('span', { class: 'k' }, icon('memory', 14), 'RAM'), memV), memG),
    h('div', { class: 'meter players-box' }, h('div', { class: 'meter-top' }, h('span', { class: 'k' }, icon('players', 14), 'Spieler online'), pcount), plist)));
  const drawMeters = () => {
    const s = inst().status;
    const limit = inst().memory_mb * 1048576;
    cpuV.replaceChildren(`${(s.cpu || 0).toFixed(0)} %`, h('small', null, ' eines Kerns'));
    memV.replaceChildren(bytes(s.mem || 0), h('small', null, ` / ${mb(inst().memory_mb)}`));
    cpuG.replaceChildren(graph(hh.cpu, 100));
    memG.replaceChildren(graph(hh.mem, limit));
    pcount.textContent = String(s.players?.length || 0);
    fill(plist, ...(s.players?.length ? s.players.map((p) => h('span', { class: 'tag' }, p)) :
      [h('span', { class: 'faint', style: { fontSize: '13px' } }, s.state === 'running' ? 'Niemand verbunden' : 'Server ist aus')]));
  };
  drawMeters();

  addCleanup(onLive((ev) => {
    if (ev.id !== id) return;
    if (ev.type === 'status' || ev.type === 'stats') { drawPower(); drawMeters(); tabHook?.(ev); }
  }));

  // ---- Tabs ----
  const tabs = h('nav', { class: 'tabs', 'aria-label': 'Server-Bereiche' },
    TABS.map(([k, ic, l]) => h('a', { class: 'tab' + (k === tab ? ' active' : ''), href: `#/s/${id}/${k}` }, icon(ic, 15), l)));
  const body = h('div');
  page.append(tabs, body);
  let tabHook = null;
  const setHook = (fn) => { tabHook = fn; };
  const ctx = { id, inst, body, setHook, rest, refresh: async () => { const d = await get(`/api/instances/${id}`); upsertInstance(d); return d; } };
  if (tab === 'console') consoleTab(ctx);
  else if (tab === 'files') await renderFiles(ctx);
  else if (tab === 'mods') await renderMods(ctx);
  else if (tab === 'saves') await savesTab(ctx);
  else if (tab === 'players') await playersTab(ctx);
  else if (tab === 'settings') await settingsTab(ctx);
  else if (tab === 'access') await accessTab(ctx);
}

// ======================= Konsole =======================
function classify(line) {
  if (line.includes('[CHAT]')) return 'chat';
  if (line.includes('[JOIN]')) return 'join';
  if (line.includes('[LEAVE]') || line.includes('[KICK]') || line.includes('[BAN]')) return 'leave';
  if (line.startsWith('[fpanel]')) return 'sys';
  if (/\bError\b|error:|Fehler|Segmentation|Assertion/.test(line)) return 'err';
  if (/\bWarning\b/.test(line)) return 'warn';
  return '';
}

function consoleTab({ id, inst, body, setHook }) {
  const out = h('div', { class: 'console-out', role: 'log', 'aria-live': 'off' });
  const mode = h('span', { class: 'mode' }, 'Chat');
  const inp = h('input', { placeholder: 'Nachricht an alle oder /befehl …', 'aria-label': 'Konsoleneingabe', autocomplete: 'off', spellcheck: false });
  const offInfo = h('span', { class: 'console-off' });
  const MAX = 4000;
  let atBottom = true;
  out.addEventListener('scroll', () => { atBottom = out.scrollHeight - out.scrollTop - out.clientHeight < 40; });
  const push = (lines, cls) => {
    const frag = document.createDocumentFragment();
    for (const l of lines) frag.append(h('div', { class: 'l ' + (cls || classify(l)) }, l));
    out.append(frag);
    while (out.childElementCount > MAX) out.firstChild.remove();
    if (atBottom) out.scrollTop = out.scrollHeight;
  };
  const histArr = []; let hi = 0;
  const send = (cmd) => {
    if (!cmd || !sock || sock.readyState !== 1) return;
    push([`> ${cmd}`], 'cmd');
    sock.send(JSON.stringify({ command: cmd }));
    histArr.push(cmd); hi = histArr.length;
  };
  inp.addEventListener('input', () => {
    const c = inp.value.startsWith('/');
    mode.textContent = c ? 'Befehl' : 'Chat';
    mode.className = 'mode' + (c ? ' cmd' : '');
  });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { send(inp.value.trim()); inp.value = ''; inp.dispatchEvent(new Event('input')); }
    else if (e.key === 'ArrowUp' && hi > 0) { inp.value = histArr[--hi]; e.preventDefault(); inp.dispatchEvent(new Event('input')); }
    else if (e.key === 'ArrowDown') { inp.value = hi < histArr.length - 1 ? histArr[++hi] : (hi = histArr.length, ''); inp.dispatchEvent(new Event('input')); }
  });
  const quick = [['Spieler', '/players online'], ['Speichern', '/server-save'], ['Spielzeit', '/time'], ['Evolution', '/evolution'], ['Version', '/version']];
  body.append(
    h('div', { class: 'console-tools' }, quick.map(([l, c]) => btn(l, { cls: 'sm', title: c, onclick: () => send(c) })),
      h('span', { class: 'grow' }), offInfo,
      btn('', { icon: 'download', cls: 'sm icon', title: 'Log herunterladen', onclick: () => {
        const blob = new Blob([[...out.children].map((d) => d.textContent).join('\n')], { type: 'text/plain' });
        const a = h('a', { href: URL.createObjectURL(blob), download: `${inst().subdomain}-konsole.log` }); a.click();
      } }),
      btn('', { icon: 'trash', cls: 'sm icon', title: 'Ansicht leeren', onclick: () => clear(out) })),
    h('div', { class: 'console' }, out, h('div', { class: 'console-in' }, mode, inp)));

  const drawOff = () => {
    const s = inst().status.state;
    const ok = s === 'running';
    inp.disabled = !ok;
    offInfo.textContent = ok ? '' : s === 'starting' ? 'Server startet – Befehle gleich verfügbar' : 'Befehle nur bei laufendem Server';
  };
  drawOff();
  setHook(() => drawOff());

  let sock, closed = false, retry;
  const connect = () => {
    sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/instances/${id}/console`);
    sock.onmessage = (m) => {
      const ev = JSON.parse(m.data);
      if (ev.type === 'backlog') { clear(out); push(ev.lines); out.scrollTop = out.scrollHeight; atBottom = true; }
      else if (ev.type === 'lines') push(ev.lines);
      else if (ev.type === 'clear') { clear(out); }
      else if (ev.type === 'result') {
        const lines = (ev.output || (ev.ok ? '(keine Ausgabe)' : '')).replace(/\n$/, '').split('\n');
        push(lines, ev.ok ? 'res' : 'res fail');
      }
    };
    sock.onclose = () => { if (!closed) retry = setTimeout(connect, 2000); };
  };
  connect();
  addCleanup(() => { closed = true; clearTimeout(retry); sock?.close(); });
  setTimeout(() => inp.focus({ preventScroll: true }), 50);
}

// ======================= Spielstände =======================
async function savesTab({ id, inst, body, setHook }) {
  const wrap = h('div', { class: 'stack' });
  body.append(wrap);
  const draw = async () => {
    const d = await get(`/api/instances/${id}/saves`);
    const running = inst().status.state === 'running';
    const fileIn = h('input', { type: 'file', accept: '.zip', multiple: true, class: 'hidden', onchange: async () => {
      if (!fileIn.files.length) return;
      try { await upload(`/api/instances/${id}/files/upload`, fileIn.files, { path: 'saves' }); toast('Spielstand hochgeladen'); draw(); }
      catch (e) { toast(e.message, 'bad'); }
    } });
    const saves = d.saves.filter((s) => !s.backup), backups = d.saves.filter((s) => s.backup);
    const newest = saves[0]?.name;
    const startName = d.selected && saves.some((s) => s.name === d.selected) ? d.selected : newest;
    const row = (s) => h('tr', null,
      h('td', null, h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, icon(s.backup ? 'archive' : 'saves'), h('span', null, s.name),
        !s.backup && s.name === startName ? h('span', { class: 'tag accent' }, d.selected ? 'Startet mit diesem' : 'Neuester · startet') : null)),
      h('td', { class: 'num muted hide-sm' }, bytes(s.size)),
      h('td', { class: 'muted hide-sm', title: dt(s.mtime) }, ago(s.mtime)),
      h('td', { class: 'shrink' }, h('div', { class: 'btn-row', style: { justifyContent: 'flex-end' } },
        btn('', { icon: 'download', cls: 'sm icon ghost', title: 'Herunterladen', onclick: () => { location.href = `/api/instances/${id}/files/download?path=${encodeURIComponent(s.path)}`; } }),
        btn('', { icon: 'more', cls: 'sm icon ghost', title: 'Aktionen', onclick: (e) => menu(e.currentTarget, [
          !s.backup ? { icon: 'play', label: 'Beim Start laden', onclick: async () => { await patch(`/api/instances/${id}`, { save: s.name }); toast('Startspielstand gesetzt', 'ok', 'Gilt ab dem nächsten Start'); draw(); } } : null,
          s.backup ? { icon: 'restart', label: 'Wiederherstellen', onclick: async () => {
            if (!await confirmDialog({ title: 'Backup wiederherstellen?', text: `„${s.name}“ wird in den Spielstand-Ordner kopiert und beim nächsten Start geladen.`, confirm: 'Wiederherstellen' })) return;
            await post(`/api/instances/${id}/saves/restore`, { name: s.name }); await patch(`/api/instances/${id}`, { save: null });
            toast('Wiederhergestellt', 'ok', 'Neustart lädt das Backup'); draw();
          } } : null,
          '-',
          { icon: 'trash', label: 'Löschen', danger: true, onclick: async () => {
            if (!await confirmDialog({ title: 'Spielstand löschen?', text: `„${s.name}“ wird endgültig gelöscht.`, confirm: 'Löschen', danger: true })) return;
            await post(`/api/instances/${id}/files/op`, { op: 'delete', paths: [s.path] });
            if (d.selected === s.name) await patch(`/api/instances/${id}`, { save: null });
            draw();
          } },
        ]) }))));
    fill(wrap, 
      h('div', { class: 'btn-row' },
        btn('Jetzt speichern', { icon: 'saves', cls: 'primary', disabled: !running, title: running ? '' : 'Nur bei laufendem Server', onclick: async () => {
          await post(`/api/instances/${id}/saves/save-now`); toast('Gespeichert'); setTimeout(draw, 1500);
        } }),
        btn('Hochladen', { icon: 'upload', onclick: () => fileIn.click() }), fileIn,
        d.selected ? btn('Immer neuesten laden', { icon: 'refresh', onclick: async () => { await patch(`/api/instances/${id}`, { save: null }); draw(); } }) : null),
      saves.length ? h('div', { class: 'panel' }, h('table', { class: 'list' },
        h('thead', null, h('tr', null, h('th', null, 'Spielstand'), h('th', { class: 'hide-sm' }, 'Größe'), h('th', { class: 'hide-sm' }, 'Geändert'), h('th'))),
        h('tbody', null, saves.map(row))))
        : h('div', { class: 'panel' }, h('div', { class: 'empty' }, icon('saves', 26), h('h3', null, 'Noch kein Spielstand'),
          h('p', null, 'Beim ersten Start erzeugt der Server eine neue Karte mit Preset und Seed aus den Einstellungen. Du kannst auch einen vorhandenen Spielstand hochladen.'))),
      backups.length ? h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('div', { style: { flex: 1 } }, h('h3', null, 'Backups'),
        h('p', null, 'Automatisch vor jedem Versionswechsel angelegt.'))),
        h('table', { class: 'list' }, h('tbody', null, backups.map(row)))) : null);
  };
  await draw();
}

// ======================= Spieler =======================
async function playersTab({ id, inst, body, setHook }) {
  const online = h('div');
  const drawOnline = () => {
    const ps = inst().status.players || [];
    const running = inst().status.state === 'running';
    fill(online, h('div', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('h3', null, `Online (${ps.length})`)),
      ps.length ? h('table', { class: 'list' }, h('tbody', null, ps.map((p) => h('tr', null,
        h('td', null, h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, icon('user'), p)),
        h('td', { class: 'shrink' }, h('div', { class: 'btn-row' },
          btn('Admin', { cls: 'sm', icon: 'key', onclick: () => rconToast(id, `/promote ${p}`) }),
          btn('Kicken', { cls: 'sm', onclick: () => rconToast(id, `/kick ${p}`) }),
          btn('Bannen', { cls: 'sm danger', onclick: async () => {
            const reason = await promptDialog({ title: `${p} bannen`, label: 'Grund (optional)', confirm: 'Bannen' });
            if (reason === null) return; rconToast(id, `/ban ${p} ${reason}`.trim());
          } })))))))
        : h('div', { class: 'empty', style: { padding: '24px' } }, h('p', null, running ? 'Gerade ist niemand verbunden.' : 'Der Server läuft nicht.'))));
  };
  drawOnline();
  setHook(drawOnline);

  const lists = h('div', { class: 'grid3' });
  body.append(h('div', { class: 'stack' }, online, lists));
  const wl = inst().options.whitelist;
  lists.append(
    await listEditor(id, 'admins', 'Admins', 'Dürfen im Spiel Befehle ausführen, pausieren und kicken.'),
    await listEditor(id, 'bans', 'Gebannt', 'Können nicht beitreten.'),
    await listEditor(id, 'whitelist', 'Whitelist', 'Wenn aktiv, dürfen nur diese Spieler beitreten.',
      toggle('Whitelist aktiv', wl, 'Gilt ab dem nächsten Start', async (v) => {
        await patch(`/api/instances/${id}`, { whitelist: v }); inst().options.whitelist = v; toast(v ? 'Whitelist aktiviert' : 'Whitelist deaktiviert', 'ok', 'Neustart nötig');
      })));
}

async function rconToast(id, cmd) {
  try { const r = await post(`/api/instances/${id}/command`, { command: cmd }); toast(cmd, 'ok', r.output || 'Ausgeführt'); }
  catch (e) { toast(e.message, 'bad'); }
}

async function listEditor(id, kind, title, hint, extra) {
  let names = await get(`/api/instances/${id}/lists/${kind}`);
  const ul = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } });
  const inp = input({ placeholder: 'Spielername', 'aria-label': `${title}: Spielername` });
  const save = async (next) => { names = await put(`/api/instances/${id}/lists/${kind}`, next); draw(); };
  const draw = () => fill(ul, ...(names.length ? names.map((n) => h('span', { class: 'tag', style: { color: 'var(--text)' } }, n,
    h('button', { class: 'btn ghost icon sm', style: { width: '18px', height: '18px' }, title: `${n} entfernen`, onclick: () => save(names.filter((x) => x !== n)) }, icon('x', 12)))) :
    [h('span', { class: 'faint', style: { fontSize: '13px' } }, 'Leer')]));
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && inp.value.trim()) { save([...names, inp.value.trim()]); inp.value = ''; } });
  draw();
  return h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('div', { style: { flex: 1 } }, h('h3', null, title), h('p', null, hint))),
    h('div', { class: 'panel-body stack', style: { gap: '12px' } }, extra || null, ul,
      h('div', { style: { display: 'flex', gap: '6px' } }, inp, btn('', { icon: 'plus', cls: 'icon', title: 'Hinzufügen', onclick: () => { if (inp.value.trim()) { save([...names, inp.value.trim()]); inp.value = ''; } } }))));
}

// ======================= Einstellungen =======================
async function settingsTab(ctx) {
  const { id, inst, body } = ctx;
  const i = inst();
  const ss = await get(`/api/instances/${id}/server-settings`);
  const wrap = h('div');
  body.append(wrap);

  // Allgemein
  const name = input({ value: i.name, maxlength: 60 });
  const sub = input({ value: i.subdomain, maxlength: 32 });
  const base = i.address.replace(/:\d+$/, '').split('.').slice(1).join('.');
  const hasDomain = i.address.replace(/:\d+$/, '').startsWith(i.subdomain + '.');
  const memory = input({ type: 'number', min: 512, step: 256, value: i.memory_mb });
  const autostart = toggle('Beim Hochfahren starten', i.autostart, 'Startet, wenn das Panel bzw. der Host neu startet.');
  const autoRestart = toggle('Nach Absturz neu starten', i.auto_restart, 'systemd startet den Server 5 s nach einem Absturz neu.');
  const general = section('Allgemein', 'Name, Adresse und Ressourcen.', h('div', { class: 'stack' },
    h('div', { class: 'grid2' }, field('Name', name),
      field('Subdomain', hasDomain ? h('div', { class: 'addon' }, sub, h('span', { class: 'suffix' }, '.' + base)) : sub)),
    field('RAM-Limit (MB)', memory, 'Hartes Limit. Wird es überschritten, beendet der Kernel den Server. Gilt ab dem nächsten Start.'),
    autostart, autoRestart,
    h('div', null, btn('Speichern', { cls: 'primary', onclick: async () => {
      const r = await patch(`/api/instances/${id}`, { name: name.value, subdomain: sub.value, memory_mb: Number(memory.value),
        autostart: autostart.input.checked, auto_restart: autoRestart.input.checked });
      upsertInstance(r.instance);
      if (r.dns_error) toast('DNS konnte nicht aktualisiert werden', 'bad', r.dns_error); else toast('Gespeichert');
    } }))));

  // Netzwerk
  const net = section('Netzwerk', 'Wie Spieler den Server erreichen.', h('div', { class: 'stack' },
    h('div', { class: 'grid2' },
      field('Verbindungsadresse', h('div', { class: 'addr', style: { width: '100%' } }, h('code', { style: { flex: 1 } }, i.address),
        btn('', { icon: 'copy', cls: 'ghost icon sm', title: 'Kopieren', onclick: () => copyText(i.address) }))),
      field('Gebunden an', input({ value: `${i.bind_ip} : ${i.port} / UDP`, readonly: true }))),
    i.default_port
      ? note('Dieser Server nutzt den Standardport 34197. Spieler geben nur den Namen ohne Port ein.', '', 'check')
      : h('div', { class: 'stack', style: { gap: '10px' } },
        note(h('span', null, 'Factorio kennt keine SRV-Einträge. Ohne Portangabe verbindet der Client immer auf Port 34197 – und den kann pro IP nur ein Server haben. ',
          'Übernimmt dieser Server den Standardport, bekommt der bisherige Inhaber dafür Port ', h('b', null, String(i.port)), '. Laufende Server starten dabei neu.')),
        h('div', null, btn('Standardport übernehmen', { icon: 'pin', onclick: async () => {
          if (!await confirmDialog({ title: 'Standardport übernehmen?', text: 'Betroffene laufende Server werden neu gestartet. Spieler müssen neu verbinden.', confirm: 'Übernehmen' })) return;
          await post(`/api/instances/${id}/default-port`); await loadInstances(); toast('Port 34197 übernommen'); location.reload();
        } })))));

  // Spiel (server-settings.json)
  const g = {
    description: h('textarea', { class: 'input', rows: 2 }, ss.description || ''),
    max_players: input({ type: 'number', min: 0, value: ss.max_players ?? 0 }),
    game_password: input({ value: ss.game_password || '' }),
    autosave_interval: input({ type: 'number', min: 1, value: ss.autosave_interval ?? 5 }),
    autosave_slots: input({ type: 'number', min: 1, value: ss.autosave_slots ?? 10 }),
    afk: input({ type: 'number', min: 0, value: ss.afk_autokick_interval ?? 0 }),
    allow_commands: select([['admins-only', 'Nur Admins'], ['true', 'Alle Spieler'], ['false', 'Niemand']], String(ss.allow_commands ?? 'admins-only')),
    lan: toggle('Im LAN sichtbar', ss.visibility?.lan ?? true, 'Erscheint im Spiel unter „LAN-Spiele“.'),
    pub: toggle('Öffentlich gelistet', ss.visibility?.public ?? false, 'Braucht ein Factorio-Konto mit Token.'),
    verify: toggle('Factorio-Konto erforderlich', ss.require_user_verification ?? false, 'Aus = auch Spieler ohne verifiziertes Konto (DRM-freie Version) können beitreten.'),
    pause: toggle('Pausieren ohne Spieler', ss.auto_pause ?? true),
    user: input({ value: ss.username || '', autocomplete: 'off' }),
    token: input({ value: ss.token || '', type: 'password', autocomplete: 'new-password' }),
  };
  const pubFields = h('div', { class: 'grid2' }, field('Factorio-Benutzername', g.user), field('Token', g.token, 'factorio.com → Profil'));
  const syncPub = () => pubFields.classList.toggle('hidden', !g.pub.input.checked);
  g.pub.input.addEventListener('change', syncPub); syncPub();
  const game = section('Spiel', 'Inhalt der server-settings.json. Gilt ab dem nächsten Start, das Spielpasswort sofort.', h('div', { class: 'stack' },
    field('Beschreibung', g.description),
    h('div', { class: 'grid2' }, field('Spielpasswort', g.game_password, 'Leer = kein Passwort'), field('Max. Spieler', g.max_players, '0 = unbegrenzt')),
    h('div', { class: 'grid3' }, field('Autosave alle (min)', g.autosave_interval), field('Autosave-Slots', g.autosave_slots), field('AFK-Kick nach (min)', g.afk, '0 = aus')),
    field('Befehle im Spiel', g.allow_commands),
    g.verify, g.pause, g.lan, g.pub, pubFields,
    h('div', null, btn('Speichern', { cls: 'primary', onclick: async () => {
      const ac = g.allow_commands.value;
      const r = await put(`/api/instances/${id}/server-settings`, {
        description: g.description.value, max_players: Number(g.max_players.value), game_password: g.game_password.value,
        autosave_interval: Number(g.autosave_interval.value), autosave_slots: Number(g.autosave_slots.value),
        afk_autokick_interval: Number(g.afk.value), allow_commands: ac === 'true' ? 'true' : ac === 'false' ? 'false' : 'admins-only',
        require_user_verification: g.verify.input.checked, auto_pause: g.pause.input.checked,
        visibility: { lan: g.lan.input.checked, public: g.pub.input.checked }, username: g.user.value, token: g.token.value,
      });
      toast('Gespeichert', 'ok', r.live.length ? 'Spielpasswort sofort aktiv, Rest nach Neustart' : 'Gilt ab dem nächsten Start');
    } }))));

  // Version
  const vers = await get('/api/versions');
  const vsel = select(vers.versions.map((v) => [v.version, v.version + (v.version === i.version ? ' (aktuell)' : v.stable ? ' · stabil' : v.experimental ? ' · experimentell' : '') + (v.installed ? ' · installiert' : v.cached ? ' · Cache' : '')]), i.version);
  const downgrade = h('div');
  const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let k = 0; k < 3; k++) if (x[k] !== y[k]) return x[k] - y[k]; return 0; };
  vsel.addEventListener('change', () => fill(downgrade, cmp(vsel.value, i.version) < 0 ?
    note('Ältere Versionen können neuere Spielstände nicht laden. Vor dem Wechsel wird automatisch ein Backup angelegt.', 'warn') : ''));
  const change = (v) => post(`/api/instances/${id}/version`, { version: v }).then(() => toast('Versionswechsel läuft', 'info', 'Fortschritt unten rechts'));
  const version = section('Version', 'Server läuft mit einer gemeinsamen, lokal zwischengespeicherten Installation. Vor jedem Wechsel wird der Spielstand gesichert.', h('div', { class: 'stack' },
    h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, h('div', { style: { flex: 1, minWidth: '220px' } }, vsel),
      btn('Wechseln', { cls: 'primary', onclick: () => vsel.value !== i.version && change(vsel.value) }),
      vers.stable && vers.stable !== i.version ? btn(`Auf ${vers.stable} aktualisieren`, { icon: 'download', onclick: () => change('latest') }) : null),
    downgrade,
    note('Läuft der Server, wird er gestoppt, umgestellt und wieder gestartet.')));

  // Neue Karte
  const preset = select([['default', 'Standard'], ['rich-resources', 'Reiche Ressourcen'], ['marathon', 'Marathon'], ['death-world', 'Todeswelt'],
    ['death-world-marathon', 'Todeswelt-Marathon'], ['rail-world', 'Eisenbahnwelt'], ['ribbon-world', 'Bandwelt'], ['island', 'Insel']], i.options.preset || 'default');
  const seed = input({ value: i.options.seed || '', placeholder: 'zufällig', inputmode: 'numeric' });
  const map = section('Neue Karte', 'Wird nur verwendet, wenn kein Spielstand existiert. Eine eigene map-gen-settings.json im Hauptordner hat Vorrang.', h('div', { class: 'stack' },
    h('div', { class: 'grid2' }, field('Preset', preset), field('Seed', seed)),
    h('div', null, btn('Speichern', { onclick: async () => { await patch(`/api/instances/${id}`, { preset: preset.value, seed: seed.value }); toast('Gespeichert'); } }))));

  // Löschen
  const danger = section('Server löschen', 'Entfernt Spielstände, Mods, Dateien und DNS-Eintrag endgültig.', h('div', null,
    btn('Server löschen', { cls: 'danger', icon: 'trash', onclick: async () => {
      const c = await confirmDialog({ title: 'Server endgültig löschen?', text: `Alle Daten von „${i.name}“ werden gelöscht. Lade vorher wichtige Spielstände herunter.`, confirm: 'Endgültig löschen', danger: true, typeToConfirm: i.name });
      if (!c) return;
      await del(`/api/instances/${id}`, { confirm: c });
      S.instances.delete(id); await loadInstances(); toast('Server gelöscht'); location.hash = '#/';
    } })));

  wrap.append(general, net, game, version, map, danger);
}

function section(title, text, content) {
  return h('section', { class: 'section' }, h('header', null, h('h3', null, title), h('p', null, text)), h('div', null, content));
}

// ======================= Zugriff =======================
async function accessTab({ id, inst, body, refresh }) {
  const wrap = h('div', { class: 'stack' });
  body.append(wrap);
  const draw = () => {
    const i = inst();
    const user = input({ placeholder: 'Benutzername im Panel' });
    const add = async () => {
      if (!user.value.trim()) return;
      const r = await post(`/api/instances/${id}/members`, { username: user.value.trim() });
      upsertInstance(r); toast(`${user.value.trim()} hat jetzt Zugriff`); draw();
    };
    user.addEventListener('keydown', (e) => { if (e.key === 'Enter') add().catch((er) => toast(er.message, 'bad')); });
    fill(wrap, 
      note('Geteilte Benutzer haben die vollen Rechte: starten, stoppen, Konsole, Dateien, Mods, Einstellungen und Löschen.'),
      h('div', { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h3', null, 'Personen mit Zugriff')),
        h('table', { class: 'list' }, h('tbody', null,
          h('tr', null, h('td', null, h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, icon('user'), i.owner.username)),
            h('td', { class: 'r' }, h('span', { class: 'tag accent' }, 'Besitzer'))),
          i.members.map((m) => h('tr', null,
            h('td', null, h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, icon('user'), m.username, m.id === S.user.id ? h('span', { class: 'faint' }, '(du)') : null)),
            h('td', { class: 'r' }, h('div', { class: 'btn-row', style: { justifyContent: 'flex-end' } }, h('span', { class: 'tag' }, 'Volle Rechte'),
              btn(m.id === S.user.id ? 'Verlassen' : 'Entfernen', { cls: 'sm danger', onclick: async () => {
                if (!await confirmDialog({ title: m.id === S.user.id ? 'Server verlassen?' : `${m.username} entfernen?`, text: 'Der Zugriff auf diesen Server endet sofort.', confirm: 'Entfernen', danger: true })) return;
                const r = await del(`/api/instances/${id}/members/${m.id}`);
                if (r.left) { await loadInstances(); location.hash = '#/'; return; }
                upsertInstance(r); draw();
              } }))))))),
        h('div', { class: 'panel-body', style: { borderTop: '1px solid var(--line-soft)', display: 'flex', gap: '8px' } },
          h('div', { style: { flex: 1 } }, user), btn('Freigeben', { icon: 'share', cls: 'primary', onclick: add }))),
      (i.role === 'owner' || S.user.role === 'admin') ? h('div', { class: 'panel' }, h('div', { class: 'panel-head' },
        h('div', { style: { flex: 1 } }, h('h3', null, 'Besitz übertragen'), h('p', null, 'Der neue Besitzer übernimmt Kontingent und Server. Du bleibst als Mitglied mit vollen Rechten.')),
        btn('Übertragen', { onclick: async () => {
          const u = await promptDialog({ title: 'Besitz übertragen', label: 'Neuer Besitzer (Benutzername)', confirm: 'Übertragen' });
          if (!u) return;
          const r = await post(`/api/instances/${id}/owner`, { username: u }); upsertInstance(r); toast(`${u} ist jetzt Besitzer`); draw();
        } }))) : null);
  };
  draw();
}
