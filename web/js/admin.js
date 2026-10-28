import { h, clear, fill, btn, get, post, patch, del, toast, modal, confirmDialog, field, input, select, toggle, note, bytes, mb, ago, dt, copyText } from './core.js';
import { icon } from './icons.js';
import { S, onLive, addCleanup } from './app.js';

function head(title, text, ...actions) {
  return h('div', { class: 'page-head' }, h('div', { class: 'grow' }, h('h1', null, title), text ? h('p', null, text) : null), ...actions);
}
function section(title, text, content) {
  return h('section', { class: 'section' }, h('header', null, h('h3', null, title), h('p', null, text)), h('div', null, content));
}

// ======================= Versionen =======================
export async function renderVersions(main) {
  const page = h('div', { class: 'page' });
  main.append(page);
  const box = h('div');
  let showAll = false;
  const draw = async (data) => {
    data = data || await get('/api/versions');
    const isAdmin = S.user.role === 'admin';
    const rows = data.versions.filter((v) => showAll || v.installed || v.cached || v.stable || v.experimental || v.installing || v.used_by.length);
    const older = data.versions.length - rows.length;
    fill(box, 
      h('div', { class: 'panel' }, h('table', { class: 'list' },
        h('thead', null, h('tr', null, h('th', null, 'Version'), h('th', null, 'Status'), h('th', { class: 'hide-sm' }, 'Verwendet von'), h('th'))),
        h('tbody', null, rows.map((v) => h('tr', null,
          h('td', null, h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, h('span', { class: 'mono', style: { fontWeight: 500 } }, v.version),
            v.stable ? h('span', { class: 'tag ok' }, 'Stabil') : null, v.experimental ? h('span', { class: 'tag accent' }, 'Experimentell') : null)),
          h('td', null, v.installing ? h('span', { class: 'tag accent' }, 'Wird installiert') : v.installed ? h('span', { class: 'tag info' }, 'Installiert') :
            v.cached ? h('span', { class: 'tag' }, `Im Cache · ${bytes(v.cache_size)}`) : h('span', { class: 'faint' }, '–')),
          h('td', { class: 'hide-sm muted' }, v.used_by.length ? v.used_by.map((u) => u.name).join(', ') : ''),
          h('td', { class: 'shrink' }, h('div', { class: 'btn-row', style: { justifyContent: 'flex-end' } },
            !v.installed ? btn(v.cached ? 'Entpacken' : 'Installieren', { cls: 'sm', icon: 'download', disabled: v.installing, onclick: async () => {
              await post(`/api/versions/${v.version}/install`); toast(`Factorio ${v.version} wird installiert`, 'info');
            } }) : null,
            isAdmin && (v.installed || v.cached) ? btn('', { icon: 'trash', cls: 'sm icon ghost', title: v.used_by.length ? 'Wird noch verwendet' : 'Entfernen', disabled: !!v.used_by.length, onclick: () => {
              const run = (purge) => del(`/api/versions/${v.version}?purge=${purge}`).then(draw);
              modal({
                title: `Factorio ${v.version} entfernen`,
                body: h('p', { style: { margin: 0 } }, v.installed
                  ? 'Die entpackte Installation wird gelöscht. Behältst du das Archiv im Cache, ist eine erneute Installation ohne Download in Sekunden fertig.'
                  : 'Das Archiv wird aus dem Cache gelöscht.'),
                actions: [{ label: 'Abbrechen', cls: 'ghost' },
                  v.installed ? { label: 'Archiv behalten', onclick: () => run(false) } : null,
                  { label: v.installed ? 'Alles löschen' : 'Löschen', cls: 'danger solid', onclick: () => run(true) }].filter(Boolean),
              });
            } }) : null))))))),
      older > 0 || showAll ? h('div', { style: { marginTop: '12px' } }, btn(showAll ? 'Nur relevante zeigen' : `${older} ältere Versionen zeigen`, { cls: 'ghost', onclick: () => { showAll = !showAll; draw(data); } })) : null);
  };
  page.append(head('Versionen', 'Jede Version wird einmal heruntergeladen und im lokalen Cache gehalten. Alle Server teilen sich die entpackten Installationen.',
    btn('Liste aktualisieren', { icon: 'refresh', onclick: async () => draw(await post('/api/versions/refresh')) })), box);
  await draw();
  addCleanup(onLive((ev) => { if (ev.type === 'task' && ev.task.kind === 'version' && ev.task.state !== 'running') draw(); }));
}

// ======================= Benutzer =======================
export async function renderUsers(main) {
  const page = h('div', { class: 'page' });
  main.append(page);
  const box = h('div');
  const draw = async () => {
    const users = await get('/api/users');
    fill(box, h('div', { class: 'panel' }, h('table', { class: 'list' },
      h('thead', null, h('tr', null, h('th', null, 'Benutzer'), h('th', null, 'Rolle'), h('th', { class: 'hide-sm' }, 'Server'), h('th', { class: 'hide-sm' }, 'RAM'), h('th', { class: 'hide-sm' }, 'Zuletzt aktiv'), h('th'))),
      h('tbody', null, users.map((u) => h('tr', null,
        h('td', null, h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, icon('user'), h('b', { style: { fontWeight: 500 } }, u.username), u.id === S.user.id ? h('span', { class: 'faint' }, '(du)') : null)),
        h('td', null, u.role === 'admin' ? h('span', { class: 'tag accent' }, 'Admin') : h('span', { class: 'tag' }, 'Benutzer')),
        h('td', { class: 'num hide-sm' }, u.role === 'admin' ? `${u.instances}` : `${u.instances} / ${u.max_instances}`),
        h('td', { class: 'num hide-sm' }, u.role === 'admin' ? mb(u.memory_used) : `${mb(u.memory_used)} / ${mb(u.max_memory_mb)}`),
        h('td', { class: 'muted hide-sm' }, u.last_login ? ago(u.last_login) : 'nie'),
        h('td', { class: 'shrink' }, h('div', { class: 'btn-row' },
          btn('Bearbeiten', { cls: 'sm', onclick: () => userDialog(u, draw) }),
          u.id !== S.user.id ? btn('', { icon: 'trash', cls: 'sm icon ghost', title: 'Löschen', onclick: async () => {
            if (!await confirmDialog({ title: `${u.username} löschen?`, text: 'Das Konto wird entfernt. Server des Benutzers müssen vorher übertragen oder gelöscht werden.', confirm: 'Löschen', danger: true })) return;
            await del(`/api/users/${u.id}`); toast('Benutzer gelöscht'); draw();
          } }) : null))))))));
  };
  page.append(head('Benutzer', 'Jeder Benutzer kann eigene Server anlegen – begrenzt durch sein Kontingent – und sie mit anderen teilen.',
    btn('Benutzer anlegen', { icon: 'plus', cls: 'primary', onclick: () => userDialog(null, draw) })), box);
  await draw();
}

function userDialog(u, after) {
  const name = input({ value: u?.username || '', disabled: !!u, autocomplete: 'off' });
  const pw = input({ type: 'text', placeholder: u ? 'unverändert lassen' : 'mindestens 8 Zeichen', autocomplete: 'new-password' });
  const gen = btn('Erzeugen', { cls: 'sm', onclick: () => {
    const a = new Uint32Array(3); crypto.getRandomValues(a);
    pw.value = [...a].map((x) => x.toString(36)).join('').slice(0, 14);
  } });
  const role = select([['user', 'Benutzer'], ['admin', 'Administrator']], u?.role || 'user');
  const maxI = input({ type: 'number', min: 0, value: u?.max_instances ?? 3 });
  const maxM = input({ type: 'number', min: 0, step: 512, value: u?.max_memory_mb ?? 4096 });
  const err = h('div', { style: { color: 'var(--bad)', minHeight: '18px', fontSize: '13.5px' } });
  modal({
    title: u ? `${u.username} bearbeiten` : 'Benutzer anlegen',
    body: h('div', { class: 'stack' }, field('Benutzername', name),
      field(u ? 'Neues Passwort' : 'Passwort', h('div', { style: { display: 'flex', gap: '8px' } }, pw, gen), u ? 'Setzt das Passwort zurück und meldet alle Sitzungen ab.' : 'Gib es dem Benutzer weiter. Er kann es danach selbst ändern.'),
      field('Rolle', role, 'Admins sehen alle Server, verwalten Benutzer und Einstellungen.'),
      h('div', { class: 'grid2' }, field('Max. eigene Server', maxI), field('RAM-Kontingent (MB)', maxM)), err),
    actions: [{ label: 'Abbrechen', cls: 'ghost' }, { label: u ? 'Speichern' : 'Anlegen', cls: 'primary', onclick: async () => {
      try {
        const body = { role: role.value, max_instances: Number(maxI.value), max_memory_mb: Number(maxM.value) };
        if (u) { if (pw.value) body.password = pw.value; await patch(`/api/users/${u.id}`, body); }
        else await post('/api/users', { ...body, username: name.value, password: pw.value });
        if (pw.value) copyText(pw.value);
        toast(u ? 'Gespeichert' : 'Benutzer angelegt', 'ok', pw.value ? 'Passwort wurde in die Zwischenablage kopiert' : '');
        after();
      } catch (e) { err.textContent = e.message; return false; }
    } }],
  });
}

// ======================= Einstellungen =======================
export async function renderSettings(main) {
  const page = h('div', { class: 'page' });
  main.append(page);
  let s = await get('/api/settings');
  const save = async (patchBody, msg = 'Gespeichert') => { s = await patch('/api/settings', patchBody); toast(msg); return s; };

  // Domain & DNS
  const base = input({ value: s.base_domain, placeholder: 'artiam.org' });
  const pub = input({ value: s.public_ipv4, placeholder: s.detected_public_ip ? `automatisch: ${s.detected_public_ip}` : 'automatisch' });
  const cfTok = input({ type: 'password', placeholder: s.cloudflare_token ? 'gespeichert – zum Ändern neu eingeben' : 'API-Token mit DNS:Edit', autocomplete: 'new-password' });
  const cfZone = input({ value: s.cloudflare_zone_id, placeholder: 'Zonen-ID' });
  const domain = section('Domain & DNS', 'Jeder Server bekommt eine Subdomain unter der Basisdomain. Mit Cloudflare legt das Panel die DNS-Einträge selbst an.', h('div', { class: 'stack' },
    h('div', { class: 'grid2' }, field('Basisdomain', base, 'Server „factorio“ wird zu factorio.<basisdomain>'), field('Öffentliche IPv4', pub, 'Ziel der A-Einträge. Leer = automatisch ermitteln.')),
    h('div', { class: 'grid2' }, field('Cloudflare API-Token', cfTok), field('Cloudflare Zonen-ID', cfZone)),
    note('Einträge werden ohne Cloudflare-Proxy angelegt (graue Wolke) – Factorio nutzt UDP, das der Proxy nicht weiterleitet.'),
    h('div', { class: 'btn-row' },
      btn('Speichern', { cls: 'primary', onclick: () => save({ base_domain: base.value, public_ipv4: pub.value, cloudflare_zone_id: cfZone.value, ...(cfTok.value ? { cloudflare_token: cfTok.value } : {}) }).then(() => { S.baseDomain = s.base_domain; cfTok.value = ''; }) }),
      btn('Verbindung testen', { onclick: async () => { const r = await post('/api/settings/dns-test'); toast('Cloudflare erreichbar', 'ok', `Zone ${r.zone}`); } }),
      btn('Alle Einträge abgleichen', { onclick: async () => {
        const r = await post('/api/settings/dns-sync');
        r.errors.length ? toast(`${r.errors.length} Fehler`, 'bad', r.errors[0]) : toast(`${r.records.filter(Boolean).length} Einträge gesetzt`);
      } }))));

  // Ports
  const start = input({ type: 'number', value: s.port_range_start });
  const end = input({ type: 'number', value: s.port_range_end });
  const prim = input({ value: s.primary_ip, placeholder: s.detected_primary_ip });
  const ports = section('Ports & Adressen', 'Factorio braucht pro Server einen UDP-Port. Port 34197 ist der Standard – nur dort verbinden Spieler ohne Portangabe.', h('div', { class: 'stack' },
    h('div', { class: 'grid3' }, field('Erster Port', start), field('Letzter Port', end), field('Server-IP (Bind)', prim, `Erkannt: ${s.detected_primary_ip}`)),
    note(h('span', null, 'Im Router den Bereich ', h('b', { class: 'mono' }, `${s.port_range_start}–${s.port_range_end}/UDP`), ` an ${s.primary_ip || s.detected_primary_ip} weiterleiten.`)),
    h('div', null, btn('Speichern', { cls: 'primary', onclick: () => save({ port_range_start: Number(start.value), port_range_end: Number(end.value), primary_ip: prim.value.trim() }) }))));

  // Eigene IPs
  const ipRows = h('div', { class: 'stack', style: { gap: '8px' } });
  let ips = [...(s.dedicated_ips || [])];
  const drawIps = () => fill(ipRows, ...ips.map((d, k) => {
    const b = input({ value: d.bind, placeholder: 'Bind-IP im Container, z. B. 10.10.6.13' });
    const p = input({ value: d.public, placeholder: 'öffentliche IP (optional)' });
    b.oninput = () => (d.bind = b.value); p.oninput = () => (d.public = p.value);
    return h('div', { style: { display: 'flex', gap: '8px' } }, b, p, btn('', { icon: 'x', cls: 'icon ghost', title: 'Entfernen', onclick: () => { ips.splice(k, 1); drawIps(); } }));
  }), ips.length ? '' : h('span', { class: 'faint', style: { fontSize: '13px' } }, 'Keine zusätzlichen Adressen.'));
  drawIps();
  const dedicated = section('Eigene IP pro Server', 'Optional. Jede zusätzliche Adresse erlaubt einen weiteren Server auf Port 34197 – also wieder ohne Portangabe. Gut geeignet für IPv6 oder zusätzliche öffentliche IPv4.', h('div', { class: 'stack' },
    ipRows,
    note(h('span', null, 'Die Adresse muss dem Container zugewiesen sein (z. B. ', h('code', { class: 'mono' }, 'ip addr add 10.10.6.13/24 dev eth0'), ' bzw. eine weitere IP in Proxmox) und im Router per 1:1-NAT bzw. Portweiterleitung 34197/UDP erreichbar sein.')),
    h('div', { class: 'btn-row' }, btn('Adresse hinzufügen', { icon: 'plus', onclick: () => { ips.push({ bind: '', public: '' }); drawIps(); } }),
      btn('Speichern', { cls: 'primary', onclick: () => save({ dedicated_ips: ips }).then(() => { S.dedicatedIps = s.dedicated_ips; ips = [...s.dedicated_ips]; drawIps(); }) }))));

  // Factorio-Konto
  const fu = input({ value: s.factorio_username, autocomplete: 'off' });
  const ft = input({ type: 'password', placeholder: s.factorio_token ? 'gespeichert – zum Ändern neu eingeben' : 'Token von factorio.com/profile', autocomplete: 'new-password' });
  const account = section('Factorio-Konto', 'Wird nur für Downloads aus dem Mod-Portal verwendet und ist für Benutzer nicht sichtbar.', h('div', { class: 'stack' },
    h('div', { class: 'grid2' }, field('Benutzername', fu), field('Token', ft)),
    h('div', null, btn('Speichern', { cls: 'primary', onclick: () => save({ factorio_username: fu.value, ...(ft.value ? { factorio_token: ft.value } : {}) }).then(() => { ft.value = ''; }) }))));

  // Webzugriff
  const pdom = input({ value: s.panel_domain, placeholder: 'panel.artiam.org' });
  const mail = input({ value: s.acme_email, placeholder: 'für Let’s Encrypt (optional)' });
  const proxies = input({ value: (s.trusted_proxies || []).join(', '), placeholder: 'z. B. 10.10.6.200' });
  const mode = select([['redirect', 'Port 80 leitet auf HTTPS (443) um'], ['serve', 'Panel auch über HTTP auf Port 80 (z. B. hinter Cloudflare Tunnel)']], s.http_mode);
  const preview = h('pre', { class: 'mono', style: { background: 'var(--bg)', border: '1px solid var(--line-soft)', borderRadius: '6px', padding: '12px', overflow: 'auto', fontSize: '12px', margin: 0, maxHeight: '260px' } });
  const showPreview = async () => { preview.textContent = (await get('/api/settings/web')).caddyfile; };
  const web = section('Webzugriff', 'Das Panel läuft hinter Caddy auf Port 80 und 443. Für IP und Hostname gibt es ein internes Zertifikat, für eine öffentliche Domain automatisch Let’s Encrypt.', h('div', { class: 'stack' },
    h('div', { class: 'grid2' }, field('Panel-Domain', pdom, 'Muss per DNS auf diesen Server zeigen, Port 80/443 erreichbar.'), field('E-Mail für Zertifikate', mail)),
    field('Port 80', mode),
    field('Vertrauenswürdige Proxys', proxies, 'IP von cloudflared bzw. Reverse-Proxy. Nur deren Angaben zur Client-IP und zu HTTPS werden übernommen.'),
    preview,
    h('div', { class: 'btn-row' },
      btn('Speichern', { onclick: () => save({ panel_domain: pdom.value.trim(), acme_email: mail.value.trim(), http_mode: mode.value, trusted_proxies: proxies.value }).then(showPreview) }),
      btn('Auf Caddy anwenden', { cls: 'primary', onclick: async () => {
        await save({ panel_domain: pdom.value.trim(), acme_email: mail.value.trim(), http_mode: mode.value, trusted_proxies: proxies.value }, 'Gespeichert');
        const r = await post('/api/settings/web/apply'); preview.textContent = r.caddyfile;
        toast(r.applied ? 'Caddy neu geladen' : 'Vorschau erstellt (Entwicklungsmodus)');
      } }))));
  showPreview();

  // Standards
  const dmem = input({ type: 'number', min: 512, step: 256, value: s.default_memory_mb });
  const defaults = section('Standardwerte', 'Vorgaben für neue Server.', h('div', { class: 'stack' },
    field('RAM für neue Server (MB)', dmem),
    h('div', null, btn('Speichern', { cls: 'primary', onclick: () => save({ default_memory_mb: Number(dmem.value) }) }))));

  page.append(head('Einstellungen', null), domain, ports, dedicated, account, web, defaults);
}

// ======================= Konto =======================
export async function renderAccount(main) {
  const page = h('div', { class: 'page' });
  main.append(page);
  const cur = input({ type: 'password', autocomplete: 'current-password' });
  const n1 = input({ type: 'password', autocomplete: 'new-password' });
  const n2 = input({ type: 'password', autocomplete: 'new-password' });
  const err = h('div', { style: { color: 'var(--bad)', minHeight: '18px', fontSize: '13.5px' } });
  page.append(head('Konto', `Angemeldet als ${S.user.username} (${S.user.role === 'admin' ? 'Administrator' : 'Benutzer'}).`),
    section('Passwort ändern', 'Mindestens 8 Zeichen.', h('div', { class: 'stack', style: { maxWidth: '420px' } },
      field('Aktuelles Passwort', cur), field('Neues Passwort', n1), field('Wiederholen', n2), err,
      h('div', null, btn('Passwort ändern', { cls: 'primary', onclick: async () => {
        err.textContent = '';
        if (n1.value !== n2.value) { err.textContent = 'Die neuen Passwörter stimmen nicht überein.'; return; }
        try { await post('/api/me/password', { current: cur.value, new: n1.value }); toast('Passwort geändert'); cur.value = n1.value = n2.value = ''; }
        catch (e) { err.textContent = e.message; }
      } })))),
    section('Kontingent', 'Vom Admin festgelegt.', h('div', { class: 'grid2', style: { maxWidth: '420px' } },
      field('Eigene Server', input({ value: S.user.role === 'admin' ? 'unbegrenzt' : String(S.user.max_instances), readonly: true })),
      field('RAM gesamt', input({ value: S.user.role === 'admin' ? 'unbegrenzt' : mb(S.user.max_memory_mb), readonly: true })))));
}
