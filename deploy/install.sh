#!/usr/bin/env bash
# Werk – Factorio-Panel: Installation / Update
# Getestet mit Ubuntu 22.04/24.04 und Debian 12 (auch als Proxmox-LXC).
# Aufruf als root aus dem entpackten Ordner:  bash deploy/install.sh
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP=/opt/fpanel
DATA=/var/lib/fpanel

say() { printf '\n\033[1;33m==>\033[0m %s\n' "$*"; }
[ "$(id -u)" = 0 ] || { echo "Bitte als root ausführen."; exit 1; }

say "Pakete installieren"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq python3 python3-venv python3-pip curl ca-certificates gnupg xz-utils debian-keyring \
  debian-archive-keyring apt-transport-https >/dev/null

if ! command -v caddy >/dev/null; then
  say "Caddy installieren (Webserver für Port 80/443)"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy >/dev/null
fi

say "Benutzer und Verzeichnisse"
id factorio >/dev/null 2>&1 || useradd --system --home-dir "$DATA" --no-create-home --shell /usr/sbin/nologin factorio
install -d -m 0755 "$DATA" "$DATA/versions" "$DATA/cache" "$DATA/cache/downloads" "$DATA/cache/mods"
install -d -m 0755 -o factorio -g factorio "$DATA/instances"
install -d -m 0750 -o root -g factorio "$DATA/run"
install -d -m 0750 "$DATA/logs"

say "Programm nach $APP kopieren"
install -d "$APP"
rm -rf "$APP/fpanel" "$APP/web"
cp -r "$SRC/fpanel" "$SRC/web" "$SRC/requirements.txt" "$APP/"
find "$APP" -name '__pycache__' -prune -exec rm -rf {} +
# Schrift IBM Plex (OFL) aus dem npm-Registry holen, falls nicht mitgeliefert
if [ ! -f "$APP/web/fonts/ibm-plex-sans-latin-400-normal.woff2" ]; then
  install -d "$APP/web/fonts"
  T=$(mktemp -d)
  for pkg in ibm-plex-sans ibm-plex-mono; do
    curl -fsSL "https://registry.npmjs.org/@fontsource/$pkg/-/$pkg-5.3.0.tgz" | tar -xz -C "$T" || true
    for w in 400 500 600; do
      f="$T/package/files/$pkg-latin-$w-normal.woff2"
      [ -f "$f" ] && cp "$f" "$APP/web/fonts/"
    done
    rm -rf "$T/package"
  done
  rm -rf "$T"
fi
[ -d "$APP/venv" ] || python3 -m venv "$APP/venv"
"$APP/venv/bin/pip" install -q --upgrade pip
"$APP/venv/bin/pip" install -q -r "$APP/requirements.txt"

say "systemd-Units"
install -m 0644 "$SRC/deploy/fpanel.service" /etc/systemd/system/fpanel.service
install -m 0644 "$SRC/deploy/fpanel@.service" /etc/systemd/system/fpanel@.service
install -d /etc/systemd/system/fpanel@.service.d
# Dateisystem-Härtung nur, wenn der Container Mount-Namespaces zulässt
if systemd-run --quiet --wait --collect -p ProtectSystem=strict -p PrivateTmp=yes -p ProtectHome=yes /bin/true 2>/dev/null; then
  cat > /etc/systemd/system/fpanel@.service.d/hardening.conf <<'EOF'
[Service]
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/var/lib/fpanel/instances/%i
ProtectKernelTunables=yes
ProtectControlGroups=yes
EOF
  echo "Härtung aktiv"
else
  rm -f /etc/systemd/system/fpanel@.service.d/hardening.conf
  echo "Container erlaubt keine Mount-Namespaces – Härtung übersprungen"
fi
systemctl daemon-reload
systemctl enable -q fpanel.service
systemctl restart fpanel.service

say "Caddy auf Port 80/443 konfigurieren"
(cd "$APP" && FPANEL_DATA="$DATA" "$APP/venv/bin/python" -m fpanel.cli caddy >/dev/null)
systemctl enable -q caddy
systemctl restart caddy

IP=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}')
say "Fertig"
echo "Panel:  https://${IP:-<server-ip>}   (internes Zertifikat, Browser-Warnung einmal bestätigen)"
echo "        http://${IP:-<server-ip>} leitet auf HTTPS um"
echo "Beim ersten Aufruf legst du das Admin-Konto an."
echo "Spielports: UDP 34197–34296 im Router an ${IP:-diesen Server} weiterleiten."
