"""Passwörter (scrypt, stdlib), Sessions, Rechteprüfung."""
import hashlib
import hmac
import secrets
import time
from collections import defaultdict

from fastapi import HTTPException, Request

from . import config, db

COOKIE = "fp_session"

# --- Passwort-Hashing -------------------------------------------------------

_N, _R, _P = 2 ** 14, 8, 1


def hash_pw(pw: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(pw.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return f"scrypt${_N}${_R}${_P}${salt.hex()}${dk.hex()}"


def check_pw(pw: str, stored: str) -> bool:
    try:
        _, n, r, p, salt, dk = stored.split("$")
        got = hashlib.scrypt(pw.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p), dklen=len(dk) // 2)
        return hmac.compare_digest(got.hex(), dk)
    except Exception:
        return False


def validate_password(pw: str):
    if len(pw or "") < 8:
        raise HTTPException(400, "Das Passwort braucht mindestens 8 Zeichen.")


# --- Login-Drosselung -------------------------------------------------------

_fails = defaultdict(list)


def throttle(ip: str):
    now = time.time()
    _fails[ip] = [t for t in _fails[ip] if now - t < 600]
    if len(_fails[ip]) >= 8:
        raise HTTPException(429, "Zu viele Fehlversuche. Bitte in einigen Minuten erneut versuchen.")


def record_fail(ip: str):
    _fails[ip].append(time.time())


# --- Sessions ---------------------------------------------------------------

def create_session(user_id: int, ip: str) -> str:
    token = secrets.token_urlsafe(32)
    now = time.time()
    db.x("INSERT INTO sessions(token, user_id, created_at, expires_at, ip) VALUES(?,?,?,?,?)",
         (token, user_id, now, now + config.SESSION_DAYS * 86400, ip))
    db.x("UPDATE users SET last_login=? WHERE id=?", (now, user_id))
    db.x("DELETE FROM sessions WHERE expires_at < ?", (now,))
    return token


def user_from_token(token: str | None):
    if not token:
        return None
    s = db.q1("SELECT user_id FROM sessions WHERE token=? AND expires_at > ?", (token, time.time()))
    if not s:
        return None
    return db.q1("SELECT id, username, role, max_instances, max_memory_mb, created_at, last_login FROM users WHERE id=?",
                 (s["user_id"],))


def current_user(request: Request):
    user = user_from_token(request.cookies.get(COOKIE))
    if not user:
        raise HTTPException(401, "Nicht angemeldet.")
    # CSRF-Schutz: verändernde Requests brauchen einen eigenen Header,
    # den ein fremdes Formular nicht setzen kann.
    if request.method not in ("GET", "HEAD", "OPTIONS") and request.headers.get("x-fpanel") != "1":
        raise HTTPException(403, "Anfrage ohne Panel-Header abgelehnt.")
    return user


def require_admin(user):
    if user["role"] != "admin":
        raise HTTPException(403, "Nur für Administratoren.")


def can_access(user, instance_id: str) -> bool:
    if user["role"] == "admin":
        return True
    r = db.q1("SELECT owner_id FROM instances WHERE id=?", (instance_id,))
    if not r:
        return False
    if r["owner_id"] == user["id"]:
        return True
    return db.q1("SELECT 1 FROM members WHERE instance_id=? AND user_id=?", (instance_id, user["id"])) is not None


def visible_instance_ids(user) -> list[str]:
    if user["role"] == "admin":
        return [r["id"] for r in db.q("SELECT id FROM instances")]
    return [r["id"] for r in db.q(
        "SELECT id FROM instances WHERE owner_id=? UNION SELECT instance_id FROM members WHERE user_id=?",
        (user["id"], user["id"]))]
