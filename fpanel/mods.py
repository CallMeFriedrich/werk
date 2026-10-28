"""Mods: Suche im Mod-Portal, Installation mit Abhängigkeiten, geteilter Download-Cache."""
import asyncio
import hashlib
import json
import re
import shutil
import time
import zipfile
from pathlib import Path

import httpx

from . import config, db, versions
from .instances import DLC_MODS, chown_tree, data_dir, read_json, write_json

PORTAL = "https://mods.factorio.com"
INDEX = config.CACHE / "mods-index.json"
_index = {"ts": 0, "mods": []}
_index_lock = asyncio.Lock()
NAME_RE = re.compile(r"^[A-Za-z0-9_\- ]{1,100}$")
BUILTIN = {"base", *DLC_MODS}


def game_minor(version: str) -> str:
    return ".".join(version.split(".")[:2])


def _client():
    return httpx.AsyncClient(timeout=httpx.Timeout(30, read=120), follow_redirects=True,
                             headers={"User-Agent": config.USER_AGENT})


async def load_index(force=False):
    async with _index_lock:
        if not _index["mods"] and INDEX.exists():
            try:
                cached = json.loads(INDEX.read_text())
                _index.update(ts=cached["ts"], mods=cached["mods"])
            except (OSError, ValueError, KeyError):
                pass
        if force or not _index["mods"] or time.time() - _index["ts"] > 12 * 3600:
            try:
                async with _client() as c:
                    r = await c.get(f"{PORTAL}/api/mods", params={"page_size": "max", "hide_deprecated": "true"})
                    r.raise_for_status()
                    mods = []
                    for m in r.json().get("results", []):
                        lr = m.get("latest_release") or {}
                        mods.append({
                            "name": m.get("name"), "title": m.get("title") or m.get("name"),
                            "owner": m.get("owner"), "summary": (m.get("summary") or "")[:300],
                            "downloads": m.get("downloads_count") or 0, "category": m.get("category"),
                            "version": lr.get("version"),
                            "factorio_version": (lr.get("info_json") or {}).get("factorio_version"),
                            "released": lr.get("released_at"),
                        })
                _index.update(ts=time.time(), mods=mods)
                INDEX.write_text(json.dumps(_index))
            except Exception as e:
                if not _index["mods"]:
                    raise RuntimeError(f"Mod-Portal nicht erreichbar: {e}")
        return _index


async def search(query: str, factorio_version: str, page=1, per_page=30, only_compatible=True):
    idx = await load_index()
    fv = game_minor(factorio_version)
    q = (query or "").strip().lower()
    res = []
    for m in idx["mods"]:
        if only_compatible and m["factorio_version"] != fv:
            continue
        if q and q not in (m["name"] or "").lower() and q not in (m["title"] or "").lower() \
                and q not in (m["owner"] or "").lower():
            continue
        res.append(m)
    if q:
        # exakte Treffer zuerst, dann nach Downloads
        res.sort(key=lambda m: (m["name"].lower() != q and m["title"].lower() != q, -m["downloads"]))
    else:
        res.sort(key=lambda m: -m["downloads"])
    total = len(res)
    start = (page - 1) * per_page
    return {"total": total, "page": page, "results": res[start:start + per_page],
            "index_age": time.time() - idx["ts"]}


async def portal_details(name: str):
    if not NAME_RE.match(name):
        raise ValueError("Ungültiger Modname")
    async with _client() as c:
        r = await c.get(f"{PORTAL}/api/mods/{name}/full")
        if r.status_code == 404:
            raise ValueError(f"Mod „{name}“ gibt es im Portal nicht")
        r.raise_for_status()
        return r.json()


def pick_release(details, factorio_version, wanted=None):
    fv = game_minor(factorio_version)
    rels = details.get("releases") or []
    if wanted:
        for r in rels:
            if r["version"] == wanted:
                return r
        raise ValueError(f"{details['name']} {wanted} existiert nicht")
    ok = [r for r in rels if (r.get("info_json") or {}).get("factorio_version") == fv]
    if not ok:
        return None
    return max(ok, key=lambda r: versions.vkey(r["version"]) if re.match(r"^\d+\.\d+\.\d+$", r["version"]) else (0,))


def parse_dep(dep: str):
    """→ (kind, name)  kind: required | optional | hidden | incompatible | noorder"""
    d = dep.strip()
    kind = "required"
    for prefix, k in (("(?)", "hidden"), ("?", "optional"), ("!", "incompatible"), ("~", "noorder")):
        if d.startswith(prefix):
            kind, d = k, d[len(prefix):].strip()
            break
    name = re.split(r"\s*(?:>=|<=|=|>|<)\s*", d)[0].strip()
    return kind, name


# --- Instanz-Mods -----------------------------------------------------------

def mods_dir(iid) -> Path:
    return data_dir(iid) / "mods"


def _info_from_zip(p: Path):
    try:
        with zipfile.ZipFile(p) as z:
            cand = [n for n in z.namelist() if n.count("/") == 1 and n.endswith("/info.json")]
            if not cand:
                return None
            return json.loads(z.read(cand[0]).decode("utf-8-sig"))
    except (zipfile.BadZipFile, OSError, ValueError, KeyError):
        return None


def installed(iid):
    d = mods_dir(iid)
    ml = read_json(d / "mod-list.json", {"mods": []})
    enabled = {m["name"]: bool(m.get("enabled", True)) for m in ml.get("mods", []) if "name" in m}
    out = {}
    for p in sorted(d.glob("*.zip")):
        info = _info_from_zip(p) or {}
        name = info.get("name") or p.stem.rsplit("_", 1)[0]
        entry = {"name": name, "version": info.get("version") or p.stem.rsplit("_", 1)[-1],
                 "title": info.get("title") or name, "factorio_version": info.get("factorio_version"),
                 "file": p.name, "enabled": enabled.get(name, True), "broken": not info,
                 "dependencies": info.get("dependencies") or []}
        prev = out.get(name)
        if not prev or versions.vkey_safe(entry["version"]) > versions.vkey_safe(prev["version"]):
            if prev:
                entry["duplicates"] = (prev.get("duplicates") or []) + [prev["file"]]
            out[name] = entry
    for p in d.iterdir() if d.exists() else []:
        if p.is_dir() and (p / "info.json").exists():
            info = read_json(p / "info.json", {})
            name = info.get("name") or p.name
            out.setdefault(name, {"name": name, "version": info.get("version"), "title": info.get("title") or name,
                                  "factorio_version": info.get("factorio_version"), "file": p.name + "/",
                                  "enabled": enabled.get(name, True), "broken": False,
                                  "dependencies": info.get("dependencies") or []})
    return sorted(out.values(), key=lambda m: m["title"].lower())


def set_enabled(iid, name, enabled: bool):
    p = mods_dir(iid) / "mod-list.json"
    ml = read_json(p, {"mods": [{"name": "base", "enabled": True}]})
    found = False
    for m in ml.setdefault("mods", []):
        if m.get("name") == name:
            m["enabled"] = bool(enabled)
            found = True
    if not found:
        ml["mods"].append({"name": name, "enabled": bool(enabled)})
    write_json(p, ml)


def remove(iid, name):
    for m in installed(iid):
        if m["name"] == name:
            for f in [m["file"]] + (m.get("duplicates") or []):
                t = (mods_dir(iid) / f.rstrip("/")).resolve()
                if mods_dir(iid).resolve() not in t.parents:
                    continue
                if t.is_dir():
                    shutil.rmtree(t)
                else:
                    t.unlink(missing_ok=True)
    p = mods_dir(iid) / "mod-list.json"
    ml = read_json(p, {"mods": []})
    ml["mods"] = [m for m in ml.get("mods", []) if m.get("name") != name]
    write_json(p, ml)


async def _download_release(release, progress, label):
    user, token = db.get_setting("factorio_username"), db.get_setting("factorio_token")
    if not user or not token:
        raise RuntimeError("Für Mod-Downloads fehlen Factorio-Benutzername und Token (Einstellungen → Factorio-Konto)")
    fname = Path(release["file_name"]).name
    target = config.CACHE / "mods" / fname
    sha1 = release.get("sha1")
    if target.exists() and (not sha1 or _sha1(target) == sha1):
        return target
    tmp = target.with_suffix(".part")
    async with _client() as c:
        async with c.stream("GET", PORTAL + release["download_url"], params={"username": user, "token": token}) as r:
            if r.status_code in (401, 403):
                raise RuntimeError("Factorio-Zugangsdaten wurden abgelehnt")
            r.raise_for_status()
            if "text/html" in r.headers.get("content-type", ""):
                raise RuntimeError("Mod-Portal hat eine Login-Seite geliefert – Token prüfen")
            total = int(r.headers.get("content-length") or 0)
            done = 0
            with open(tmp, "wb") as f:
                async for chunk in r.aiter_bytes(1 << 18):
                    f.write(chunk)
                    done += len(chunk)
                    if total:
                        progress(None, f"{label}: {done >> 10} / {total >> 10} KB")
    if sha1 and _sha1(tmp) != sha1:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"Prüfsumme von {fname} stimmt nicht")
    tmp.replace(target)
    return target


def _sha1(p: Path):
    h = hashlib.sha1()
    with open(p, "rb") as f:
        while b := f.read(1 << 20):
            h.update(b)
    return h.hexdigest()


async def install(iid, factorio_version, name, wanted_version, progress):
    """Installiert Mod + Pflicht-Abhängigkeiten. Gibt Liste installierter Mods zurück."""
    have = {m["name"]: m for m in installed(iid)}
    plan, seen, notes = [], set(), []
    dlc_needed = set()

    async def resolve(n, wanted=None, top=False):
        if n in seen:
            return
        seen.add(n)
        if n in BUILTIN:
            if n != "base":
                dlc_needed.add(n)
            return
        if not top and n in have:
            return
        progress(None, f"Prüfe {n}")
        det = await portal_details(n)
        rel = pick_release(det, factorio_version, wanted)
        if not rel:
            raise RuntimeError(f"{det.get('title') or n} hat keine Version für Factorio {game_minor(factorio_version)}")
        plan.append((n, rel, det.get("title") or n))
        for dep in (rel.get("info_json") or {}).get("dependencies") or []:
            kind, dn = parse_dep(dep)
            if kind in ("required", "noorder"):
                await resolve(dn)
            elif kind == "incompatible" and dn in have:
                notes.append(f"{n} ist inkompatibel mit installiertem {dn}")

    await resolve(name, wanted_version, top=True)
    if notes:
        raise RuntimeError("; ".join(notes))
    for i, (n, rel, title) in enumerate(plan):
        progress(i / max(len(plan), 1), f"Lade {title}")
        src = await _download_release(rel, progress, title)
        # alte Versionen derselben Mod entfernen
        for m in installed(iid):
            if m["name"] == n:
                for f in [m["file"]] + (m.get("duplicates") or []):
                    if not f.endswith("/"):
                        (mods_dir(iid) / f).unlink(missing_ok=True)
        dst = mods_dir(iid) / src.name
        shutil.copy2(src, dst)
        chown_tree(dst)
        set_enabled(iid, n, True)
    for d in dlc_needed:
        set_enabled(iid, d, True)
    if "space-age" in dlc_needed:
        for d in DLC_MODS:
            set_enabled(iid, d, True)
    progress(1, "Fertig")
    return {"installed": [p[0] for p in plan], "dlc_enabled": sorted(dlc_needed)}


async def check_updates(iid, factorio_version):
    res = []
    for m in installed(iid):
        if m["broken"] or m["file"].endswith("/"):
            continue
        try:
            det = await portal_details(m["name"])
        except Exception:
            continue
        rel = pick_release(det, factorio_version)
        if rel and versions.vkey_safe(rel["version"]) > versions.vkey_safe(m["version"] or "0.0.0"):
            res.append({"name": m["name"], "title": m["title"], "installed": m["version"], "latest": rel["version"]})
    return res
