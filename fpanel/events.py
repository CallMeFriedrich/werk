"""Hintergrund-Tasks (Downloads, Mod-Installationen) und Event-Verteilung an Browser."""
import asyncio
import secrets
import time
import traceback

_subscribers: dict = {}            # Schlüssel -> (queue, user)
tasks: dict[str, dict] = {}


def subscribe(user):
    q = asyncio.Queue(maxsize=500)
    entry = (q, user)
    _subscribers[id(q)] = entry
    return entry


def unsubscribe(entry):
    _subscribers.pop(id(entry[0]), None)


def publish(event: dict, visible_to=None):
    """visible_to: None = alle, sonst Funktion(user) -> bool."""
    for q, user in list(_subscribers.values()):
        if visible_to is not None and not visible_to(user):
            continue
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            pass


def _task_visible(task):
    return lambda u: u["role"] == "admin" or u["id"] == task["user_id"] or (
        task.get("instance_id") and _can(u, task["instance_id"]))


def _can(u, iid):
    from .auth import can_access
    return can_access(u, iid)


def start_task(kind: str, title: str, coro_fn, user_id: int, instance_id=None) -> dict:
    """coro_fn(progress) -> Ergebnis; progress(fraction|None, text)."""
    tid = secrets.token_hex(6)
    task = {"id": tid, "kind": kind, "title": title, "state": "running", "progress": None,
            "text": "", "user_id": user_id, "instance_id": instance_id, "started": time.time(), "error": None}
    tasks[tid] = task

    def progress(frac=None, text=None):
        if frac is not None:
            task["progress"] = round(max(0.0, min(1.0, frac)), 3)
        if text is not None:
            task["text"] = text
        publish({"type": "task", "task": task}, _task_visible(task))

    async def runner():
        try:
            result = await coro_fn(progress)
            task["state"] = "done"
            task["result"] = result
        except Exception as e:
            task["state"] = "error"
            task["error"] = str(e) or e.__class__.__name__
            traceback.print_exc()
        task["finished"] = time.time()
        publish({"type": "task", "task": task}, _task_visible(task))
        # alte Tasks aufräumen
        for k in [k for k, t in tasks.items() if t.get("finished") and time.time() - t["finished"] > 3600]:
            tasks.pop(k, None)

    publish({"type": "task", "task": task}, _task_visible(task))
    asyncio.get_running_loop().create_task(runner())
    return task
