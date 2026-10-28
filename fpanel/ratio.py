"""Ratio-Rechner: gemeinsamer Datenbestand (Items, Rezepte, Maschinen) für alle
Benutzer und persönliche Rechner, die lesend geteilt werden können.

Der Datenbestand wird pro Eintrag gespeichert. Jede Änderung erhöht eine globale
Revision und wird live an alle Browser verteilt; gleichzeitige Bearbeitungen
verschiedener Einträge überschreiben sich so nicht gegenseitig.
"""
import hashlib
import json
import secrets
import time

from fastapi import APIRouter, Body, Depends, HTTPException, Request, Response

from . import db, events
from .auth import current_user, require_admin

router = APIRouter(prefix="/api/ratio")

KINDS = ("items", "recipes", "machines")
MAX_ENTITY = 64 * 1024
MAX_TOTAL = 8 * 1024 * 1024
MAX_PLAN = 2 * 1024 * 1024
MAX_PLANS = 50
KEEP_BACKUPS = 30
AUTO_BACKUP_EVERY = 24 * 3600

SCHEMA = """
CREATE TABLE IF NOT EXISTS ratio_entities (
    kind TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    rev INTEGER NOT NULL,
    updated_at REAL NOT NULL,
    updated_by INTEGER,
    PRIMARY KEY (kind, id)
);
CREATE TABLE IF NOT EXISTS ratio_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ratio_plans (
    id TEXT PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS ratio_shares (
    plan_id TEXT NOT NULL REFERENCES ratio_plans(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_at REAL NOT NULL,
    PRIMARY KEY (plan_id, user_id)
);
CREATE TABLE IF NOT EXISTS ratio_icons (
    key TEXT PRIMARY KEY,
    mime TEXT NOT NULL,
    data BLOB NOT NULL,
    created_at REAL NOT NULL,
    created_by INTEGER
);
CREATE TABLE IF NOT EXISTS ratio_backups (
    id INTEGER PRIMARY KEY,
    ts REAL NOT NULL,
    user_id INTEGER,
    reason TEXT NOT NULL,
    counts TEXT NOT NULL,
    data TEXT NOT NULL
);
"""


def init():
    with db._lock:
        c = db.conn()
        c.executescript(SCHEMA)
        c.commit()


# --- Hilfen -----------------------------------------------------------------

def _meta(c, key, default=None):
    r = c.execute("SELECT value FROM ratio_meta WHERE key=?", (key,)).fetchone()
    return json.loads(r[0]) if r else default


def _set_meta(c, key, value):
    c.execute("INSERT INTO ratio_meta(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
              (key, json.dumps(value)))


def _clean_entity(o):
    if not isinstance(o, dict):
        raise HTTPException(400, "Ungültiger Eintrag")
    eid = o.get("id")
    if not isinstance(eid, str) or not (0 < len(eid) <= 64):
        raise HTTPException(400, "Eintrag ohne gültige ID")
    raw = json.dumps(o, separators=(",", ":"), ensure_ascii=False)
    if len(raw) > MAX_ENTITY:
        raise HTTPException(413, "Eintrag zu groß")
    return eid, raw


def _snapshot(c):
    out = {k: [] for k in KINDS}
    revs = {k: {} for k in KINDS}
    for kind, eid, data, rev in c.execute("SELECT kind, id, data, rev FROM ratio_entities ORDER BY rowid"):
        if kind in out:
            out[kind].append(json.loads(data))
            revs[kind][eid] = rev
    return out, revs


def _counts(d):
    return {k: len(d.get(k) or []) for k in KINDS}


def _backup(c, user_id, reason):
    cur, _ = _snapshot(c)
    if not any(cur.values()):
        return
    c.execute("INSERT INTO ratio_backups(ts, user_id, reason, counts, data) VALUES(?,?,?,?,?)",
              (time.time(), user_id, reason, json.dumps(_counts(cur)), json.dumps(cur, separators=(",", ":"))))
    c.execute("DELETE FROM ratio_backups WHERE id NOT IN (SELECT id FROM ratio_backups ORDER BY id DESC LIMIT ?)",
              (KEEP_BACKUPS,))


def _validate_db(p):
    if not isinstance(p, dict) or not all(isinstance(p.get(k), list) for k in KINDS):
        raise HTTPException(400, "items, recipes und machines fehlen")
    rows = []
    total = 0
    for k in KINDS:
        seen = set()
        for o in p[k]:
            eid, raw = _clean_entity(o)
            if eid in seen:
                continue
            seen.add(eid)
            total += len(raw)
            rows.append((k, eid, raw))
    if total > MAX_TOTAL:
        raise HTTPException(413, "Datenbestand zu groß (max. 8 MB)")
    return rows


def _replace(c, rows, user_id):
    rev = _meta(c, "rev", 0) + 1
    now = time.time()
    c.execute("DELETE FROM ratio_entities")
    c.executemany("INSERT INTO ratio_entities(kind, id, data, rev, updated_at, updated_by) VALUES(?,?,?,?,?,?)",
                  [(k, eid, raw, rev, now, user_id) for k, eid, raw in rows])
    _set_meta(c, "rev", rev)
    _set_meta(c, "initialized", True)
    return rev


# --- Gemeinsamer Datenbestand -----------------------------------------------

@router.get("/db")
async def get_db(user=Depends(current_user)):
    with db._lock:
        c = db.conn()
        data, revs = _snapshot(c)
        return {"initialized": bool(_meta(c, "initialized", False)), "rev": _meta(c, "rev", 0), **data, "revs": revs}


@router.get("/rev")
async def get_rev(user=Depends(current_user)):
    with db._lock:
        return {"rev": _meta(db.conn(), "rev", 0)}


@router.post("/db/init")
async def init_db(p: dict = Body(...), user=Depends(current_user)):
    """Erstbefüllung – nur solange der Bestand noch nie angelegt wurde."""
    rows = _validate_db(p)
    with db._lock:
        c = db.conn()
        if _meta(c, "initialized", False):
            raise HTTPException(409, "Der gemeinsame Datenbestand existiert bereits.")
        rev = _replace(c, rows, user["id"])
        c.commit()
    db.audit(user["id"], "ratio.init", None, json.dumps(_counts(p)))
    events.publish({"type": "ratio_db", "reset": True, "rev": rev, "by": user["username"]})
    return {"rev": rev}


@router.post("/db/changes")
async def apply_changes(p: dict = Body(...), user=Depends(current_user)):
    """{client, changes: {items: {upsert: [...], delete: [ids]}, recipes: ..., machines: ...}}"""
    ch = p.get("changes") or {}
    if not isinstance(ch, dict):
        raise HTTPException(400, "Ungültige Änderungen")
    ups, dels = [], []
    for k in KINDS:
        part = ch.get(k) or {}
        for o in part.get("upsert") or []:
            eid, raw = _clean_entity(o)
            ups.append((k, eid, raw))
        for eid in part.get("delete") or []:
            if isinstance(eid, str) and len(eid) <= 64:
                dels.append((k, eid))
    if not ups and not dels:
        with db._lock:
            return {"rev": _meta(db.conn(), "rev", 0), "revs": {}}
    now = time.time()
    with db._lock:
        c = db.conn()
        last = _meta(c, "last_backup", 0)
        if now - last > AUTO_BACKUP_EVERY:
            _backup(c, None, "Automatisch")
            _set_meta(c, "last_backup", now)
        rev = _meta(c, "rev", 0) + 1
        for k, eid, raw in ups:
            c.execute("""INSERT INTO ratio_entities(kind, id, data, rev, updated_at, updated_by) VALUES(?,?,?,?,?,?)
                         ON CONFLICT(kind, id) DO UPDATE SET data=excluded.data, rev=excluded.rev,
                         updated_at=excluded.updated_at, updated_by=excluded.updated_by""",
                      (k, eid, raw, rev, now, user["id"]))
        for k, eid in dels:
            c.execute("DELETE FROM ratio_entities WHERE kind=? AND id=?", (k, eid))
        total = c.execute("SELECT COALESCE(SUM(LENGTH(data)),0) FROM ratio_entities").fetchone()[0]
        if total > MAX_TOTAL:
            c.rollback()
            raise HTTPException(413, "Datenbestand zu groß (max. 8 MB)")
        _set_meta(c, "rev", rev)
        _set_meta(c, "initialized", True)
        c.commit()
    out = {k: {"upsert": [json.loads(raw) for kk, _, raw in ups if kk == k],
               "delete": [eid for kk, eid in dels if kk == k]} for k in KINDS}
    events.publish({"type": "ratio_db", "rev": rev, "by": user["username"],
                    "client": str(p.get("client") or "")[:40], "changes": out})
    return {"rev": rev}


@router.post("/db/replace")
async def replace_db(p: dict = Body(...), user=Depends(current_user)):
    require_admin(user)
    rows = _validate_db(p)
    reason = str(p.get("reason") or "Ersetzt")[:80]
    with db._lock:
        c = db.conn()
        _backup(c, user["id"], f"Vor: {reason}")
        rev = _replace(c, rows, user["id"])
        c.commit()
    db.audit(user["id"], "ratio.replace", None, reason)
    events.publish({"type": "ratio_db", "reset": True, "rev": rev, "by": user["username"]})
    return {"rev": rev}


@router.get("/backups")
async def list_backups(user=Depends(current_user)):
    require_admin(user)
    rows = db.q("""SELECT b.id, b.ts, b.reason, b.counts, u.username FROM ratio_backups b
                   LEFT JOIN users u ON u.id=b.user_id ORDER BY b.id DESC""")
    return [{**r, "counts": json.loads(r["counts"])} for r in rows]


@router.post("/backups")
async def make_backup(user=Depends(current_user)):
    require_admin(user)
    with db._lock:
        c = db.conn()
        _backup(c, user["id"], "Manuell")
        c.commit()
    return {"ok": True}


@router.post("/backups/{bid}/restore")
async def restore_backup(bid: int, user=Depends(current_user)):
    require_admin(user)
    r = db.q1("SELECT data, ts FROM ratio_backups WHERE id=?", (bid,))
    if not r:
        raise HTTPException(404, "Sicherung nicht gefunden")
    rows = _validate_db(json.loads(r["data"]))
    with db._lock:
        c = db.conn()
        _backup(c, user["id"], "Vor Wiederherstellung")
        rev = _replace(c, rows, user["id"])
        c.commit()
    db.audit(user["id"], "ratio.restore", None, str(bid))
    events.publish({"type": "ratio_db", "reset": True, "rev": rev, "by": user["username"]})
    return {"rev": rev}


# --- Icons (vom Benutzer hochgeladen, z. B. aus der eigenen Spielinstallation) ---

MAX_ICON = 96 * 1024
ICON_TYPES = {b"\x89PNG\r\n\x1a\n": "image/png", b"RIFF": "image/webp"}


@router.post("/icons")
async def upload_icon(request: Request, user=Depends(current_user)):
    raw = await request.body()
    if not raw or len(raw) > MAX_ICON:
        raise HTTPException(413, "Icon zu groß (max. 96 KB)")
    mime = next((m for sig, m in ICON_TYPES.items() if raw.startswith(sig)), None)
    if not mime or (mime == "image/webp" and raw[8:12] != b"WEBP"):
        raise HTTPException(400, "Nur PNG oder WebP")
    key = hashlib.sha256(raw).hexdigest()[:20]
    db.x("INSERT OR IGNORE INTO ratio_icons(key, mime, data, created_at, created_by) VALUES(?,?,?,?,?)",
         (key, mime, raw, time.time(), user["id"]))
    return {"key": key}


@router.get("/icon/{key}")
async def get_icon(key: str, user=Depends(current_user)):
    r = db.q1("SELECT mime, data FROM ratio_icons WHERE key=?", (key[:40],))
    if not r:
        raise HTTPException(404)
    return Response(r["data"], media_type=r["mime"],
                    headers={"Cache-Control": "private, max-age=31536000, immutable"})


# --- Persönliche Rechner ----------------------------------------------------

def _plan_or_404(pid):
    r = db.q1("SELECT * FROM ratio_plans WHERE id=?", (pid,))
    if not r:
        raise HTTPException(404, "Rechner nicht gefunden")
    return r


def _shared_ids(pid):
    return {r["user_id"] for r in db.q("SELECT user_id FROM ratio_shares WHERE plan_id=?", (pid,))}


def _can_read(pl, user):
    return pl["owner_id"] == user["id"] or user["id"] in _shared_ids(pl["id"])


def _own_or_403(pid, user):
    pl = _plan_or_404(pid)
    if pl["owner_id"] != user["id"]:
        if user["id"] in _shared_ids(pid):
            raise HTTPException(403, "Dieser Rechner wurde nur zum Ansehen mit dir geteilt.")
        raise HTTPException(404, "Rechner nicht gefunden")
    return pl


def _plan_data(p):
    d = p.get("data")
    if not isinstance(d, dict):
        raise HTTPException(400, "Ungültige Rechner-Daten")
    raw = json.dumps(d, separators=(",", ":"), ensure_ascii=False)
    if len(raw) > MAX_PLAN:
        raise HTTPException(413, "Rechner zu groß")
    return raw


def _plan_name(p, default=None):
    n = str(p.get("name") or default or "").strip()[:80]
    if not n:
        raise HTTPException(400, "Bitte einen Namen angeben.")
    return n


def _notify_plan(pid, owner_id, **extra):
    viewers = _shared_ids(pid) | {owner_id}
    events.publish({"type": "ratio_plan", "id": pid, **extra}, lambda u: u["id"] in viewers)


@router.get("/users")
async def share_users(user=Depends(current_user)):
    return db.q("SELECT id, username FROM users WHERE id<>? ORDER BY username COLLATE NOCASE", (user["id"],))


@router.get("/plans")
async def list_plans(user=Depends(current_user)):
    own = db.q("SELECT id, name, updated_at FROM ratio_plans WHERE owner_id=? ORDER BY created_at", (user["id"],))
    shares = db.q("""SELECT s.plan_id, u.id, u.username FROM ratio_shares s JOIN users u ON u.id=s.user_id
                     JOIN ratio_plans p ON p.id=s.plan_id WHERE p.owner_id=? ORDER BY u.username COLLATE NOCASE""",
                  (user["id"],))
    for o in own:
        o["shared_with"] = [{"id": s["id"], "username": s["username"]} for s in shares if s["plan_id"] == o["id"]]
    shared = db.q("""SELECT p.id, p.name, p.updated_at, u.id owner_id, u.username owner FROM ratio_shares s
                     JOIN ratio_plans p ON p.id=s.plan_id JOIN users u ON u.id=p.owner_id
                     WHERE s.user_id=? ORDER BY u.username COLLATE NOCASE, p.name COLLATE NOCASE""", (user["id"],))
    return {"own": own, "shared": shared}


@router.post("/plans")
async def create_plan(p: dict = Body(...), user=Depends(current_user)):
    n = db.q1("SELECT COUNT(*) n FROM ratio_plans WHERE owner_id=?", (user["id"],))["n"]
    if n >= MAX_PLANS:
        raise HTTPException(400, f"Maximal {MAX_PLANS} Rechner pro Benutzer.")
    pid = secrets.token_hex(6)
    now = time.time()
    db.x("INSERT INTO ratio_plans(id, owner_id, name, data, created_at, updated_at) VALUES(?,?,?,?,?,?)",
         (pid, user["id"], _plan_name(p, "Neuer Rechner"), _plan_data(p), now, now))
    return {"id": pid}


@router.get("/plans/{pid}")
async def get_plan(pid: str, user=Depends(current_user)):
    pl = _plan_or_404(pid)
    if not _can_read(pl, user):
        raise HTTPException(404, "Rechner nicht gefunden")
    owner = db.q1("SELECT id, username FROM users WHERE id=?", (pl["owner_id"],))
    return {"id": pl["id"], "name": pl["name"], "data": json.loads(pl["data"]), "updated_at": pl["updated_at"],
            "owner": owner, "readonly": pl["owner_id"] != user["id"]}


@router.put("/plans/{pid}")
async def update_plan(pid: str, request: Request, user=Depends(current_user)):
    pl = _own_or_403(pid, user)
    raw = await request.body()
    if len(raw) > MAX_PLAN + 4096:
        raise HTTPException(413, "Rechner zu groß")
    try:
        p = json.loads(raw)
    except ValueError:
        raise HTTPException(400, "Ungültiges JSON")
    sets, args = [], []
    if "name" in p:
        sets.append("name=?"); args.append(_plan_name(p))
    if "data" in p:
        sets.append("data=?"); args.append(_plan_data(p))
    if not sets:
        return {"updated_at": pl["updated_at"]}
    now = time.time()
    db.x(f"UPDATE ratio_plans SET {', '.join(sets)}, updated_at=? WHERE id=?", (*args, now, pid))
    _notify_plan(pid, pl["owner_id"], updated_at=now, client=str(p.get("client") or "")[:40],
                 renamed="name" in p)
    return {"updated_at": now}


@router.delete("/plans/{pid}")
async def delete_plan(pid: str, user=Depends(current_user)):
    pl = _own_or_403(pid, user)
    viewers = _shared_ids(pid)
    db.x("DELETE FROM ratio_plans WHERE id=?", (pid,))
    events.publish({"type": "ratio_plan", "id": pid, "deleted": True}, lambda u: u["id"] in viewers | {pl["owner_id"]})
    return {"ok": True}


@router.post("/plans/{pid}/shares")
async def add_share(pid: str, p: dict = Body(...), user=Depends(current_user)):
    pl = _own_or_403(pid, user)
    u = db.q1("SELECT id, username FROM users WHERE username=?", ((p.get("username") or "").strip(),))
    if not u:
        raise HTTPException(404, "Diesen Benutzer gibt es nicht.")
    if u["id"] == user["id"]:
        raise HTTPException(400, "Das ist dein eigener Rechner.")
    db.x("INSERT OR IGNORE INTO ratio_shares(plan_id, user_id, added_at) VALUES(?,?,?)", (pid, u["id"], time.time()))
    events.publish({"type": "ratio_shares"}, lambda x: x["id"] == u["id"])
    return {"ok": True}


@router.delete("/plans/{pid}/shares/{uid}")
async def remove_share(pid: str, uid: int, user=Depends(current_user)):
    pl = _plan_or_404(pid)
    # Besitzer entfernt jemanden – oder ein Empfänger blendet den Rechner für sich aus
    if pl["owner_id"] != user["id"] and uid != user["id"]:
        raise HTTPException(403, "Nur der Besitzer kann Freigaben ändern.")
    db.x("DELETE FROM ratio_shares WHERE plan_id=? AND user_id=?", (pid, uid))
    events.publish({"type": "ratio_shares", "removed": pid}, lambda x: x["id"] == uid)
    return {"ok": True}
