"""Write privacy-minimized Codex lifecycle events for My AI Office."""

from __future__ import annotations

import hashlib
import json
import os
import socket
import sys
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


EVENT_TYPE = {
    "SessionStart": "session.started",
    "SessionEnd": "session.ended",
    "UserPromptSubmit": "directive.submitted",
    "SubagentStart": "employee.started",
    "SubagentStop": "employee.completed",
    "PreToolUse": "employee.tool.started",
    "PostToolUse": "employee.tool.completed",
    "PermissionRequest": "employee.approval.waiting",
    "PreCompact": "session.compacting",
    "PostCompact": "session.working",
    "Stop": "turn.stopping",
}

EVENT_STATUS = {
    "SessionStart": "online",
    "SessionEnd": "offline",
    "UserPromptSubmit": "working",
    "SubagentStart": "working",
    "SubagentStop": "completed",
    "PreToolUse": "working",
    "PostToolUse": "working",
    "PermissionRequest": "waiting_approval",
    "PreCompact": "compacting",
    "PostCompact": "working",
    "Stop": "stopping",
}


def _text(value: Any, limit: int = 240) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value[:limit] if value else None


def _host_id(base_dir: Path) -> str:
    path = base_dir / "host-id"
    try:
        existing = path.read_text(encoding="utf-8").strip()
        if existing:
            return existing[:80]
    except OSError:
        pass

    value = hashlib.sha256(f"{socket.gethostname()}:{uuid.uuid4()}".encode()).hexdigest()[:16]
    try:
        path.write_text(value, encoding="utf-8")
    except OSError:
        pass
    return value


def _opaque(base_dir: Path, namespace: str, value: Any) -> str | None:
    text = _text(value, 1024)
    if not text:
        return None
    digest = hashlib.sha256(f"{_host_id(base_dir)}:{namespace}:{text}".encode()).hexdigest()[:24]
    return f"{namespace}-{digest}"


@contextmanager
def _locked(path: Path):
    """Serialize tiny cross-process writes so parallel hooks cannot interleave."""
    handle = path.open("a+b")
    try:
        handle.seek(0, os.SEEK_END)
        if handle.tell() == 0:
            handle.write(b"0")
            handle.flush()
        handle.seek(0)
        if os.name == "nt":
            import msvcrt

            msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        yield
    finally:
        try:
            handle.seek(0)
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        finally:
            handle.close()


def _next_sequence(path: Path) -> int:
    try:
        current = int(path.read_text(encoding="ascii").strip())
    except (OSError, ValueError):
        current = 0
    next_value = current + 1
    path.write_text(str(next_value), encoding="ascii")
    return next_value


def _rotate_if_needed(path: Path) -> None:
    max_bytes = 20 * 1024 * 1024
    try:
        if path.stat().st_size < max_bytes:
            return
    except FileNotFoundError:
        return
    backup = path.with_name(f"{path.name}.1")
    if backup.exists():
        backup.unlink()
    path.replace(backup)


def _event_from(raw: dict[str, Any], base_dir: Path) -> dict[str, Any]:
    cwd = _text(raw.get("cwd"), 1024) or "unknown"
    normalized_cwd = os.path.normcase(os.path.normpath(cwd))
    event_name = _text(raw.get("hook_event_name"), 80) or "Unknown"
    project_name = Path(cwd).name or "Unknown project"

    # Only whitelisted metadata is persisted. Prompts, commands, tool input/output,
    # file contents, full paths, credentials, and raw source identifiers are omitted.
    event = {
        "schemaVersion": 1,
        "id": str(uuid.uuid4()),
        "at": datetime.now(timezone.utc).isoformat(),
        "type": EVENT_TYPE.get(event_name, "activity.observed"),
        "status": EVENT_STATUS.get(event_name, "observed"),
        "project": {
            "key": hashlib.sha256(normalized_cwd.encode("utf-8")).hexdigest()[:12],
            "name": project_name[:160],
        },
        "sessionId": _opaque(base_dir, "session", raw.get("session_id")),
        "turnId": _opaque(base_dir, "turn", raw.get("turn_id")),
        "employeeId": _opaque(base_dir, "employee", raw.get("agent_id")),
        "employeeRole": _text(raw.get("agent_type"), 120),
        "tool": _text(raw.get("tool_name"), 160),
        "toolUseId": _opaque(base_dir, "tool-use", raw.get("tool_use_id")),
    }
    return {key: value for key, value in event.items() if value is not None}


def main() -> int:
    try:
        raw = json.load(sys.stdin)
        if not isinstance(raw, dict):
            return 0

        default_dir = Path.home() / ".codex" / "ai-office"
        output_path = Path(os.environ.get("AI_OFFICE_EVENTS_PATH", default_dir / "events.jsonl"))
        output_path.parent.mkdir(parents=True, exist_ok=True)
        base_dir = output_path.parent

        with _locked(base_dir / "events.lock"):
            event = _event_from(raw, base_dir)
            event["appendSeq"] = _next_sequence(base_dir / "events.seq")
            line = json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n"
            _rotate_if_needed(output_path)
            with output_path.open("ab") as stream:
                stream.write(line.encode("utf-8"))
                stream.flush()
    except Exception:
        # Observability must never block or fail a Codex task.
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
