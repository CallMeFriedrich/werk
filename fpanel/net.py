"""Adressen, Ports und DNS (Cloudflare, optional)."""
import socket
import time

import httpx

from . import config, db

_pub = {"ip": None, "ts": 0}


def detect_primary_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("1.1.1.1", 53))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "0.0.0.0"


def primary_ip() -> str:
    return db.get_setting("primary_ip") or detect_primary_ip()


async def public_ipv4() -> str | None:
    manual = db.get_setting("public_ipv4")
    if manual:
        return manual
    if _pub["ip"] and time.time() - _pub["ts"] < 900:
        return _pub["ip"]
    try:
        async with httpx.AsyncClient(timeout=6, headers={"User-Agent": config.USER_AGENT}) as c:
            ip = (await c.get("https://api.ipify.org")).text.strip()
        socket.inet_aton(ip)
        _pub.update(ip=ip, ts=time.time())
        return ip
    except Exception:
        return None


def dedicated_ips():
    return db.get_setting("dedicated_ips") or []


def connect_address(inst) -> str:
    base = db.get_setting("base_domain")
    if base:
        host = f"{inst['subdomain']}.{base}"
    else:
        host = inst.get("public_ip") or primary_ip()
    if inst["port"] == config.DEFAULT_GAME_PORT:
        return host
    return f"{host}:{inst['port']}"


def free_game_port(bind_ip: str, exclude_id=None, prefer_default=True) -> int:
    start, end = int(db.get_setting("port_range_start")), int(db.get_setting("port_range_end"))
    used = {r["port"] for r in db.q("SELECT port, id FROM instances WHERE bind_ip=?", (bind_ip,))
            if r["id"] != exclude_id}
    candidates = range(start, end + 1)
    if not prefer_default:
        candidates = [p for p in candidates if p != config.DEFAULT_GAME_PORT] + [config.DEFAULT_GAME_PORT]
    for p in candidates:
        if p not in used:
            return p
    raise ValueError("Kein freier Spielport mehr im konfigurierten Bereich")


def free_rcon_port() -> int:
    used = {r["rcon_port"] for r in db.q("SELECT rcon_port FROM instances")}
    for p in range(27100, 27600):
        if p not in used:
            return p
    raise ValueError("Keine freien RCON-Ports")


# --- Cloudflare -------------------------------------------------------------

def cf_enabled():
    return bool(db.get_setting("cloudflare_token") and db.get_setting("cloudflare_zone_id") and db.get_setting("base_domain"))


async def _cf(method, path, **kw):
    token, zone = db.get_setting("cloudflare_token"), db.get_setting("cloudflare_zone_id")
    async with httpx.AsyncClient(timeout=15, headers={"Authorization": f"Bearer {token}"}) as c:
        r = await c.request(method, f"https://api.cloudflare.com/client/v4/zones/{zone}{path}", **kw)
        data = r.json()
        if not data.get("success"):
            msg = "; ".join(e.get("message", "") for e in data.get("errors", [])) or r.text[:200]
            raise RuntimeError(f"Cloudflare: {msg}")
        return data["result"]


async def dns_upsert(subdomain: str, ip: str):
    if not cf_enabled() or not ip:
        return None
    name = f"{subdomain}.{db.get_setting('base_domain')}"
    rtype = "AAAA" if ":" in ip else "A"
    existing = await _cf("GET", "/dns_records", params={"name": name})
    body = {"type": rtype, "name": name, "content": ip, "ttl": 300, "proxied": False,
            "comment": "fpanel"}
    for rec in existing:
        if rec["type"] in ("A", "AAAA", "CNAME") and rec["type"] != rtype:
            await _cf("DELETE", f"/dns_records/{rec['id']}")
        elif rec["type"] == rtype:
            await _cf("PUT", f"/dns_records/{rec['id']}", json=body)
            return name
    await _cf("POST", "/dns_records", json=body)
    return name


async def dns_delete(subdomain: str):
    if not cf_enabled():
        return
    name = f"{subdomain}.{db.get_setting('base_domain')}"
    for rec in await _cf("GET", "/dns_records", params={"name": name}):
        if rec["type"] in ("A", "AAAA"):
            await _cf("DELETE", f"/dns_records/{rec['id']}")


async def dns_test():
    zone = await _cf("GET", "")
    return zone.get("name")
