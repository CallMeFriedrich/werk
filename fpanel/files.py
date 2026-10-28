"""Dateimanager pro Instanz. Jeder Pfad wird relativ zum Instanzordner aufgelöst
und darf diesen nie verlassen (auch nicht über Symlinks)."""
import io
import os
import shutil
import stat
import time
import zipfile
from pathlib import Path

from fastapi import HTTPException

from .instances import chown_tree, data_dir

TEXT_EXT = {".json", ".txt", ".cfg", ".ini", ".lua", ".log", ".md", ".csv", ".yml", ".yaml", ".xml", ".sh", ""}
MAX_EDIT = 2 * 1024 * 1024


def resolve(iid: str, rel: str, must_exist=True) -> Path:
    root = data_dir(iid).resolve()
    rel = (rel or "").replace("\\", "/").lstrip("/")
    p = (root / rel).resolve()
    if p != root and root not in p.parents:
        raise HTTPException(400, "Pfad liegt außerhalb der Instanz")
    if must_exist and not p.exists():
        raise HTTPException(404, "Datei oder Ordner nicht gefunden")
    return p


def listdir(iid, rel):
    p = resolve(iid, rel)
    if not p.is_dir():
        raise HTTPException(400, "Kein Ordner")
    out = []
    for e in p.iterdir():
        try:
            s = e.lstat()
        except OSError:
            continue
        is_dir = stat.S_ISDIR(s.st_mode)
        out.append({
            "name": e.name,
            "dir": is_dir,
            "size": 0 if is_dir else s.st_size,
            "mtime": s.st_mtime,
            "link": stat.S_ISLNK(s.st_mode),
            "text": (not is_dir) and e.suffix.lower() in TEXT_EXT and s.st_size <= MAX_EDIT,
        })
    out.sort(key=lambda x: (not x["dir"], x["name"].lower()))
    return out


def read_text(iid, rel):
    p = resolve(iid, rel)
    if not p.is_file():
        raise HTTPException(400, "Keine Datei")
    if p.stat().st_size > MAX_EDIT:
        raise HTTPException(400, "Datei zu groß für den Editor (max. 2 MB)")
    raw = p.read_bytes()
    if b"\x00" in raw[:8192]:
        raise HTTPException(400, "Binärdatei – nur Download möglich")
    return raw.decode("utf-8", "replace")


def write_text(iid, rel, content: str):
    p = resolve(iid, rel, must_exist=False)
    if p.exists() and p.is_dir():
        raise HTTPException(400, "Ziel ist ein Ordner")
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(f".{p.name}.fpanel-tmp")
    tmp.write_text(content, encoding="utf-8")
    tmp.replace(p)
    chown_tree(p)


def mkdir(iid, rel):
    p = resolve(iid, rel, must_exist=False)
    p.mkdir(parents=True, exist_ok=True)
    chown_tree(p)


def rename(iid, src, dst):
    a = resolve(iid, src)
    b = resolve(iid, dst, must_exist=False)
    if a == data_dir(iid).resolve():
        raise HTTPException(400, "Der Wurzelordner kann nicht verschoben werden")
    if b.exists():
        raise HTTPException(409, "Ziel existiert bereits")
    b.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(a), str(b))


def delete(iid, rels):
    root = data_dir(iid).resolve()
    for rel in rels:
        p = resolve(iid, rel)
        if p == root:
            raise HTTPException(400, "Der Wurzelordner kann nicht gelöscht werden")
        if p.is_dir() and not p.is_symlink():
            shutil.rmtree(p)
        else:
            p.unlink()


def copy(iid, src, dst):
    a = resolve(iid, src)
    b = resolve(iid, dst, must_exist=False)
    if b.exists():
        raise HTTPException(409, "Ziel existiert bereits")
    if a.is_dir():
        shutil.copytree(a, b, symlinks=True)
    else:
        shutil.copy2(a, b)
    chown_tree(b)


async def save_upload(iid, rel_dir, upload):
    d = resolve(iid, rel_dir)
    if not d.is_dir():
        raise HTTPException(400, "Zielordner existiert nicht")
    name = Path(upload.filename or "upload").name
    if name in ("", ".", ".."):
        raise HTTPException(400, "Ungültiger Dateiname")
    target = resolve(iid, f"{rel_dir}/{name}", must_exist=False)
    tmp = target.with_name(f".{name}.upload")
    with open(tmp, "wb") as f:
        while chunk := await upload.read(1 << 20):
            f.write(chunk)
    tmp.replace(target)
    chown_tree(target)
    return name


def extract(iid, rel):
    """ZIP im selben Ordner entpacken (z. B. Szenario-Pakete)."""
    p = resolve(iid, rel)
    if not zipfile.is_zipfile(p):
        raise HTTPException(400, "Keine ZIP-Datei")
    root = data_dir(iid).resolve()
    dest = p.parent
    with zipfile.ZipFile(p) as z:
        for m in z.infolist():
            target = (dest / m.filename).resolve()
            if target != root and root not in target.parents:
                raise HTTPException(400, f"Unsicherer Pfad im Archiv: {m.filename}")
        z.extractall(dest)
    chown_tree(dest)


def zip_stream(iid, rels):
    """Mehrere Dateien/Ordner als ZIP (Generator für StreamingResponse)."""
    root = data_dir(iid).resolve()
    paths = [resolve(iid, r) for r in rels]

    class Buf(io.RawIOBase):
        def __init__(self):
            self.chunks = []

        def writable(self):
            return True

        def write(self, b):
            self.chunks.append(bytes(b))
            return len(b)

    buf = Buf()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED, compresslevel=5) as z:
        for p in paths:
            base = p.parent
            items = [p] if p.is_file() else [Path(r) / f for r, _, fs in os.walk(p) for f in fs]
            for f in items:
                if f.is_symlink():
                    continue
                arc = str(f.relative_to(base)) if p != root else str(f.relative_to(root))
                zi = zipfile.ZipInfo.from_file(f, arc)
                # ZIPs (Spielstände, Mods) nicht erneut komprimieren
                zi.compress_type = zipfile.ZIP_STORED if f.suffix.lower() == ".zip" else zipfile.ZIP_DEFLATED
                with open(f, "rb") as src, z.open(zi, "w", force_zip64=True) as dst:
                    while chunk := src.read(1 << 20):
                        dst.write(chunk)
                        if buf.chunks:
                            yield b"".join(buf.chunks)
                            buf.chunks.clear()
                if buf.chunks:
                    yield b"".join(buf.chunks)
                    buf.chunks.clear()
    if buf.chunks:
        yield b"".join(buf.chunks)


def usage_bytes(iid) -> int:
    total = 0
    for r, _, fs in os.walk(data_dir(iid)):
        for f in fs:
            try:
                total += os.lstat(os.path.join(r, f)).st_size
            except OSError:
                pass
    return total
