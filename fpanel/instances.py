"""Instanzen: Anlegen, Startskript, Status, Log-Tail, Stats, Spieler."""
import asyncio
import json
import os
import re
import secrets
import shlex
import shutil
import time
from collections import deque
from pathlib import Path

from . import config, db, events, net, versions
from .rcon import Rcon, RconError
from .runner import runner

SUBDOMAIN_RE = re.compile(r"^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$")
PRESETS = ["default", "rich-resources", "marathon", "death-world", "death-world-marathon",
           "rail-world", "ribbon-world", "island"]
DLC_MODS = ["elevated-rails", "quality", "space-age"]


def slugify(name: str) -> str:
    s = name.lower()
    for a, b in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        s = s.replace(a, b)
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:32].strip("-") or "server"


def data_dir(iid) -> Path:
    return config.INSTANCES / iid


def run_dir(iid) -> Path:
    return config.RUN / iid


def log_path(iid) -> Path:
    return config.LOGS / f"{iid}.log"


def get(iid):
    r = db.q1("SELECT * FROM instances WHERE id=?", (iid,))
    if r:
        r["options"] = json.loads(r["options"] or "{}")
    return r


def all_instances():
    rows = db.q("SELECT * FROM instances ORDER BY created_at")
    for r in rows:
        r["options"] = json.loads(r["options"] or "{}")
    return rows


def save_options(iid, options):
    db.x("UPDATE instances SET options=? WHERE id=?", (json.dumps(options), iid))


def _chown(path: Path):
    """Spieldaten gehören dem Spiel-User, damit der Server schreiben kann."""
    if config.RUNNER != "systemd":
        return
    try:
        shutil.chown(path, config.GAME_USER, config.GAME_USER)
    except (LookupError, PermissionError, OSError):
        pass


def chown_tree(path: Path):
    if config.RUNNER != "systemd":
        return
    _chown(path)
    if path.is_dir():
        for root, dirs, files in os.walk(path):
            for n in dirs + files:
                _chown(Path(root) / n)


def default_server_settings(name: str) -> dict:
    return {
        "name": name,
        "description": "",
        "tags": [],
        "max_players": 0,
        "visibility": {"public": False, "lan": True},
        "username": "",
        "password": "",
        "token": "",
        "game_password": "",
        "require_user_verification": False,
        "max_upload_in_kilobytes_per_second": 0,
        "max_upload_slots": 5,
        "minimum_latency_in_ticks": 0,
        "max_heartbeats_per_second": 60,
        "ignore_player_limit_for_returning_players": False,
        "allow_commands": "admins-only",
        "autosave_interval": 5,
        "autosave_slots": 10,
        "afk_autokick_interval": 0,
        "auto_pause": True,
        "auto_pause_when_players_connect": False,
        "only_admins_can_pause_the_game": True,
        "autosave_only_on_server": True,
        "non_blocking_saving": False,
    }


def read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return default


def write_json(path: Path, data):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)
    _chown(path)


def has_dlc(version: str) -> bool:
    return versions.vkey(version) >= (2, 0, 0)


def space_age_enabled(iid) -> bool:
    ml = read_json(data_dir(iid) / "mods" / "mod-list.json", {"mods": []})
    return any(m.get("name") == "space-age" and m.get("enabled") for m in ml.get("mods", []))


def set_space_age(iid, enabled: bool):
    p = data_dir(iid) / "mods" / "mod-list.json"
    ml = read_json(p, {"mods": [{"name": "base", "enabled": True}]})
    mods = {m["name"]: m for m in ml.get("mods", []) if "name" in m}
    mods.setdefault("base", {"name": "base", "enabled": True})["enabled"] = True
    for n in DLC_MODS:
        mods.setdefault(n, {"name": n})["enabled"] = bool(enabled)
    ml["mods"] = list(mods.values())
    write_json(p, ml)


def write_launch(iid):
    inst = get(iid)
    v = inst["version"]
    data = data_dir(iid)
    rd = run_dir(iid)
    rd.mkdir(parents=True, exist_ok=True)
    os.chmod(rd, 0o750)
    _chown_group(rd)
    read_data = versions.install_dir(v) / "factorio" / "data"
    (rd / "config.ini").write_text(
        "; erzeugt von fpanel – Änderungen werden überschrieben\n"
        "[path]\n"
        f"read-data={read_data}\n"
        f"write-data={data}\n"
        "[other]\n"
        "check-updates=false\n"
    )
    o = inst["options"]
    q = shlex.quote
    create = [q(str(versions.binary(v))), "--config", q(str(rd / "config.ini")), "--create", q(str(data / "saves" / "world.zip"))]
    if (data / "map-gen-settings.json").exists():
        create += ["--map-gen-settings", q(str(data / "map-gen-settings.json"))]
    elif o.get("preset") and o["preset"] != "default":
        create += ["--preset", q(o["preset"])]
    if (data / "map-settings.json").exists():
        create += ["--map-settings", q(str(data / "map-settings.json"))]
    if str(o.get("seed") or "").isdigit():
        create += ["--map-gen-seed", str(int(o["seed"]))]

    start = [q(str(versions.binary(v))), "--config", q(str(rd / "config.ini"))]
    save = o.get("save")
    if save and (data / "saves" / save).exists():
        start += ["--start-server", q(str(data / "saves" / save))]
    else:
        start += ["--start-server-load-latest"]
    start += [
        "--server-settings", q(str(data / "server-settings.json")),
        "--server-adminlist", q(str(data / "server-adminlist.json")),
        "--server-banlist", q(str(data / "server-banlist.json")),
        "--port", str(inst["port"]),
        "--bind", q(inst["bind_ip"]),
        "--rcon-bind", f"127.0.0.1:{inst['rcon_port']}",
        "--rcon-password", q(inst["rcon_password"]),
    ]
    if o.get("whitelist"):
        start += ["--use-server-whitelist", "--server-whitelist", q(str(data / "server-whitelist.json"))]

    script = f"""#!/bin/sh
# erzeugt von fpanel – Änderungen werden beim nächsten Start überschrieben
set -e
cd {q(str(data))}
mkdir -p saves mods
if ! ls saves/*.zip >/dev/null 2>&1; then
  echo "[fpanel] Kein Spielstand vorhanden – erzeuge neue Karte"
  {' '.join(create)}
fi
echo "[fpanel] Starte Factorio {v} auf {inst['bind_ip']}:{inst['port']}"
exec {' '.join(start)}
"""
    lp = rd / "launch.sh"
    lp.write_text(script)
    os.chmod(lp, 0o750)
    _chown_group(lp)


def _chown_group(path):
    if config.RUNNER != "systemd":
        return
    try:
        shutil.chown(path, "root", config.GAME_USER)
    except (LookupError, PermissionError, OSError):
        pass


async def create(owner, name, subdomain, version, memory_mb, space_age, preset, seed, game_password,
                 dedicated_bind=None):
    name = (name or "").strip()[:60]
    if not name:
        raise ValueError("Name fehlt")
    sub = (subdomain or slugify(name)).lower()
    if not SUBDOMAIN_RE.match(sub):
        raise ValueError("Subdomain: nur a–z, 0–9 und Bindestrich, max. 32 Zeichen")
    if db.q1("SELECT 1 FROM instances WHERE subdomain=?", (sub,)):
        raise ValueError(f"Die Subdomain „{sub}“ ist bereits vergeben")
    versions.check(version)
    if preset and preset not in PRESETS:
        raise ValueError("Unbekanntes Karten-Preset")

    if dedicated_bind:
        pool = {d["bind"]: d for d in net.dedicated_ips()}
        if dedicated_bind not in pool:
            raise ValueError("Diese IP ist nicht im Pool")
        if db.q1("SELECT 1 FROM instances WHERE bind_ip=?", (dedicated_bind,)):
            raise ValueError("Diese IP ist bereits einer Instanz zugewiesen")
        bind_ip, public_ip, port = dedicated_bind, pool[dedicated_bind].get("public") or None, config.DEFAULT_GAME_PORT
    else:
        bind_ip, public_ip = net.primary_ip(), None
        port = net.free_game_port(bind_ip)

    iid = secrets.token_hex(4)
    while db.q1("SELECT 1 FROM instances WHERE id=?", (iid,)):
        iid = secrets.token_hex(4)
    options = {"preset": preset or "default", "seed": str(seed or "").strip()}
    db.x("""INSERT INTO instances(id, name, subdomain, owner_id, version, port, bind_ip, public_ip, rcon_port,
            rcon_password, memory_mb, autostart, auto_restart, options, created_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
         (iid, name, sub, owner["id"], version, port, bind_ip, public_ip, net.free_rcon_port(),
          secrets.token_urlsafe(18), int(memory_mb), 0, 0, json.dumps(options), time.time()))

    d = data_dir(iid)
    for sd in ("", "saves", "mods", "scenarios", "script-output"):
        (d / sd).mkdir(parents=True, exist_ok=True)
    ss = default_server_settings(name)
    ss["game_password"] = game_password or ""
    write_json(d / "server-settings.json", ss)
    write_json(d / "server-adminlist.json", [])
    write_json(d / "server-banlist.json", [])
    write_json(d / "server-whitelist.json", [])
    if has_dlc(version):
        set_space_age(iid, bool(space_age))
    else:
        write_json(d / "mods" / "mod-list.json", {"mods": [{"name": "base", "enabled": True}]})
    chown_tree(d)
    write_launch(iid)
    await runner.configure(iid, int(memory_mb), False)
    db.audit(owner["id"], "instance.create", iid, name)
    return get(iid)


async def delete(iid, user):
    inst = get(iid)
    await runner.remove(iid)
    tails.pop(iid, None)
    status.pop(iid, None)
    for p in (data_dir(iid), run_dir(iid)):
        if p.exists():
            shutil.rmtree(p)
    for p in (log_path(iid), log_path(iid).with_suffix(".log.1")):
        p.unlink(missing_ok=True)
    db.x("DELETE FROM instances WHERE id=?", (iid,))
    db.audit(user["id"], "instance.delete", iid, inst["name"] if inst else None)
    try:
        await net.dns_delete(inst["subdomain"])
    except Exception:
        pass


# --- Status, Logs, Spieler --------------------------------------------------

status: dict[str, dict] = {}     # Live-Zustand pro Instanz
tails: dict[str, "LogTail"] = {}
_rcons: dict[str, Rcon] = {}
HISTORY = 150


def st(iid):
    if iid not in status:
        status[iid] = {"state": "stopped", "cpu": 0.0, "mem": 0, "players": [], "ready": False,
                       "since": None, "exit": None,
                       "hist_cpu": deque(maxlen=HISTORY), "hist_mem": deque(maxlen=HISTORY),
                       "_cpu": None, "_t": None, "expect_stop": False}
    return status[iid]


def public_status(iid):
    s = st(iid)
    return {"state": s["state"], "cpu": round(s["cpu"], 1), "mem": s["mem"], "players": s["players"],
            "since": s["since"], "exit": s["exit"]}


class LogTail:
    """Liest neue Zeilen aus dem stdout-Log und verteilt sie an offene Konsolen."""

    def __init__(self, iid):
        self.iid = iid
        self.pos = 0
        self.buf = b""
        self.subs: set[asyncio.Queue] = set()
        self.ino = None

    def backlog(self, max_bytes=192 * 1024):
        p = log_path(self.iid)
        try:
            size = p.stat().st_size
            with open(p, "rb") as f:
                f.seek(max(0, size - max_bytes))
                data = f.read()
            if size > max_bytes:
                data = data.split(b"\n", 1)[-1]
            return data.decode("utf-8", "replace").splitlines()[-1500:]
        except OSError:
            return []

    def poll(self):
        p = log_path(self.iid)
        try:
            stt = p.stat()
        except OSError:
            return []
        if stt.st_ino != self.ino or stt.st_size < self.pos:
            self.ino, self.pos, self.buf = stt.st_ino, 0, b""
            self.reset_parse()
        if stt.st_size == self.pos:
            return []
        with open(p, "rb") as f:
            f.seek(self.pos)
            chunk = f.read(1 << 20)
        self.pos += len(chunk)
        data = self.buf + chunk
        lines = data.split(b"\n")
        self.buf = lines.pop()
        out = [l.decode("utf-8", "replace").rstrip("\r") for l in lines]
        for l in out:
            self.parse(l)
        if out:
            for q in list(self.subs):
                try:
                    q.put_nowait(out)
                except asyncio.QueueFull:
                    pass
        return out

    def reset_parse(self):
        s = st(self.iid)
        s["ready"] = False
        s["players"] = []

    def parse(self, line):
        s = st(self.iid)
        if "to(InGame)" in line:
            s["ready"] = True
        m = re.search(r"\[JOIN\] (.+?) joined the game", line)
        if m and m.group(1) not in s["players"]:
            s["players"] = s["players"] + [m.group(1)]
        m = re.search(r"\[LEAVE\] (.+?) left the game", line)
        if m:
            s["players"] = [p for p in s["players"] if p != m.group(1)]


def tail(iid) -> LogTail:
    if iid not in tails:
        tails[iid] = LogTail(iid)
        tails[iid].poll()  # Position auf Dateiende, Zustand aus vorhandenem Log ableiten
    return tails[iid]


async def rcon(iid, cmd: str) -> str:
    inst = get(iid)
    if not inst:
        raise RconError("Instanz existiert nicht")
    r = _rcons.get(iid)
    if not r or r.port != inst["rcon_port"] or r.password != inst["rcon_password"]:
        if r:
            await r.close()
        r = _rcons[iid] = Rcon("127.0.0.1", inst["rcon_port"], inst["rcon_password"])
    return await r.command(cmd)


async def start(iid, user=None):
    inst = get(iid)
    if not versions.is_installed(inst["version"]):
        raise RuntimeError(f"Factorio {inst['version']} ist nicht installiert")
    s = st(iid)
    if s["state"] in ("running", "starting"):
        return
    write_launch(iid)
    lp = log_path(iid)
    if lp.exists() and lp.stat().st_size:
        lp.replace(lp.with_suffix(".log.1"))
    lp.touch()
    t = tail(iid)
    t.pos, t.ino, t.buf = 0, lp.stat().st_ino, b""
    t.reset_parse()
    for q in list(t.subs):
        q.put_nowait({"clear": True})
    s.update(state="starting", since=time.time(), exit=None, expect_stop=False)
    await runner.configure(iid, inst["memory_mb"], bool(inst["auto_restart"]))
    await runner.start(iid)
    if user:
        db.audit(user["id"], "instance.start", iid)
    _publish(iid)


async def stop(iid, user=None):
    s = st(iid)
    s["expect_stop"] = True
    if s["state"] in ("running",):
        try:
            await rcon(iid, "/server-save")
        except Exception:
            pass
    s["state"] = "stopping"
    await runner.stop(iid)
    if user:
        db.audit(user["id"], "instance.stop", iid)
    _publish(iid)


async def kill(iid, user=None):
    st(iid)["expect_stop"] = True
    await runner.kill(iid)
    if user:
        db.audit(user["id"], "instance.kill", iid)


async def wait_stopped(iid, timeout=120):
    t0 = time.time()
    while time.time() - t0 < timeout:
        states = await runner.states([iid])
        if states.get(iid, {}).get("ActiveState") in ("inactive", "failed", None, ""):
            return True
        await asyncio.sleep(0.5)
    return False


async def restart(iid, user=None):
    await stop(iid, user)
    await wait_stopped(iid)
    st(iid)["state"] = "stopped"
    await start(iid, user)


def _publish(iid):
    from .auth import can_access
    events.publish({"type": "status", "id": iid, **public_status(iid)}, lambda u: can_access(u, iid))


async def sampler():
    """Alle 2 s: systemd-Zustand, CPU/RAM, Verlauf. Alle 0,4 s: Log-Tail."""
    ncpu = os.cpu_count() or 1
    tick = 0
    while True:
        try:
            ids = [r["id"] for r in db.q("SELECT id FROM instances")]
            for iid in ids:
                s = st(iid)
                if s["state"] in ("starting", "running", "stopping") or tail(iid).subs:
                    tail(iid).poll()
            if tick % 5 == 0:
                await _sample(ids, ncpu)
        except Exception as e:  # der Sampler darf nie sterben
            print("sampler:", repr(e))
        tick += 1
        await asyncio.sleep(0.4)


async def _sample(ids, ncpu):
    states = await runner.states(ids)
    now = time.time()
    for iid in ids:
        info = states.get(iid, {})
        s = st(iid)
        active = info.get("ActiveState", "inactive")
        prev = s["state"]
        if active in ("active", "activating", "reloading"):
            cpu_us, mem = runner.usage(info)
            if s["_cpu"] is not None and s["_t"] and cpu_us >= s["_cpu"]:
                s["cpu"] = (cpu_us - s["_cpu"]) / ((now - s["_t"]) * 1e6) * 100
            s["_cpu"], s["_t"], s["mem"] = cpu_us, now, mem
            if prev == "stopping":
                state = "stopping"
            else:
                state = "running" if s["ready"] else "starting"
            if s["since"] is None:
                s["since"] = now
        elif active == "deactivating":
            state = "stopping"
        else:
            code = str(info.get("ExecMainStatus") or "")
            if active == "failed" or (prev in ("running", "starting") and not s["expect_stop"]
                                      and code not in ("", "0")):
                state = "crashed"
                s["exit"] = code or info.get("Result")
            elif prev == "crashed":
                state = "crashed"
            else:
                state = "stopped"
            if prev == "starting" and active == "inactive" and time.time() - (s["since"] or 0) < 3:
                state = prev  # systemd hat den Start noch nicht übernommen
            s.update(cpu=0.0, mem=0, _cpu=None, _t=None, ready=False, players=[])
            if state != "starting":
                s["since"] = None
        s["state"] = state
        s["hist_cpu"].append(round(s["cpu"], 1))
        s["hist_mem"].append(s["mem"])
        _publish_stats(iid)


def _publish_stats(iid):
    from .auth import can_access
    s = st(iid)
    events.publish({"type": "stats", "id": iid, **public_status(iid)}, lambda u: can_access(u, iid))


async def autostart_all():
    ids = [r["id"] for r in db.q("SELECT id FROM instances")]
    states = await runner.states(ids)
    for r in db.q("SELECT id, autostart FROM instances"):
        active = states.get(r["id"], {}).get("ActiveState")
        s = st(r["id"])
        if active in ("active", "activating"):
            t = tail(r["id"])
            # Panel wurde neu gestartet, Server läuft weiter: Zustand aus dem Log rekonstruieren
            t.pos, t.ino = 0, None
            t.poll()
            s["state"] = "running" if s["ready"] else "starting"
            s["expect_stop"] = False
        elif r["autostart"]:
            try:
                await start(r["id"])
            except Exception as e:
                print("autostart", r["id"], e)
