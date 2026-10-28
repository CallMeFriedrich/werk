"""Pfade und Grundkonfiguration. Alles ist per Umgebungsvariable überschreibbar."""
import os
from pathlib import Path

DATA = Path(os.environ.get("FPANEL_DATA", "/var/lib/fpanel"))
WEB = Path(os.environ.get("FPANEL_WEB", Path(__file__).resolve().parent.parent / "web"))

DB_PATH = DATA / "panel.db"
INSTANCES = DATA / "instances"      # Spieldaten pro Instanz (im Dateimanager sichtbar)
RUN = DATA / "run"                  # Startskripte/config.ini (nur root, nicht editierbar)
LOGS = DATA / "logs"                # stdout der Server
VERSIONS = DATA / "versions"        # entpackte Factorio-Versionen (geteilt)
CACHE = DATA / "cache"              # heruntergeladene Archive, Mod-Index, Mod-Zips

# "systemd" (Produktion) oder "process" (Entwicklung ohne systemd)
RUNNER = os.environ.get("FPANEL_RUNNER", "systemd")
GAME_USER = os.environ.get("FPANEL_GAME_USER", "factorio")
UNIT_PREFIX = "fpanel@"
SYSTEMD_DIR = Path("/etc/systemd/system")
CADDYFILE = Path(os.environ.get("FPANEL_CADDYFILE", "/etc/caddy/Caddyfile"))

LISTEN_HOST = os.environ.get("FPANEL_HOST", "127.0.0.1")
LISTEN_PORT = int(os.environ.get("FPANEL_PORT", "8080"))

USER_AGENT = "fpanel/1.0 (self-hosted Factorio panel)"
DEFAULT_GAME_PORT = 34197

SESSION_DAYS = 14
DEV = os.environ.get("FPANEL_DEV") == "1"


def ensure_dirs():
    for p in (DATA, INSTANCES, RUN, LOGS, VERSIONS, CACHE, CACHE / "downloads", CACHE / "mods"):
        p.mkdir(parents=True, exist_ok=True)
