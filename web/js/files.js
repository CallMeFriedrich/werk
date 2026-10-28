import { h, clear, fill, btn, get, post, put, upload, toast, modal, confirmDialog, promptDialog, menu, bytes, ago, dt, note } from './core.js';
import { icon } from './icons.js';
import { addCleanup } from './app.js';

const join = (a, b) => (a ? `${a}/${b}` : b);
const parent = (p) => p.split('/').slice(0, -1).join('/');

export async function renderFiles({ id, body, inst }) {
  let path = sessionStorage.getItem(`fm-${id}`) || '';
  let entries = [];
  const selected = new Set();
  const wrap = h('div', { class: 'stack', style: { gap: '12px' } });
  body.append(wrap);

  const fileIn = h('input', { type: 'file', multiple: true, class: 'hidden', onchange: () => doUpload([...fileIn.files]) });

  async function load(p = path) {
    try {
      const d = await get(`/api/instances/${id}/files?path=${encodeURIComponent(p)}`);
      path = d.path; entries = d.entries; selected.clear();
      sessionStorage.setItem(`fm-${id}`, path);
      draw();
    } catch (e) {
      if (p) { path = ''; return load(''); }
      toast(e.message, 'bad');
    }
  }

  async function doUpload(files) {
    if (!files.length) return;
    const t = h('span', { class: 'muted', style: { fontSize: '13px' } }, `Lade ${files.length} Datei(en) hoch … 0 %`);
    status.replaceChildren(t);
    try {
      await upload(`/api/instances/${id}/files/upload`, files, { path }, (f) => { t.textContent = `Lade ${files.length} Datei(en) hoch … ${Math.round(f * 100)} %`; });
      toast(`${files.length} Datei(en) hochgeladen`);
    } catch (e) { toast(e.message, 'bad'); }
    status.replaceChildren();
    fileIn.value = '';
    load();
  }

  const op = async (payload, msg) => { await post(`/api/instances/${id}/files/op`, payload); if (msg) toast(msg); load(); };
  const dl = (paths) => { location.href = `/api/instances/${id}/files/download?` + paths.map((p) => `path=${encodeURIComponent(p)}`).join('&'); };

  const status = h('div');
  const table = h('table', { class: 'list' });
  const panel = h('div', { class: 'panel' }, table);
  const toolbar = h('div', { class: 'btn-row' });
  const crumbs = h('div', { class: 'crumbs', style: { flex: 1, minWidth: '200px' } });

  panel.addEventListener('dragover', (e) => { e.preventDefault(); panel.classList.add('fm-drop'); });
  panel.addEventListener('dragleave', (e) => { if (!panel.contains(e.relatedTarget)) panel.classList.remove('fm-drop'); });
  panel.addEventListener('drop', (e) => { e.preventDefault(); panel.classList.remove('fm-drop'); doUpload([...e.dataTransfer.files]); });

  function draw() {
    // Brotkrumen
    const parts = path ? path.split('/') : [];
    fill(crumbs, h('button', { onclick: () => load('') }, inst().subdomain), ...parts.flatMap((p, i) => [
      h('span', { class: 'sep' }, '/'), h('button', { onclick: () => load(parts.slice(0, i + 1).join('/')) }, p)]));

    const sel = [...selected];
    fill(toolbar, 
      btn('', { icon: 'newfolder', cls: 'icon', title: 'Neuer Ordner', onclick: async () => {
        const n = await promptDialog({ title: 'Neuer Ordner', label: 'Name', confirm: 'Anlegen' }); if (n) op({ op: 'mkdir', path: join(path, n) });
      } }),
      btn('', { icon: 'newfile', cls: 'icon', title: 'Neue Datei', onclick: async () => {
        const n = await promptDialog({ title: 'Neue Datei', label: 'Dateiname', value: '.json', confirm: 'Anlegen' });
        if (n) { await put(`/api/instances/${id}/files/content`, { path: join(path, n), content: '' }); openEditor(join(path, n)); }
      } }),
      btn('Hochladen', { icon: 'upload', onclick: () => fileIn.click() }), fileIn,
      sel.length ? btn(`${sel.length} herunterladen`, { icon: 'download', onclick: () => dl(sel.map((n) => join(path, n))) }) : null,
      sel.length ? btn('Löschen', { icon: 'trash', cls: 'danger', onclick: async () => {
        if (!await confirmDialog({ title: `${sel.length} Einträge löschen?`, text: sel.join(', '), confirm: 'Löschen', danger: true })) return;
        op({ op: 'delete', paths: sel.map((n) => join(path, n)) }, 'Gelöscht');
      } }) : null);

    const all = h('input', { type: 'checkbox', 'aria-label': 'Alle auswählen', checked: entries.length && selected.size === entries.length,
      onchange: (e) => { entries.forEach((x) => (e.target.checked ? selected.add(x.name) : selected.delete(x.name))); draw(); } });
    fill(table, 
      h('thead', null, h('tr', null, h('th', { class: 'shrink' }, h('label', { class: 'check' }, all)), h('th', null, 'Name'),
        h('th', { class: 'r hide-sm' }, 'Größe'), h('th', { class: 'hide-sm' }, 'Geändert'), h('th'))),
      h('tbody', null,
        path ? h('tr', { class: 'click fm-row dir', onclick: () => load(parent(path)) }, h('td'),
          h('td', null, h('div', { class: 'name' }, icon('back'), '..')), h('td', { class: 'hide-sm' }), h('td', { class: 'hide-sm' }), h('td')) : null,
        entries.map((e) => {
          const full = join(path, e.name);
          const cb = h('input', { type: 'checkbox', checked: selected.has(e.name), 'aria-label': `${e.name} auswählen`,
            onclick: (ev) => ev.stopPropagation(), onchange: (ev) => { ev.target.checked ? selected.add(e.name) : selected.delete(e.name); draw(); } });
          const ic = e.dir ? 'folder' : e.name.endsWith('.zip') ? 'archive' : e.text ? 'filetext' : 'file';
          return h('tr', { class: 'click fm-row' + (e.dir ? ' dir' : '') + (selected.has(e.name) ? ' sel' : ''),
            onclick: () => (e.dir ? load(full) : e.text ? openEditor(full) : dl([full])) },
            h('td', { class: 'shrink' }, h('label', { class: 'check', onclick: (ev) => ev.stopPropagation() }, cb)),
            h('td', null, h('div', { class: 'name' }, icon(ic), h('span', null, e.name))),
            h('td', { class: 'r num muted hide-sm' }, e.dir ? '' : bytes(e.size)),
            h('td', { class: 'muted hide-sm', title: dt(e.mtime) }, ago(e.mtime)),
            h('td', { class: 'shrink' }, btn('', { icon: 'more', cls: 'ghost icon sm', title: 'Aktionen', onclick: (ev) => { ev.stopPropagation(); rowMenu(ev.currentTarget, e, full); } })));
        }),
        !entries.length ? h('tr', null, h('td', { colspan: 5 }, h('div', { class: 'empty', style: { padding: '28px' } },
          h('p', { style: { margin: 0 } }, 'Ordner ist leer. Dateien hierher ziehen oder „Hochladen“ nutzen.')))) : null));
  }

  function rowMenu(anchor, e, full) {
    menu(anchor, [
      !e.dir && e.text ? { icon: 'edit', label: 'Bearbeiten', onclick: () => openEditor(full) } : null,
      { icon: 'download', label: e.dir ? 'Als ZIP herunterladen' : 'Herunterladen', onclick: () => dl([full]) },
      e.name.endsWith('.zip') && !path.startsWith('saves') && !path.startsWith('mods') ? { icon: 'archive', label: 'Hier entpacken', onclick: () => op({ op: 'extract', path: full }, 'Entpackt') } : null,
      { icon: 'edit', label: 'Umbenennen', onclick: async () => {
        const n = await promptDialog({ title: 'Umbenennen', label: 'Neuer Name', value: e.name, confirm: 'Umbenennen' });
        if (n && n !== e.name) op({ op: 'rename', from: full, to: join(path, n) });
      } },
      { icon: 'copy', label: 'Duplizieren', onclick: async () => {
        const dot = e.name.lastIndexOf('.');
        const def = !e.dir && dot > 0 ? `${e.name.slice(0, dot)}-kopie${e.name.slice(dot)}` : `${e.name}-kopie`;
        const n = await promptDialog({ title: 'Duplizieren', label: 'Name der Kopie', value: def, confirm: 'Kopieren' });
        if (n) op({ op: 'copy', from: full, to: join(path, n) });
      } },
      { icon: 'chevron', label: 'Verschieben nach …', onclick: async () => {
        const n = await promptDialog({ title: 'Verschieben', label: 'Zielpfad (relativ zum Server-Ordner)', value: full, confirm: 'Verschieben' });
        if (n && n !== full) op({ op: 'rename', from: full, to: n.replace(/^\/+/, '') });
      } },
      '-',
      { icon: 'trash', label: 'Löschen', danger: true, onclick: async () => {
        if (!await confirmDialog({ title: `„${e.name}“ löschen?`, text: e.dir ? 'Der Ordner wird mit seinem gesamten Inhalt gelöscht.' : 'Die Datei wird endgültig gelöscht.', confirm: 'Löschen', danger: true })) return;
        op({ op: 'delete', paths: [full] }, 'Gelöscht');
      } },
    ]);
  }

  async function openEditor(p) {
    let content;
    try { content = (await get(`/api/instances/${id}/files/content?path=${encodeURIComponent(p)}`)).content; }
    catch (e) { toast(e.message, 'bad'); return; }
    const ta = h('textarea', { class: 'editor', spellcheck: false, 'aria-label': p }, content);
    let dirty = false;
    const info = h('span', { class: 'faint', style: { fontSize: '13px' } });
    const save = async () => {
      if (p.endsWith('.json')) { try { JSON.parse(ta.value); } catch (e) { info.textContent = `JSON-Fehler: ${e.message}`; info.style.color = 'var(--bad)'; return; } }
      await put(`/api/instances/${id}/files/content`, { path: p, content: ta.value });
      dirty = false; info.textContent = 'Gespeichert'; info.style.color = '';
    };
    ta.addEventListener('input', () => { dirty = true; info.textContent = 'Ungespeichert'; info.style.color = ''; });
    ta.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save().catch((er) => toast(er.message, 'bad')); }
      if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); const s = ta.selectionStart; ta.setRangeText('  ', s, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); }
    });
    const close = async () => {
      if (dirty && !await confirmDialog({ title: 'Änderungen verwerfen?', text: 'Die Datei hat ungespeicherte Änderungen.', confirm: 'Verwerfen', danger: true })) return;
      fill(wrap, head, status, panel); load();
    };
    fill(wrap, h('div', { class: 'panel editor-wrap' },
      h('div', { class: 'panel-head' }, btn('', { icon: 'back', cls: 'ghost icon sm', title: 'Zurück', onclick: close }),
        h('code', { class: 'mono', style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' } }, p), info,
        btn('Herunterladen', { icon: 'download', cls: 'sm', onclick: () => dl([p]) }),
        btn('Speichern', { cls: 'primary sm', onclick: save })), ta));
    if (p.includes('server-settings.json') || p.includes('mod-list.json')) {
      wrap.prepend(note('Änderungen an Server- und Mod-Einstellungen greifen beim nächsten Start.'));
    }
    ta.focus({ preventScroll: true });
  }

  const head = h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' } }, crumbs, toolbar);
  wrap.append(head, status, panel);
  await load(path);
}
