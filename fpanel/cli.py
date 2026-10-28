"""Werkzeuge für die Kommandozeile:

  python -m fpanel.cli caddy                 Caddyfile schreiben und Caddy neu laden
  python -m fpanel.cli reset-password NAME   neues Passwort setzen (wird ausgegeben)
  python -m fpanel.cli make-admin NAME       Benutzer zum Admin machen
"""
import asyncio
import secrets
import sys

from . import auth, config, db, net, webserver


def main():
    config.ensure_dirs()
    db.init()
    if not db.get_setting("primary_ip"):
        db.set_setting("primary_ip", net.detect_primary_ip())
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    cmd = sys.argv[1]
    if cmd == "caddy":
        r = asyncio.run(webserver.apply())
        print(r["caddyfile"])
        return 0
    if cmd in ("reset-password", "make-admin") and len(sys.argv) == 3:
        u = db.q1("SELECT id FROM users WHERE username=?", (sys.argv[2],))
        if not u:
            print("Benutzer nicht gefunden")
            return 1
        if cmd == "make-admin":
            db.x("UPDATE users SET role='admin' WHERE id=?", (u["id"],))
            print("ok")
        else:
            pw = secrets.token_urlsafe(10)
            db.x("UPDATE users SET pw_hash=? WHERE id=?", (auth.hash_pw(pw), u["id"]))
            db.x("DELETE FROM sessions WHERE user_id=?", (u["id"],))
            print(f"Neues Passwort für {sys.argv[2]}: {pw}")
        return 0
    print(__doc__)
    return 1


if __name__ == "__main__":
    sys.exit(main())
