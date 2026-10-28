"""HTTP-API, WebSockets und Auslieferung der Oberfläche."""
import asyncio
import json
import os
import shutil
import time
from contextlib import asynccontextmanager
from pathlib import Path

import psutil
from fastapi import Body, Depends, FastAPI, File, Form, HTTPException, Query, Request, Response, UploadFile, \
    WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse

from . import auth, config, db, events, files, instances as inst_mod, mods, net, ratio, versions, webserver
from .auth import can_access, current_user, require_admin
from .rcon import RconError
from .runner import runner


@asynccontextmanager
async def lifespan(app):
    config.ensure_dirs()
    db.init()
    ratio.init()
    if not db.get_setting("primary_ip"):
        db.set_setting("primary_ip", net.detect_primary_ip())
    loop = asyncio.get_running_loop()
    loop.create_task(inst_mod.autostart_all())
    loop.create_task(inst_mod.sampler())
    loop.create_task(_warm())
    yield


async def _warm():
    try:
        await versions.refresh_available()
    except Exception:
        pass


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.exception_handler(ValueError)
async def _value_error(request, exc):
    return JSONResponse({"detail": str(exc)}, status_code=400)


@app.exception_handler(RuntimeError)
async def _runtime_error(request, exc):
    return JSONResponse({"detail": str(exc)}, status_code=400)


@app.exception_handler(RconError)
async def _rcon_error(request, exc):
    return JSONResponse({"detail": str(exc)}, status_code=409)


def client_ip(request: Request):
    return request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (request.client.host if request.client else "")


def set_cookie(resp: Response, request: Request, token: str):
    secure = request.headers.get("x-forwarded-proto", request.url.scheme) == "https"
    resp.set_cookie(auth.COOKIE, token, max_age=config.SESSION_DAYS * 86400, httponly=True, samesite="lax",
                    secure=secure, path="/")


# --- Anmeldung --------------------------------------------------------------

@app.get("/api/state")
async def state(request: Request):
    user = auth.user_from_token(request.cookies.get(auth.COOKIE))
    return {"setup": db.q1("SELECT COUNT(*) n FROM users")["n"] == 0, "user": user,
            "base_domain": db.get_setting("base_domain") if user else None,
            "dedicated_ips": db.get_setting("dedicated_ips") if user and user["role"] == "admin" else []}


@app.post("/api/setup")
async def setup(request: Request, response: Response, p: dict = Body(...)):
    if db.q1("SELECT COUNT(*) n FROM users")["n"] > 0:
        raise HTTPException(409, "Das Panel ist bereits eingerichtet.")
    username = (p.get("username") or "").strip()
    _check_username(username)
    auth.validate_password(p.get("password"))
    db.x("INSERT INTO users(username, pw_hash, role, max_instances, max_memory_mb, created_at) VALUES(?,?,?,?,?,?)",
         (username, auth.hash_pw(p["password"]), "admin", 999, 1 << 20, time.time()))
    u = db.q1("SELECT id FROM users WHERE username=?", (username,))
    set_cookie(response, request, auth.create_session(u["id"], client_ip(request)))
    return {"ok": True}


def _check_username(name):
    import re
    if not re.match(r"^[A-Za-z0-9_.-]{3,32}$", name or ""):
        raise HTTPException(400, "Benutzername: 3–32 Zeichen, Buchstaben, Ziffern, . _ -")


@app.post("/api/login")
async def login(request: Request, response: Response, p: dict = Body(...)):
    ip = client_ip(request)
    auth.throttle(ip)
    u = db.q1("SELECT id, pw_hash FROM users WHERE username=?", ((p.get("username") or "").strip(),))
    if not u or not auth.check_pw(p.get("password") or "", u["pw_hash"]):
        auth.record_fail(ip)
        raise HTTPException(401, "Benutzername oder Passwort stimmt nicht.")
    set_cookie(response, request, auth.create_session(u["id"], ip))
    return {"ok": True}


@app.post("/api/logout")
async def logout(request: Request, response: Response):
    tok = request.cookies.get(auth.COOKIE)
    if tok:
        db.x("DELETE FROM sessions WHERE token=?", (tok,))
    response.delete_cookie(auth.COOKIE, path="/")
    return {"ok": True}


@app.post("/api/me/password")
async def change_password(p: dict = Body(...), user=Depends(current_user)):
    row = db.q1("SELECT pw_hash FROM users WHERE id=?", (user["id"],))
    if not auth.check_pw(p.get("current") or "", row["pw_hash"]):
        raise HTTPException(400, "Das aktuelle Passwort stimmt nicht.")
    auth.validate_password(p.get("new"))
    db.x("UPDATE users SET pw_hash=? WHERE id=?", (auth.hash_pw(p["new"]), user["id"]))
    return {"ok": True}


# --- Persönliche Daten (z. B. Ratio-Rechner) --------------------------------

USER_DATA_KEYS = {"ratio", "ratio_ui"}


@app.get("/api/me/data/{key}")
async def get_user_data(key: str, user=Depends(current_user)):
    if key not in USER_DATA_KEYS:
        raise HTTPException(404)
    r = db.q1("SELECT value, updated_at FROM user_data WHERE user_id=? AND key=?", (user["id"], key))
    return {"value": json.loads(r["value"]) if r else None, "updated_at": r["updated_at"] if r else None}


@app.put("/api/me/data/{key}")
async def put_user_data(key: str, request: Request, user=Depends(current_user)):
    if key not in USER_DATA_KEYS:
        raise HTTPException(404)
    raw = await request.body()
    if len(raw) > 4 * 1024 * 1024:
        raise HTTPException(413, "Daten zu groß (max. 4 MB)")
    try:
        value = json.loads(raw)
    except ValueError:
        raise HTTPException(400, "Ungültiges JSON")
    db.x("""INSERT INTO user_data(user_id, key, value, updated_at) VALUES(?,?,?,?)
            ON CONFLICT(user_id, key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at""",
         (user["id"], key, json.dumps(value, separators=(",", ":")), time.time()))
    return {"ok": True}


app.include_router(ratio.router)


# --- Benutzer (Admin) -------------------------------------------------------

def _user_row(u):
    owned = db.q1("SELECT COUNT(*) n, COALESCE(SUM(memory_mb),0) m FROM instances WHERE owner_id=?", (u["id"],))
    return {**{k: u[k] for k in ("id", "username", "role", "max_instances", "max_memory_mb", "created_at", "last_login")},
            "instances": owned["n"], "memory_used": owned["m"]}


@app.get("/api/users")
async def users(user=Depends(current_user)):
    require_admin(user)
    return [_user_row(u) for u in db.q("SELECT * FROM users ORDER BY username COLLATE NOCASE")]


@app.post("/api/users")
async def create_user(p: dict = Body(...), user=Depends(current_user)):
    require_admin(user)
    name = (p.get("username") or "").strip()
    _check_username(name)
    auth.validate_password(p.get("password"))
    if db.q1("SELECT 1 FROM users WHERE username=?", (name,)):
        raise HTTPException(409, "Diesen Benutzernamen gibt es bereits.")
    role = "admin" if p.get("role") == "admin" else "user"
    db.x("INSERT INTO users(username, pw_hash, role, max_instances, max_memory_mb, created_at) VALUES(?,?,?,?,?,?)",
         (name, auth.hash_pw(p["password"]), role, int(p.get("max_instances") or 3),
          int(p.get("max_memory_mb") or 4096), time.time()))
    db.audit(user["id"], "user.create", detail=name)
    return {"ok": True}


@app.patch("/api/users/{uid}")
async def update_user(uid: int, p: dict = Body(...), user=Depends(current_user)):
    require_admin(user)
    u = db.q1("SELECT * FROM users WHERE id=?", (uid,))
    if not u:
        raise HTTPException(404, "Benutzer nicht gefunden")
    if "role" in p:
        role = "admin" if p["role"] == "admin" else "user"
        if uid == user["id"] and role != "admin":
            raise HTTPException(400, "Du kannst dir die Admin-Rolle nicht selbst entziehen.")
        db.x("UPDATE users SET role=? WHERE id=?", (role, uid))
    for k in ("max_instances", "max_memory_mb"):
        if k in p:
            db.x(f"UPDATE users SET {k}=? WHERE id=?", (max(0, int(p[k])), uid))
    if p.get("password"):
        auth.validate_password(p["password"])
        db.x("UPDATE users SET pw_hash=? WHERE id=?", (auth.hash_pw(p["password"]), uid))
        db.x("DELETE FROM sessions WHERE user_id=?", (uid,))
    return {"ok": True}


@app.delete("/api/users/{uid}")
async def delete_user(uid: int, user=Depends(current_user)):
    require_admin(user)
    if uid == user["id"]:
        raise HTTPException(400, "Du kannst dich nicht selbst löschen.")
    if db.q1("SELECT 1 FROM instances WHERE owner_id=?", (uid,)):
        raise HTTPException(409, "Der Benutzer besitzt noch Server. Übertrage oder lösche sie zuerst.")
    db.x("DELETE FROM users WHERE id=?", (uid,))
    return {"ok": True}


# --- Instanzen --------------------------------------------------------------

def _inst_or_404(iid, user):
    i = inst_mod.get(iid)
    if not i or not can_access(user, iid):
        raise HTTPException(404, "Server nicht gefunden")
    return i


def _inst_view(i, user):
    owner = db.q1("SELECT username FROM users WHERE id=?", (i["owner_id"],))
    members = db.q("SELECT u.id, u.username FROM members m JOIN users u ON u.id=m.user_id WHERE m.instance_id=?",
                   (i["id"],))
    role = "owner" if i["owner_id"] == user["id"] else ("member" if any(m["id"] == user["id"] for m in members)
                                                        else "admin")
    return {
        "id": i["id"], "name": i["name"], "subdomain": i["subdomain"], "version": i["version"],
        "port": i["port"], "bind_ip": i["bind_ip"], "public_ip": i["public_ip"], "memory_mb": i["memory_mb"],
        "autostart": bool(i["autostart"]), "auto_restart": bool(i["auto_restart"]),
        "options": i["options"], "created_at": i["created_at"],
        "owner": {"id": i["owner_id"], "username": owner["username"] if owner else "?"},
        "members": members, "role": role,
        "address": net.connect_address(i),
        "default_port": i["port"] == config.DEFAULT_GAME_PORT,
        "installed": versions.is_installed(i["version"]),
        "space_age": inst_mod.space_age_enabled(i["id"]) if inst_mod.has_dlc(i["version"]) else None,
        "dlc_available": inst_mod.has_dlc(i["version"]),
        "status": inst_mod.public_status(i["id"]),
    }


@app.get("/api/instances")
async def list_instances(user=Depends(current_user)):
    ids = set(auth.visible_instance_ids(user))
    out = []
    for i in inst_mod.all_instances():
        if i["id"] in ids:
            v = _inst_view(i, user)
            s = inst_mod.st(i["id"])
            v["history"] = {"cpu": list(s["hist_cpu"])[-90:], "mem": list(s["hist_mem"])[-90:]}
            out.append(v)
    return out


@app.get("/api/instances/{iid}")
async def get_instance(iid: str, user=Depends(current_user)):
    i = _inst_or_404(iid, user)
    v = _inst_view(i, user)
    s = inst_mod.st(iid)
    v["history"] = {"cpu": list(s["hist_cpu"]), "mem": list(s["hist_mem"])}
    return v


def _check_quota(user, add_instances, add_memory, exclude_id=None):
    if user["role"] == "admin":
        return
    row = db.q1("SELECT COUNT(*) n, COALESCE(SUM(memory_mb),0) m FROM instances WHERE owner_id=? AND id != ?",
                (user["id"], exclude_id or ""))
    if row["n"] + add_instances > user["max_instances"]:
        raise HTTPException(403, f"Limit erreicht: maximal {user['max_instances']} eigene Server.")
    if row["m"] + add_memory > user["max_memory_mb"]:
        raise HTTPException(403, f"RAM-Kontingent überschritten: {user['max_memory_mb']} MB insgesamt, "
                                 f"{row['m']} MB bereits vergeben.")


@app.post("/api/instances")
async def create_instance(p: dict = Body(...), user=Depends(current_user)):
    mem = int(p.get("memory_mb") or db.get_setting("default_memory_mb"))
    if mem < 512:
        raise HTTPException(400, "Mindestens 512 MB RAM.")
    _check_quota(user, 1, mem)
    version = p.get("version") or "latest"
    if version == "latest":
        await versions.refresh_available()
        version = versions.latest_stable() or (versions.installed() or [None])[0]
        if not version:
            raise HTTPException(503, "factorio.com ist nicht erreichbar und keine Version ist installiert.")
    dedicated = p.get("dedicated_ip") or None
    if dedicated and user["role"] != "admin":
        raise HTTPException(403, "Eigene IP-Adressen vergibt nur ein Admin.")
    i = await inst_mod.create(user, p.get("name"), p.get("subdomain"), version, mem, p.get("space_age", True),
                              p.get("preset"), p.get("seed"), p.get("game_password"), dedicated)
    task = None
    if not versions.is_installed(version):
        task = events.start_task("version", f"Factorio {version} installieren",
                                 lambda prog: versions.install(version, prog), user["id"], i["id"])
    dns_error = None
    try:
        await net.dns_upsert(i["subdomain"], i["public_ip"] or await net.public_ipv4())
    except Exception as e:
        dns_error = str(e)
    return {"instance": _inst_view(i, user), "task": task, "dns_error": dns_error}


@app.patch("/api/instances/{iid}")
async def update_instance(iid: str, p: dict = Body(...), user=Depends(current_user)):
    i = _inst_or_404(iid, user)
    if "name" in p:
        name = (p["name"] or "").strip()[:60]
        if not name:
            raise HTTPException(400, "Name fehlt")
        db.x("UPDATE instances SET name=? WHERE id=?", (name, iid))
    if "memory_mb" in p:
        mem = int(p["memory_mb"])
        if mem < 512:
            raise HTTPException(400, "Mindestens 512 MB RAM.")
        owner = db.q1("SELECT * FROM users WHERE id=?", (i["owner_id"],))
        if user["role"] != "admin":
            _check_quota(owner, 0, mem, exclude_id=iid)
        db.x("UPDATE instances SET memory_mb=? WHERE id=?", (mem, iid))
    for k in ("autostart", "auto_restart"):
        if k in p:
            db.x(f"UPDATE instances SET {k}=? WHERE id=?", (1 if p[k] else 0, iid))
    opts = dict(i["options"])
    for k in ("preset", "seed", "save", "whitelist"):
        if k in p:
            if k == "preset" and p[k] not in inst_mod.PRESETS:
                raise HTTPException(400, "Unbekanntes Preset")
            if k == "save" and p[k]:
                files.resolve(iid, f"saves/{Path(p[k]).name}")
                p[k] = Path(p[k]).name
            opts[k] = p[k]
    inst_mod.save_options(iid, opts)
    dns_error = None
    if "subdomain" in p and p["subdomain"] != i["subdomain"]:
        sub = (p["subdomain"] or "").lower()
        if not inst_mod.SUBDOMAIN_RE.match(sub):
            raise HTTPException(400, "Subdomain: nur a–z, 0–9 und Bindestrich, max. 32 Zeichen")
        if db.q1("SELECT 1 FROM instances WHERE subdomain=? AND id!=?", (sub, iid)):
            raise HTTPException(409, f"Die Subdomain „{sub}“ ist bereits vergeben")
        db.x("UPDATE instances SET subdomain=? WHERE id=?", (sub, iid))
        try:
            await net.dns_delete(i["subdomain"])
            await net.dns_upsert(sub, i["public_ip"] or await net.public_ipv4())
        except Exception as e:
            dns_error = str(e)
    if "name" in p:
        # Servername in server-settings.json mitziehen, falls er dort noch dem alten entspricht
        sp = inst_mod.data_dir(iid) / "server-settings.json"
        ss = inst_mod.read_json(sp, {})
        if ss.get("name") in (None, "", i["name"]):
            ss["name"] = p["name"].strip()[:60]
            inst_mod.write_json(sp, ss)
    inst_mod.write_launch(iid)
    db.audit(user["id"], "instance.update", iid, json.dumps(list(p.keys())))
    return {"instance": _inst_view(inst_mod.get(iid), user), "dns_error": dns_error}


@app.delete("/api/instances/{iid}")
async def delete_instance(iid: str, p: dict = Body(default={}), user=Depends(current_user)):
    i = _inst_or_404(iid, user)
    if (p.get("confirm") or "") != i["name"]:
        raise HTTPException(400, "Zum Löschen den Servernamen exakt eingeben.")
    await inst_mod.delete(iid, user)
    return {"ok": True}


@app.post("/api/instances/{iid}/power")
async def power(iid: str, p: dict = Body(...), user=Depends(current_user)):
    _inst_or_404(iid, user)
    action = p.get("action")
    if action == "start":
        await inst_mod.start(iid, user)
    elif action == "stop":
        await inst_mod.stop(iid, user)
    elif action == "restart":
        asyncio.get_running_loop().create_task(inst_mod.restart(iid, user))
    elif action == "kill":
        await inst_mod.kill(iid, user)
    else:
        raise HTTPException(400, "Unbekannte Aktion")
    return inst_mod.public_status(iid)


@app.post("/api/instances/{iid}/command")
async def command(iid: str, p: dict = Body(...), user=Depends(current_user)):
    _inst_or_404(iid, user)
    cmd = (p.get("command") or "").strip()
    if not cmd:
        raise HTTPException(400, "Leerer Befehl")
    out = await inst_mod.rcon(iid, cmd)
    db.audit(user["id"], "console", iid, cmd[:200])
    return {"output": out}


@app.post("/api/instances/{iid}/default-port")
async def claim_default_port(iid: str, user=Depends(current_user)):
    """Gibt diesem Server Port 34197 (Adresse ohne Port). Der bisherige Inhaber bekommt den freien Port."""
    i = _inst_or_404(iid, user)
    if i["port"] == config.DEFAULT_GAME_PORT:
        return {"ok": True}
    holder = db.q1("SELECT * FROM instances WHERE bind_ip=? AND port=?", (i["bind_ip"], config.DEFAULT_GAME_PORT))
    restart_ids = []
    if holder:
        if user["role"] != "admin" and not can_access(user, holder["id"]):
            raise HTTPException(403, f"Port 34197 gehört „{holder['name']}“. Nur ein Admin oder dessen Besitzer "
                                     f"kann ihn freigeben.")
        db.x("UPDATE instances SET port=? WHERE id=?", (i["port"], holder["id"]))
        inst_mod.write_launch(holder["id"])
        if inst_mod.st(holder["id"])["state"] in ("running", "starting"):
            restart_ids.append(holder["id"])
    db.x("UPDATE instances SET port=? WHERE id=?", (config.DEFAULT_GAME_PORT, iid))
    inst_mod.write_launch(iid)
    if inst_mod.st(iid)["state"] in ("running", "starting"):
        restart_ids.append(iid)
    for rid in restart_ids:
        asyncio.get_running_loop().create_task(inst_mod.restart(rid, user))
    db.audit(user["id"], "instance.default_port", iid)
    return {"ok": True, "restarted": restart_ids}


@app.get("/api/instances/{iid}/server-settings")
async def get_server_settings(iid: str, user=Depends(current_user)):
    _inst_or_404(iid, user)
    return inst_mod.read_json(inst_mod.data_dir(iid) / "server-settings.json", {})


@app.put("/api/instances/{iid}/server-settings")
async def put_server_settings(iid: str, p: dict = Body(...), user=Depends(current_user)):
    _inst_or_404(iid, user)
    path = inst_mod.data_dir(iid) / "server-settings.json"
    cur = inst_mod.read_json(path, {})
    cur.update(p)
    inst_mod.write_json(path, cur)
    applied = []
    # Einige Werte lassen sich im laufenden Spiel übernehmen
    if inst_mod.st(iid)["state"] == "running":
        if "game_password" in p:
            try:
                await inst_mod.rcon(iid, f"/config set password {p['game_password'] or ''}".rstrip())
                applied.append("game_password")
            except Exception:
                pass
    return {"ok": True, "live": applied}


LISTS = {"admins": "server-adminlist.json", "bans": "server-banlist.json", "whitelist": "server-whitelist.json"}


@app.get("/api/instances/{iid}/lists/{kind}")
async def get_list(iid: str, kind: str, user=Depends(current_user)):
    _inst_or_404(iid, user)
    if kind not in LISTS:
        raise HTTPException(404)
    data = inst_mod.read_json(inst_mod.data_dir(iid) / LISTS[kind], [])
    return [d if isinstance(d, str) else d.get("username", "") for d in data]


@app.put("/api/instances/{iid}/lists/{kind}")
async def put_list(iid: str, kind: str, names: list = Body(...), user=Depends(current_user)):
    _inst_or_404(iid, user)
    if kind not in LISTS:
        raise HTTPException(404)
    clean = sorted({str(n).strip() for n in names if str(n).strip()}, key=str.lower)
    old = set(await get_list(iid, kind, user))
    inst_mod.write_json(inst_mod.data_dir(iid) / LISTS[kind], clean)
    if inst_mod.st(iid)["state"] == "running":
        cmd = {"admins": ("/promote", "/demote"), "bans": ("/ban", "/unban"), "whitelist": ("/whitelist add", "/whitelist remove")}[kind]
        for n in set(clean) - old:
            try:
                await inst_mod.rcon(iid, f"{cmd[0]} {n}")
            except Exception:
                pass
        for n in old - set(clean):
            try:
                await inst_mod.rcon(iid, f"{cmd[1]} {n}")
            except Exception:
                pass
    return clean


# --- Freigabe ---------------------------------------------------------------

@app.post("/api/instances/{iid}/members")
async def add_member(iid: str, p: dict = Body(...), user=Depends(current_user)):
    i = _inst_or_404(iid, user)
    u = db.q1("SELECT id, username FROM users WHERE username=?", ((p.get("username") or "").strip(),))
    if not u:
        raise HTTPException(404, "Diesen Benutzer gibt es nicht.")
    if u["id"] == i["owner_id"]:
        raise HTTPException(400, "Das ist bereits der Besitzer.")
    db.x("INSERT OR IGNORE INTO members(instance_id, user_id, added_by, added_at) VALUES(?,?,?,?)",
         (iid, u["id"], user["id"], time.time()))
    db.audit(user["id"], "member.add", iid, u["username"])
    return _inst_view(inst_mod.get(iid), user)


@app.delete("/api/instances/{iid}/members/{uid}")
async def remove_member(iid: str, uid: int, user=Depends(current_user)):
    _inst_or_404(iid, user)
    db.x("DELETE FROM members WHERE instance_id=? AND user_id=?", (iid, uid))
    db.audit(user["id"], "member.remove", iid, str(uid))
    if uid == user["id"]:
        return {"left": True}
    return _inst_view(inst_mod.get(iid), user)


@app.post("/api/instances/{iid}/owner")
async def transfer_owner(iid: str, p: dict = Body(...), user=Depends(current_user)):
    i = _inst_or_404(iid, user)
    u = db.q1("SELECT * FROM users WHERE username=?", ((p.get("username") or "").strip(),))
    if not u:
        raise HTTPException(404, "Diesen Benutzer gibt es nicht.")
    _check_quota(u, 1, i["memory_mb"])
    old = i["owner_id"]
    db.x("UPDATE instances SET owner_id=? WHERE id=?", (u["id"], iid))
    db.x("DELETE FROM members WHERE instance_id=? AND user_id=?", (iid, u["id"]))
    db.x("INSERT OR IGNORE INTO members(instance_id, user_id, added_by, added_at) VALUES(?,?,?,?)",
         (iid, old, user["id"], time.time()))
    db.audit(user["id"], "owner.transfer", iid, u["username"])
    return _inst_view(inst_mod.get(iid), user)


# --- Version einer Instanz --------------------------------------------------

@app.post("/api/instances/{iid}/version")
async def change_version(iid: str, p: dict = Body(...), user=Depends(current_user)):
    i = _inst_or_404(iid, user)
    target = p.get("version")
    if target == "latest":
        await versions.refresh_available(force=True)
        target = versions.latest_stable()
    versions.check(target)

    async def job(progress):
        was_running = inst_mod.st(iid)["state"] in ("running", "starting")
        if not versions.is_installed(target):
            await versions.install(target, lambda f=None, t=None: progress(f * 0.8 if f is not None else None, t))
        if was_running:
            progress(0.82, "Stoppe Server")
            await inst_mod.stop(iid, user)
            await inst_mod.wait_stopped(iid)
        progress(0.88, "Sichere Spielstand")
        saves = sorted((inst_mod.data_dir(iid) / "saves").glob("*.zip"), key=lambda f: f.stat().st_mtime)
        if saves:
            bdir = inst_mod.data_dir(iid) / "backups"
            bdir.mkdir(exist_ok=True)
            dst = bdir / f"{saves[-1].stem}_vor-{target}_{time.strftime('%Y%m%d-%H%M')}.zip"
            await asyncio.to_thread(shutil.copy2, saves[-1], dst)
            inst_mod.chown_tree(bdir)
        old = i["version"]
        db.x("UPDATE instances SET version=? WHERE id=?", (target, iid))
        if inst_mod.has_dlc(target) and not inst_mod.has_dlc(old):
            inst_mod.set_space_age(iid, False)
        inst_mod.write_launch(iid)
        db.audit(user["id"], "instance.version", iid, f"{old} -> {target}")
        if was_running:
            progress(0.95, "Starte Server")
            inst_mod.st(iid)["state"] = "stopped"
            await inst_mod.start(iid, user)
        progress(1, f"Auf {target} umgestellt")
        return target

    return events.start_task("instance-version", f"{i['name']}: Factorio {target}", job, user["id"], iid)


# --- Spielstände ------------------------------------------------------------

@app.get("/api/instances/{iid}/saves")
async def saves(iid: str, user=Depends(current_user)):
    i = _inst_or_404(iid, user)
    out = []
    for sub in ("saves", "backups"):
        d = inst_mod.data_dir(iid) / sub
        for f in d.glob("*.zip") if d.exists() else []:
            s = f.stat()
            out.append({"name": f.name, "path": f"{sub}/{f.name}", "size": s.st_size, "mtime": s.st_mtime,
                        "backup": sub == "backups"})
    out.sort(key=lambda x: -x["mtime"])
    return {"saves": out, "selected": i["options"].get("save")}


@app.post("/api/instances/{iid}/saves/save-now")
async def save_now(iid: str, p: dict = Body(default={}), user=Depends(current_user)):
    _inst_or_404(iid, user)
    name = (p.get("name") or "").strip()
    cmd = "/server-save" + (f" {Path(name).stem}" if name else "")
    return {"output": await inst_mod.rcon(iid, cmd)}


@app.post("/api/instances/{iid}/saves/restore")
async def restore_backup(iid: str, p: dict = Body(...), user=Depends(current_user)):
    _inst_or_404(iid, user)
    src = files.resolve(iid, f"backups/{Path(p.get('name') or '').name}")
    dst = inst_mod.data_dir(iid) / "saves" / src.name
    await asyncio.to_thread(shutil.copy2, src, dst)
    os.utime(dst, None)  # wird dadurch zum neuesten Spielstand
    inst_mod.chown_tree(dst)
    return {"ok": True, "name": dst.name}


# --- Dateien ----------------------------------------------------------------

@app.get("/api/instances/{iid}/files")
async def f_list(iid: str, path: str = "", user=Depends(current_user)):
    _inst_or_404(iid, user)
    return {"path": path.strip("/"), "entries": files.listdir(iid, path)}


@app.get("/api/instances/{iid}/files/content")
async def f_read(iid: str, path: str, user=Depends(current_user)):
    _inst_or_404(iid, user)
    return {"path": path, "content": files.read_text(iid, path)}


@app.put("/api/instances/{iid}/files/content")
async def f_write(iid: str, p: dict = Body(...), user=Depends(current_user)):
    _inst_or_404(iid, user)
    files.write_text(iid, p["path"], p.get("content", ""))
    db.audit(user["id"], "file.write", iid, p["path"])
    return {"ok": True}


@app.post("/api/instances/{iid}/files/op")
async def f_op(iid: str, p: dict = Body(...), user=Depends(current_user)):
    _inst_or_404(iid, user)
    op = p.get("op")
    if op == "mkdir":
        files.mkdir(iid, p["path"])
    elif op == "rename":
        files.rename(iid, p["from"], p["to"])
    elif op == "copy":
        files.copy(iid, p["from"], p["to"])
    elif op == "delete":
        files.delete(iid, p.get("paths") or [])
    elif op == "extract":
        files.extract(iid, p["path"])
    else:
        raise HTTPException(400, "Unbekannte Dateioperation")
    db.audit(user["id"], f"file.{op}", iid, json.dumps({k: v for k, v in p.items() if k != "op"})[:300])
    return {"ok": True}


@app.post("/api/instances/{iid}/files/upload")
async def f_upload(iid: str, path: str = Form(""), upload: list[UploadFile] = File(...), user=Depends(current_user)):
    _inst_or_404(iid, user)
    names = [await files.save_upload(iid, path, u) for u in upload]
    db.audit(user["id"], "file.upload", iid, ", ".join(names)[:300])
    return {"uploaded": names}


@app.get("/api/instances/{iid}/files/download")
async def f_download(iid: str, path: list[str] = Query(default=[]), user=Depends(current_user)):
    i = _inst_or_404(iid, user)
    if len(path) == 1:
        p = files.resolve(iid, path[0])
        if p.is_file():
            return FileResponse(p, filename=p.name)
    name = (f"{i['subdomain']}-{Path(path[0]).name}" if len(path) == 1 and path[0].strip("/") else
            f"{i['subdomain']}-dateien") + ".zip"
    return StreamingResponse(files.zip_stream(iid, path or [""]), media_type="application/zip",
                             headers={"Content-Disposition": f'attachment; filename="{name}"'})


# --- Mods -------------------------------------------------------------------

@app.get("/api/instances/{iid}/mods")
async def m_list(iid: str, user=Depends(current_user)):
    i = _inst_or_404(iid, user)
    return {"mods": [m for m in mods.installed(iid) if m["name"] not in mods.BUILTIN],
            "space_age": inst_mod.space_age_enabled(iid) if inst_mod.has_dlc(i["version"]) else None,
            "factorio_version": mods.game_minor(i["version"]),
            "credentials": bool(db.get_setting("factorio_username") and db.get_setting("factorio_token"))}


@app.get("/api/instances/{iid}/mods/search")
async def m_search(iid: str, q: str = "", page: int = 1, all: bool = False, user=Depends(current_user)):
    i = _inst_or_404(iid, user)
    return await mods.search(q, i["version"], page=max(1, page), only_compatible=not all)


@app.post("/api/instances/{iid}/mods/install")
async def m_install(iid: str, p: dict = Body(...), user=Depends(current_user)):
    i = _inst_or_404(iid, user)
    name = p.get("name") or ""
    return events.start_task("mod", f"Mod {name} installieren",
                             lambda prog: mods.install(iid, i["version"], name, p.get("version"), prog), user["id"], iid)


@app.post("/api/instances/{iid}/mods/toggle")
async def m_toggle(iid: str, p: dict = Body(...), user=Depends(current_user)):
    _inst_or_404(iid, user)
    mods.set_enabled(iid, p["name"], bool(p.get("enabled")))
    return {"ok": True}


@app.post("/api/instances/{iid}/mods/remove")
async def m_remove(iid: str, p: dict = Body(...), user=Depends(current_user)):
    _inst_or_404(iid, user)
    mods.remove(iid, p["name"])
    return {"ok": True}


@app.post("/api/instances/{iid}/mods/space-age")
async def m_space_age(iid: str, p: dict = Body(...), user=Depends(current_user)):
    i = _inst_or_404(iid, user)
    if not inst_mod.has_dlc(i["version"]):
        raise HTTPException(400, "Space Age gibt es erst ab Factorio 2.0")
    inst_mod.set_space_age(iid, bool(p.get("enabled")))
    return {"ok": True}


@app.get("/api/instances/{iid}/mods/updates")
async def m_updates(iid: str, user=Depends(current_user)):
    i = _inst_or_404(iid, user)
    return await mods.check_updates(iid, i["version"])


@app.post("/api/instances/{iid}/mods/update-all")
async def m_update_all(iid: str, user=Depends(current_user)):
    i = _inst_or_404(iid, user)

    async def job(progress):
        ups = await mods.check_updates(iid, i["version"])
        for n, u in enumerate(ups):
            progress(n / max(len(ups), 1), f"Aktualisiere {u['title']}")
            await mods.install(iid, i["version"], u["name"], None, lambda f=None, t=None: progress(None, t))
        progress(1, f"{len(ups)} Mods aktualisiert")
        return [u["name"] for u in ups]

    return events.start_task("mod", "Mods aktualisieren", job, user["id"], iid)


@app.post("/api/instances/{iid}/mods/upload")
async def m_upload(iid: str, upload: list[UploadFile] = File(...), user=Depends(current_user)):
    _inst_or_404(iid, user)
    names = []
    for u in upload:
        if not (u.filename or "").lower().endswith(".zip"):
            raise HTTPException(400, "Nur Mod-ZIPs erlaubt")
        names.append(await files.save_upload(iid, "mods", u))
    for m in mods.installed(iid):
        if m["file"] in names:
            mods.set_enabled(iid, m["name"], True)
    return {"uploaded": names}


# --- Versionen --------------------------------------------------------------

@app.get("/api/versions")
async def v_list(user=Depends(current_user)):
    return await versions.overview()


@app.post("/api/versions/refresh")
async def v_refresh(user=Depends(current_user)):
    await versions.refresh_available(force=True)
    return await versions.overview()


@app.post("/api/versions/{v}/install")
async def v_install(v: str, user=Depends(current_user)):
    versions.check(v)
    return events.start_task("version", f"Factorio {v} installieren", lambda prog: versions.install(v, prog), user["id"])


@app.delete("/api/versions/{v}")
async def v_delete(v: str, purge: bool = False, user=Depends(current_user)):
    require_admin(user)
    versions.remove(v, purge)
    return await versions.overview()


# --- Einstellungen (Admin) --------------------------------------------------

SECRET_KEYS = ("cloudflare_token", "factorio_token")


@app.get("/api/settings")
async def get_settings(user=Depends(current_user)):
    require_admin(user)
    s = db.all_settings()
    for k in SECRET_KEYS:
        s[k] = bool(s.get(k))
    s["detected_primary_ip"] = net.detect_primary_ip()
    s["detected_public_ip"] = await net.public_ipv4() if not s.get("public_ipv4") else None
    s["local_addresses"] = webserver.local_addresses()
    return s


@app.patch("/api/settings")
async def patch_settings(p: dict = Body(...), user=Depends(current_user)):
    require_admin(user)
    allowed = set(db.DEFAULT_SETTINGS)
    for k, v in p.items():
        if k not in allowed:
            continue
        if k in SECRET_KEYS and v in (True, None):
            continue  # unverändert (Maske)
        if k in ("port_range_start", "port_range_end", "default_memory_mb"):
            v = int(v)
        if k == "base_domain":
            v = (v or "").strip().lower().strip(".")
        if k == "trusted_proxies":
            import ipaddress
            items = v if isinstance(v, list) else str(v or "").replace(",", " ").split()
            clean = []
            for it in items:
                try:
                    clean.append(str(ipaddress.ip_network(it.strip(), strict=False)))
                except ValueError:
                    raise HTTPException(400, f"Ungültige Proxy-Adresse: {it}")
            v = clean
        if k == "dedicated_ips":
            v = [{"bind": d["bind"].strip(), "public": (d.get("public") or "").strip()} for d in v if d.get("bind")]
        db.set_setting(k, v)
    s, e = db.get_setting("port_range_start"), db.get_setting("port_range_end")
    if not (1024 < s <= e < 65536):
        raise HTTPException(400, "Ungültiger Portbereich")
    db.audit(user["id"], "settings.update", detail=json.dumps([k for k in p if k not in SECRET_KEYS]))
    return await get_settings(user)


@app.post("/api/settings/dns-test")
async def dns_test(user=Depends(current_user)):
    require_admin(user)
    if not net.cf_enabled():
        raise HTTPException(400, "Basisdomain, Cloudflare-Token und Zonen-ID ausfüllen.")
    return {"zone": await net.dns_test()}


@app.post("/api/settings/dns-sync")
async def dns_sync(user=Depends(current_user)):
    require_admin(user)
    done, errors = [], []
    ip = await net.public_ipv4()
    for i in inst_mod.all_instances():
        try:
            done.append(await net.dns_upsert(i["subdomain"], i["public_ip"] or ip))
        except Exception as e:
            errors.append(f"{i['subdomain']}: {e}")
    return {"records": done, "errors": errors}


@app.get("/api/settings/web")
async def web_preview(user=Depends(current_user)):
    require_admin(user)
    return {"caddyfile": webserver.render()}


@app.post("/api/settings/web/apply")
async def web_apply(user=Depends(current_user)):
    require_admin(user)
    return await webserver.apply()


# --- Host & Tasks -----------------------------------------------------------

@app.get("/api/host")
async def host(user=Depends(current_user)):
    vm = psutil.virtual_memory()
    du = shutil.disk_usage(config.DATA)
    committed = db.q1("SELECT COALESCE(SUM(memory_mb),0) m FROM instances")["m"]
    return {"cpu": psutil.cpu_percent(interval=None), "cores": os.cpu_count(), "mem_total": vm.total,
            "mem_used": vm.total - vm.available, "disk_total": du.total, "disk_used": du.used,
            "memory_committed_mb": committed, "load": os.getloadavg()}


@app.get("/api/tasks")
async def list_tasks(user=Depends(current_user)):
    return [t for t in events.tasks.values() if events._task_visible(t)(user)]


# --- WebSockets -------------------------------------------------------------

def _ws_user(ws: WebSocket):
    origin = ws.headers.get("origin")
    host = ws.headers.get("host")
    if origin and host and origin.split("://", 1)[-1] != host:
        return None
    return auth.user_from_token(ws.cookies.get(auth.COOKIE))


@app.websocket("/api/events")
async def ws_events(ws: WebSocket):
    user = _ws_user(ws)
    if not user:
        await ws.close(code=4401)
        return
    await ws.accept()
    sub = events.subscribe(user)
    await ws.send_text(json.dumps({"type": "hello"}))
    try:
        while True:
            ev = await sub[0].get()
            await ws.send_text(json.dumps(ev))
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        events.unsubscribe(sub)


@app.websocket("/api/instances/{iid}/console")
async def ws_console(ws: WebSocket, iid: str):
    user = _ws_user(ws)
    if not user or not can_access(user, iid):
        await ws.close(code=4403)
        return
    await ws.accept()
    t = inst_mod.tail(iid)
    q = asyncio.Queue(maxsize=2000)
    t.subs.add(q)
    await ws.send_text(json.dumps({"type": "backlog", "lines": t.backlog()}))

    async def sender():
        while True:
            item = await q.get()
            if isinstance(item, dict):
                await ws.send_text(json.dumps({"type": "clear"}))
            else:
                await ws.send_text(json.dumps({"type": "lines", "lines": item}))

    async def receiver():
        while True:
            msg = json.loads(await ws.receive_text())
            cmd = (msg.get("command") or "").strip()
            if not cmd:
                continue
            try:
                out = await inst_mod.rcon(iid, cmd)
                db.audit(user["id"], "console", iid, cmd[:200])
                await ws.send_text(json.dumps({"type": "result", "command": cmd, "output": out, "ok": True}))
            except Exception as e:
                await ws.send_text(json.dumps({"type": "result", "command": cmd, "output": str(e), "ok": False}))

    tasks = [asyncio.create_task(sender()), asyncio.create_task(receiver())]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for tk in tasks:
            tk.cancel()
        t.subs.discard(q)


# --- Oberfläche -------------------------------------------------------------

@app.get("/{path:path}")
async def spa(path: str):
    if path.startswith("api/"):
        raise HTTPException(404)
    f = (config.WEB / path).resolve()
    if path and f.is_file() and config.WEB.resolve() in f.parents:
        headers = {"Cache-Control": "public, max-age=3600"} if path.startswith("fonts/") else {"Cache-Control": "no-cache"}
        return FileResponse(f, headers=headers)
    return FileResponse(config.WEB / "index.html", headers={"Cache-Control": "no-cache"})
