"""Erzeugt die Caddy-Konfiguration für Port 80/443 und lädt Caddy neu."""
import asyncio
import re
import socket
import subprocess

import psutil

from . import config, db

DOMAIN_RE = re.compile(r"^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")


def local_addresses():
    addrs = []
    for name, lst in psutil.net_if_addrs().items():
        if name == "lo":
            continue
        for a in lst:
            if a.family == socket.AF_INET:
                addrs.append(a.address)
    return addrs


def render() -> str:
    s = db.all_settings()
    upstream = f"{config.LISTEN_HOST}:{config.LISTEN_PORT}"
    internal_sites = [f"https://{ip}" for ip in local_addresses()]
    internal_sites.append(f"https://{socket.gethostname()}")
    panel_domain = (s.get("panel_domain") or "").strip().lower()
    out = ["# Wird von fpanel verwaltet – Änderungen über Panel → Einstellungen → Webzugriff", "{"]
    if s.get("acme_email"):
        out.append(f"\temail {s['acme_email']}")
    proxies = [p for p in (s.get("trusted_proxies") or []) if p]
    if proxies:
        out += ["\tservers {", f"\t\ttrusted_proxies static {' '.join(proxies)}", "\t}"]
    out += ["}", "", "(fpanel) {", "\tencode zstd gzip", f"\treverse_proxy {upstream}", "}", ""]
    out += [", ".join(internal_sites) + " {", "\ttls internal", "\timport fpanel", "}", ""]
    if panel_domain and DOMAIN_RE.match(panel_domain):
        out += [f"{panel_domain} {{", "\timport fpanel", "}", ""]
    if s.get("http_mode") == "serve":
        out += ["http:// {", "\timport fpanel", "}"]
    else:
        out += ["http:// {", "\tredir https://{host}{uri} 308", "}"]
    return "\n".join(out) + "\n"


async def apply():
    text = render()
    if config.DEV:
        return {"applied": False, "caddyfile": text}
    old = config.CADDYFILE.read_text() if config.CADDYFILE.exists() else None
    config.CADDYFILE.write_text(text)
    p = await asyncio.create_subprocess_exec("caddy", "validate", "--config", str(config.CADDYFILE), "--adapter", "caddyfile",
                                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    out, _ = await p.communicate()
    if p.returncode != 0:
        if old is not None:
            config.CADDYFILE.write_text(old)
        raise RuntimeError("Caddy-Konfiguration ungültig: " + out.decode(errors="replace")[-400:])
    p = await asyncio.create_subprocess_exec("systemctl", "reload", "caddy", stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    out, _ = await p.communicate()
    if p.returncode != 0:
        raise RuntimeError("Caddy-Reload fehlgeschlagen: " + out.decode(errors="replace")[-400:])
    return {"applied": True, "caddyfile": text}
