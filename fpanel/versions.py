"""Factorio-Versionen: Liste von factorio.com, Download in den lokalen Cache,
entpackte Installationen, die sich alle Instanzen teilen."""
import asyncio
import re
import shutil
import tarfile
import time
from pathlib import Path

import httpx

from . import config, db

VERSION_RE = re.compile(r"^\d+\.\d+\.\d+$")
_avail = {"ts": 0, "versions": [], "stable": None, "experimental": None}
_installing: dict[str, asyncio.Task] = {}


def vkey(v: str):
    return tuple(int(x) for x in v.split("."))


def vkey_safe(v):
    try:
        return vkey(str(v))
    except (ValueError, TypeError):
        return (0,)


def check(v: str):
    if not VERSION_RE.match(v or ""):
        raise ValueError("Ungültige Versionsnummer")
    return v


def archive_path(v):
    return config.CACHE / "downloads" / f"factorio-headless_{v}.tar"


def install_dir(v):
    return config.VERSIONS / v


def binary(v) -> Path:
    return install_dir(v) / "factorio" / "bin" / "x64" / "factorio"


def is_installed(v):
    return binary(v).exists()


def installed():
    if not config.VERSIONS.exists():
        return []
    vs = [p.name for p in config.VERSIONS.iterdir() if VERSION_RE.match(p.name) and binary(p.name).exists()]
    return sorted(vs, key=vkey, reverse=True)


def cached():
    out = {}
    for p in (config.CACHE / "downloads").glob("factorio-headless_*.tar"):
        v = p.name[len("factorio-headless_"):-4]
        if VERSION_RE.match(v):
            out[v] = p.stat().st_size
    return out


def usage_by_version():
    res = {}
    for r in db.q("SELECT version, name, id FROM instances"):
        res.setdefault(r["version"], []).append({"id": r["id"], "name": r["name"]})
    return res


async def refresh_available(force=False):
    if not force and time.time() - _avail["ts"] < 3600 and _avail["versions"]:
        return _avail
    h = {"User-Agent": config.USER_AGENT}
    async with httpx.AsyncClient(timeout=20, headers=h, follow_redirects=True) as c:
        try:
            latest = (await c.get("https://factorio.com/api/latest-releases")).json()
            _avail["stable"] = latest.get("stable", {}).get("headless")
            _avail["experimental"] = latest.get("experimental", {}).get("headless")
        except Exception:
            pass
        try:
            html = (await c.get("https://factorio.com/download/archive/")).text
            vs = set(re.findall(r"/download/archive/(\d+\.\d+\.\d+)", html))
            if vs:
                # Headless-Server gibt es erst ab 0.12; ältere Versionen sind uninteressant
                _avail["versions"] = sorted((v for v in vs if vkey(v) >= (1, 0, 0)), key=vkey, reverse=True)
        except Exception:
            pass
    for v in (_avail["stable"], _avail["experimental"]):
        if v and v not in _avail["versions"]:
            _avail["versions"].insert(0, v)
    _avail["versions"].sort(key=vkey, reverse=True)
    _avail["ts"] = time.time()
    return _avail


async def overview():
    a = await refresh_available()
    inst, cache, use = installed(), cached(), usage_by_version()
    rows = []
    for v in sorted(set(a["versions"]) | set(inst) | set(cache), key=vkey, reverse=True):
        rows.append({
            "version": v,
            "installed": v in inst,
            "cached": v in cache,
            "cache_size": cache.get(v),
            "installing": v in _installing,
            "stable": v == a["stable"],
            "experimental": v == a["experimental"] and a["experimental"] != a["stable"],
            "used_by": use.get(v, []),
        })
    return {"stable": a["stable"], "experimental": a["experimental"], "versions": rows}


async def _download(v, progress):
    dest = archive_path(v)
    if dest.exists():
        progress(0.6, "Aus lokalem Cache")
        return dest
    tmp = dest.with_suffix(".part")
    url = f"https://factorio.com/get-download/{v}/headless/linux64"
    async with httpx.AsyncClient(timeout=httpx.Timeout(30, read=120), follow_redirects=True,
                                 headers={"User-Agent": config.USER_AGENT}) as c:
        async with c.stream("GET", url) as r:
            if r.status_code == 404:
                raise RuntimeError(f"Version {v} gibt es nicht als Headless-Server")
            r.raise_for_status()
            total = int(r.headers.get("content-length") or 0)
            done, last = 0, 0
            with open(tmp, "wb") as f:
                async for chunk in r.aiter_bytes(1 << 20):
                    f.write(chunk)
                    done += len(chunk)
                    if total and time.time() - last > 0.4:
                        last = time.time()
                        progress(0.6 * done / total, f"Download {done >> 20} / {total >> 20} MB")
    tmp.rename(dest)
    return dest


def _extract(archive: Path, target: Path):
    tmp = target.with_name(f".{target.name}.extract")
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir(parents=True)
    with tarfile.open(archive, "r:*") as t:
        members = []
        for m in t.getmembers():
            p = Path(m.name)
            if p.is_absolute() or ".." in p.parts or m.isdev():
                raise RuntimeError(f"Unsicherer Pfad im Archiv: {m.name}")
            if (m.issym() or m.islnk()) and (Path(m.linkname).is_absolute() or ".." in Path(m.linkname).parts):
                raise RuntimeError(f"Unsicherer Link im Archiv: {m.name}")
            members.append(m)
        t.extractall(tmp, members=members)
    if target.exists():
        shutil.rmtree(target)
    tmp.rename(target)


async def install(v, progress):
    check(v)
    if is_installed(v):
        progress(1, "Bereits installiert")
        return v
    if v in _installing:
        await _installing[v]
        return v

    async def job():
        archive = await _download(v, progress)
        progress(0.65, "Entpacke")
        try:
            await asyncio.to_thread(_extract, archive, install_dir(v))
        except (tarfile.TarError, EOFError, OSError) as e:
            archive.unlink(missing_ok=True)  # defektes Archiv nicht im Cache lassen
            raise RuntimeError(f"Archiv beschädigt, bitte erneut versuchen ({e})")
        if not is_installed(v):
            raise RuntimeError("Entpacktes Archiv enthält keinen Server")
        progress(1, "Installiert")

    t = asyncio.get_running_loop().create_task(job())
    _installing[v] = t
    try:
        await t
    finally:
        _installing.pop(v, None)
    return v


def remove(v, purge_cache=False):
    check(v)
    if usage_by_version().get(v):
        raise ValueError("Version wird noch von Instanzen verwendet")
    if install_dir(v).exists():
        shutil.rmtree(install_dir(v))
    if purge_cache:
        archive_path(v).unlink(missing_ok=True)


def latest_stable():
    return _avail.get("stable")
