"""SQLite-Zugriff. Ein Panel-Prozess, wenige Schreibzugriffe: synchrones sqlite3 reicht."""
import json
import sqlite3
import threading
import time

from . import config

_local = threading.local()
_lock = threading.RLock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pw_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    max_instances INTEGER NOT NULL DEFAULT 3,
    max_memory_mb INTEGER NOT NULL DEFAULT 4096,
    created_at REAL NOT NULL,
    last_login REAL
);
CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at REAL NOT NULL,
    expires_at REAL NOT NULL,
    ip TEXT
);
CREATE TABLE IF NOT EXISTS instances (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    subdomain TEXT NOT NULL UNIQUE,
    owner_id INTEGER NOT NULL REFERENCES users(id),
    version TEXT NOT NULL,
    port INTEGER NOT NULL,
    bind_ip TEXT NOT NULL DEFAULT '0.0.0.0',
    public_ip TEXT,
    rcon_port INTEGER NOT NULL UNIQUE,
    rcon_password TEXT NOT NULL,
    memory_mb INTEGER NOT NULL DEFAULT 2048,
    autostart INTEGER NOT NULL DEFAULT 0,
    auto_restart INTEGER NOT NULL DEFAULT 0,
    options TEXT NOT NULL DEFAULT '{}',
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
    instance_id TEXT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_by INTEGER,
    added_at REAL NOT NULL,
    PRIMARY KEY (instance_id, user_id)
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_data (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at REAL NOT NULL,
    PRIMARY KEY (user_id, key)
);
CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY,
    ts REAL NOT NULL,
    user_id INTEGER,
    instance_id TEXT,
    action TEXT NOT NULL,
    detail TEXT
);
"""

DEFAULT_SETTINGS = {
    "base_domain": "",
    "public_ipv4": "",
    "port_range_start": 34197,
    "port_range_end": 34296,
    "dedicated_ips": [],          # [{"bind": "10.10.6.13", "public": "1.2.3.4"}]
    "cloudflare_token": "",
    "cloudflare_zone_id": "",
    "factorio_username": "",
    "factorio_token": "",
    "panel_domain": "",
    "acme_email": "",
    "http_mode": "redirect",       # redirect | serve
    "default_memory_mb": 2048,
    "primary_ip": "",              # leer = automatisch erkannt
    "trusted_proxies": [],         # z. B. cloudflared-IP; deren X-Forwarded-* werden übernommen
}


def conn() -> sqlite3.Connection:
    c = getattr(_local, "conn", None)
    if c is None:
        c = sqlite3.connect(config.DB_PATH, timeout=30, check_same_thread=False)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA foreign_keys=ON")
        c.execute("PRAGMA journal_mode=WAL")
        _local.conn = c
    return c


def init():
    with _lock:
        c = conn()
        c.executescript(SCHEMA)
        c.commit()


def q(sql, args=()):
    with _lock:
        return [dict(r) for r in conn().execute(sql, args).fetchall()]


def q1(sql, args=()):
    with _lock:
        r = conn().execute(sql, args).fetchone()
        return dict(r) if r else None


def x(sql, args=()):
    with _lock:
        c = conn()
        cur = c.execute(sql, args)
        c.commit()
        return cur


def get_setting(key):
    r = q1("SELECT value FROM settings WHERE key=?", (key,))
    if r is None:
        return DEFAULT_SETTINGS.get(key)
    return json.loads(r["value"])


def all_settings():
    out = dict(DEFAULT_SETTINGS)
    for r in q("SELECT key, value FROM settings"):
        out[r["key"]] = json.loads(r["value"])
    return out


def set_setting(key, value):
    x("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      (key, json.dumps(value)))


def audit(user_id, action, instance_id=None, detail=None):
    x("INSERT INTO audit(ts, user_id, instance_id, action, detail) VALUES(?,?,?,?,?)",
      (time.time(), user_id, instance_id, action, detail))
