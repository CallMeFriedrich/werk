"""Prozesssteuerung der Factorio-Instanzen.

Produktion: systemd-Template fpanel@<id>.service. Instanzen laufen damit
unabhängig vom Panel weiter, wenn dieses neu startet oder aktualisiert wird.
Entwicklung: einfache Kindprozesse (FPANEL_RUNNER=process).
"""
import asyncio
import os
import signal
import subprocess
from pathlib import Path

import psutil

from . import config


async def _run(*args, check=True):
    p = await asyncio.create_subprocess_exec(*args, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    out, err = await p.communicate()
    if check and p.returncode != 0:
        raise RuntimeError((err or out).decode(errors="replace").strip() or f"{args[0]} fehlgeschlagen")
    return out.decode(errors="replace")


def unit(iid: str) -> str:
    return f"{config.UNIT_PREFIX}{iid}.service"


class SystemdRunner:
    async def configure(self, iid: str, memory_mb: int, auto_restart: bool):
        d = config.SYSTEMD_DIR / f"{unit(iid)}.d"
        d.mkdir(parents=True, exist_ok=True)
        lines = ["[Service]", f"MemoryMax={int(memory_mb)}M", "MemorySwapMax=0"]
        if auto_restart:
            lines += ["Restart=on-failure", "RestartSec=5"]
        (d / "10-fpanel.conf").write_text("\n".join(lines) + "\n")
        await _run("systemctl", "daemon-reload")

    async def remove(self, iid: str):
        await _run("systemctl", "stop", unit(iid), check=False)
        d = config.SYSTEMD_DIR / f"{unit(iid)}.d"
        if d.exists():
            for f in d.iterdir():
                f.unlink()
            d.rmdir()
        await _run("systemctl", "daemon-reload", check=False)
        await _run("systemctl", "reset-failed", unit(iid), check=False)

    async def start(self, iid):
        await _run("systemctl", "reset-failed", unit(iid), check=False)
        await _run("systemctl", "start", "--no-block", unit(iid))

    async def stop(self, iid):
        await _run("systemctl", "stop", "--no-block", unit(iid))

    async def kill(self, iid):
        await _run("systemctl", "kill", "-s", "SIGKILL", unit(iid), check=False)

    async def states(self, iids):
        if not iids:
            return {}
        out = await _run("systemctl", "show", *[unit(i) for i in iids],
                         "-p", "Id,ActiveState,SubState,MainPID,ControlGroup,Result,ExecMainStatus", check=False)
        res, cur = {}, {}
        for line in out.splitlines() + [""]:
            if not line.strip():
                if cur.get("Id", "").startswith(config.UNIT_PREFIX):
                    iid = cur["Id"][len(config.UNIT_PREFIX):-len(".service")]
                    res[iid] = cur
                cur = {}
                continue
            k, _, v = line.partition("=")
            cur[k] = v
        return res

    def usage(self, info):
        """(cpu_usec_total, mem_bytes) aus der cgroup, Fallback psutil."""
        cg = info.get("ControlGroup")
        if cg:
            base = Path("/sys/fs/cgroup") / cg.lstrip("/")
            try:
                cpu = 0
                for line in (base / "cpu.stat").read_text().splitlines():
                    if line.startswith("usage_usec"):
                        cpu = int(line.split()[1])
                mem = int((base / "memory.current").read_text())
                for line in (base / "memory.stat").read_text().splitlines():
                    if line.startswith("inactive_file "):
                        mem -= int(line.split()[1])
                return cpu, max(mem, 0)
            except OSError:
                pass
        pid = int(info.get("MainPID") or 0)
        return _psutil_usage(pid)


def _psutil_usage(pid):
    if not pid:
        return 0, 0
    try:
        p = psutil.Process(pid)
        procs = [p] + p.children(recursive=True)
        cpu = mem = 0
        for pr in procs:
            t = pr.cpu_times()
            cpu += int((t.user + t.system) * 1e6)
            mem += pr.memory_info().rss
        return cpu, mem
    except psutil.Error:
        return 0, 0


class ProcessRunner:
    """Nur für Entwicklung und Tests ohne systemd."""

    def __init__(self):
        self.procs: dict[str, subprocess.Popen] = {}

    async def configure(self, iid, memory_mb, auto_restart):
        pass

    async def remove(self, iid):
        await self.kill(iid)

    async def start(self, iid):
        if iid in self.procs and self.procs[iid].poll() is None:
            return
        log = open(config.LOGS / f"{iid}.log", "ab")
        self.procs[iid] = subprocess.Popen([str(config.RUN / iid / "launch.sh")], stdout=log, stderr=subprocess.STDOUT,
                                           cwd=str(config.INSTANCES / iid), start_new_session=True)

    async def stop(self, iid):
        p = self.procs.get(iid)
        if p and p.poll() is None:
            os.killpg(p.pid, signal.SIGINT)

    async def kill(self, iid):
        p = self.procs.get(iid)
        if p and p.poll() is None:
            os.killpg(p.pid, signal.SIGKILL)

    async def states(self, iids):
        res = {}
        for i in iids:
            p = self.procs.get(i)
            if p and p.poll() is None:
                res[i] = {"ActiveState": "active", "SubState": "running", "MainPID": str(p.pid)}
            elif p:
                res[i] = {"ActiveState": "failed" if p.returncode not in (0, None) else "inactive",
                          "SubState": "dead", "MainPID": "0", "ExecMainStatus": str(p.returncode)}
            else:
                res[i] = {"ActiveState": "inactive", "SubState": "dead", "MainPID": "0"}
        return res

    def usage(self, info):
        return _psutil_usage(int(info.get("MainPID") or 0))


runner = SystemdRunner() if config.RUNNER == "systemd" else ProcessRunner()
