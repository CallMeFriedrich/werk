"""Minimaler asynchroner Source-RCON-Client für Factorio.

Factorio beantwortet jeden Befehl mit genau einem Antwortpaket, auch bei langen
Ausgaben. Text ohne führenden "/" wird als Chatnachricht von <server> gesendet.
"""
import asyncio
import struct

AUTH, EXEC, RESP = 3, 2, 0


class RconError(Exception):
    pass


class Rcon:
    def __init__(self, host: str, port: int, password: str):
        self.host, self.port, self.password = host, port, password
        self.reader = self.writer = None
        self._id = 10
        self._lock = asyncio.Lock()

    async def _send(self, kind: int, body: str) -> int:
        self._id += 1
        data = body.encode("utf-8")
        pkt = struct.pack("<ii", self._id, kind) + data + b"\x00\x00"
        self.writer.write(struct.pack("<i", len(pkt)) + pkt)
        await self.writer.drain()
        return self._id

    async def _recv(self):
        raw = await self.reader.readexactly(4)
        (size,) = struct.unpack("<i", raw)
        payload = await self.reader.readexactly(size)
        rid, kind = struct.unpack("<ii", payload[:8])
        return rid, kind, payload[8:-2].decode("utf-8", "replace")

    async def connect(self):
        self.reader, self.writer = await asyncio.wait_for(
            asyncio.open_connection(self.host, self.port), timeout=3)
        rid = await self._send(AUTH, self.password)
        while True:
            got, kind, _ = await asyncio.wait_for(self._recv(), timeout=5)
            if kind == 2:  # AUTH_RESPONSE
                if got == -1:
                    raise RconError("RCON-Passwort abgelehnt")
                if got == rid:
                    return

    async def close(self):
        if self.writer:
            self.writer.close()
            try:
                await self.writer.wait_closed()
            except Exception:
                pass
        self.reader = self.writer = None

    async def command(self, cmd: str, timeout: float = 10) -> str:
        async with self._lock:
            for attempt in (1, 2):
                try:
                    if not self.writer:
                        await self.connect()
                    rid = await self._send(EXEC, cmd)
                    while True:
                        got, _, body = await asyncio.wait_for(self._recv(), timeout=timeout)
                        if got == rid:
                            return body
                except (OSError, asyncio.IncompleteReadError, asyncio.TimeoutError) as e:
                    await self.close()
                    if attempt == 2:
                        raise RconError(f"RCON nicht erreichbar: {e.__class__.__name__}")
