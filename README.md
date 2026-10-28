# Werk – Factorio-Panel

Selbst gehostetes Panel für mehrere Factorio-Server: Benutzer mit eigenen Servern und Freigaben, Konsole mit Ingame-Chat, Dateimanager, Mods, Versionsverwaltung mit lokalem Cache und ein Ratio-Rechner.

## Funktionen

- **Server** – Start/Stopp/Neustart, CPU- und RAM-Verlauf live, RAM-Limit per cgroup, Autostart
- **Konsole** – RCON-Befehle und Chat (Text ohne `/` geht als Chat an die Spieler), Spielerliste mit Join/Leave
- **Dateien** – Dateimanager pro Server: hochladen, bearbeiten, umbenennen, entpacken, als ZIP laden
- **Versionen** – Headless-Versionen von factorio.com, einmal heruntergeladen und von allen Servern geteilt
- **Mods** – Suche im Mod-Portal, passende Version zur Spielversion, Abhängigkeiten, Updates, Space Age an/aus
- **Benutzer** – jeder legt eigene Server an (Kontingent für Anzahl und RAM), Freigabe an andere Benutzer mit vollen Rechten, Besitz übertragen
- **Domains** – `<name>.<basisdomain>` pro Server, Cloudflare-DNS wird auf Wunsch automatisch gepflegt
- **Ratio-Rechner** – Rezepte, Items und Maschinen gemeinsam für alle (live abgeglichen, automatische Sicherungen), persönliche Rechner mit Freigabe zum Ansehen, Maschinenauswahl pro Rechner, Produktionsbaum mit Bändern, Waggons, Leistung und Verschmutzung, eigene Icons aus der Spielinstallation

## Installation (Ubuntu 22.04/24.04, Debian 12, auch Proxmox-LXC)

```bash
git clone https://github.com/CallMeFriedrich/werk.git && cd werk
sudo bash deploy/install.sh
```

Danach `https://<server-ip>` öffnen und das Admin-Konto anlegen. Port 80 leitet auf 443 um.

Update: `git pull` und `sudo bash deploy/install.sh` erneut ausführen – Daten bleiben erhalten.

## Aufbau

| Pfad | Inhalt |
|---|---|
| `/opt/fpanel` | Programm (FastAPI + Oberfläche ohne Build-Step) |
| `/var/lib/fpanel/panel.db` | Benutzer, Server, Einstellungen, Ratio-Rechner (SQLite) |
| `/var/lib/fpanel/instances/<id>` | Spieldaten pro Server (im Dateimanager sichtbar) |
| `/var/lib/fpanel/versions/<ver>` | Entpackte Factorio-Versionen, von allen Servern geteilt |
| `/var/lib/fpanel/cache` | Heruntergeladene Archive und Mod-ZIPs (lokaler Cache) |
| `/var/lib/fpanel/logs/<id>.log` | Konsolen-Ausgabe |
| `fpanel.service` | Panel auf 127.0.0.1:8080 |
| `fpanel@<id>.service` | Ein Factorio-Server, läuft als User `factorio`, RAM-Limit per cgroup |
| Caddy | Port 80/443, internes Zertifikat für IP/Hostname, Let's Encrypt für eine Panel-Domain |

Server laufen unabhängig vom Panel weiter, wenn dieses neu startet.

## Panel über Cloudflare Tunnel

1. Im Tunnel als Service `http://<panel-ip>:80` eintragen (nicht HTTPS).
2. Im Panel unter Einstellungen → Webzugriff „Panel auch über HTTP auf Port 80“ wählen, die IP des cloudflared-Hosts unter „Vertrauenswürdige Proxys“ eintragen und das Feld „Panel-Domain“ leer lassen.

Die Spielserver selbst (UDP) laufen nicht über den Tunnel.

## Ports und Domains

Factorio unterstützt keine SRV-Einträge. Ohne Portangabe verbindet der Client immer auf UDP 34197 – pro IP-Adresse also genau ein Server.

- Jeder Server bekommt `<subdomain>.<basisdomain>`, Cloudflare-DNS wird auf Wunsch automatisch gepflegt.
- Ein Server pro IP hält Port 34197 („Standardport übernehmen“ tauscht ihn).
- Weitere Server bekommen 34198, 34199 … → Adresse `name.domain:34198`.
- Unter Einstellungen → Eigene IP pro Server lassen sich zusätzliche Adressen (z. B. IPv6 oder weitere IPv4 per 1:1-NAT) hinterlegen; Server darauf laufen wieder auf 34197.

Router: UDP 34197–34296 an den Server weiterleiten.

## Ratio-Rechner: Icons

Die Spiel-Icons sind nicht enthalten. Im Rechner unter Items oder Maschinen „Ordner wählen“ und `Factorio\data\base\graphics\icons` auswählen (für Space Age zusätzlich `data\space-age\graphics\icons`). Zugeordnet wird über den Spielnamen, z. B. `iron-plate`.

## Notfall

```bash
cd /opt/fpanel
FPANEL_DATA=/var/lib/fpanel venv/bin/python -m fpanel.cli reset-password <name>
FPANEL_DATA=/var/lib/fpanel venv/bin/python -m fpanel.cli make-admin <name>
FPANEL_DATA=/var/lib/fpanel venv/bin/python -m fpanel.cli caddy
```

## Entwicklung

```bash
pip install -r requirements.txt
FPANEL_DATA=./data FPANEL_RUNNER=process FPANEL_DEV=1 FPANEL_PORT=8099 uvicorn fpanel.main:app --port 8099
```

`FPANEL_RUNNER=process` startet Factorio-Server als normale Prozesse statt über systemd.

## Lizenzen

Die Schriften unter `web/fonts` sind IBM Plex Sans und IBM Plex Mono (SIL Open Font License 1.1, siehe `web/fonts/OFL.txt`).
