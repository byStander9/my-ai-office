"""Write privacy-minimized Codex lifecycle events for My AI Office."""

from __future__ import annotations

import hashlib
import json
import os
import re
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


def _details_enabled(base_dir: Path) -> bool:
    if os.environ.get("AI_OFFICE_CAPTURE_DETAILS", "").lower() in {"1", "true", "yes", "on"}:
        return True
    try:
        settings = json.loads((base_dir / "settings.json").read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return False
    return settings.get("captureDetails") is True if isinstance(settings, dict) else False


def _redacted_detail(value: Any, limit: int = 280) -> str | None:
    text = _text(value, 2_000)
    if not text:
        return None
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", " ", text)
    text = re.sub(r"-----BEGIN[^-]*PRIVATE KEY-----.*?-----END[^-]*PRIVATE KEY-----", "[개인 키]", text, flags=re.I | re.S)
    text = re.sub(r"\b(?:sk|ghp|github_pat|glpat|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b", "[비밀정보]", text, flags=re.I)
    text = re.sub(r"\bAKIA[A-Z0-9]{16}\b", "[비밀정보]", text)
    text = re.sub(r"\bAuthorization\s*:\s*[^\r\n,;]+", "인증정보: [비밀정보]", text, flags=re.I)
    text = re.sub(r"\bBearer\s+[^\s,;]+", "접근 토큰 [비밀정보]", text, flags=re.I)
    text = re.sub(r"\b([a-z][a-z0-9+.-]*://)[^/\s:@]+:[^@\s/]+@", r"\1[인증정보]@", text, flags=re.I)
    text = re.sub(r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b", "[이메일]", text)
    text = re.sub(r"\b[A-Za-z]:\\[^\r\n,;]+", "[경로]", text)
    text = re.sub(r"(?<![\w:])/(?:[A-Za-z0-9._~-]+(?:/[^\s,;]+)*)", "[경로]", text)
    text = re.sub(r"\b(password|passwd|token|api[\s_-]*key|secret)\s*[:=]\s*[^\s,;]+", "민감정보=[비밀정보]", text, flags=re.I)
    text = " ".join(text.split())
    return text[:limit] if text else None


def _meaningful_detail(value: Any) -> str | None:
    text = _redacted_detail(value)
    if not text:
        return None
    compact = re.sub(r"\s+", "", text)
    if re.fullmatch(r"gAAAAA[A-Za-z0-9_-]{32,}", compact):
        return None
    if len(compact) >= 48 and re.fullmatch(r"[A-Za-z0-9+/=_-]+", compact):
        return None
    if re.fullmatch(r"(?:[A-Fa-f0-9]{24,}|[A-Fa-f0-9-]{32,})", compact):
        return None
    return text


TOPIC_LABELS = (
    (re.compile(r"\bci\b|github actions?", re.I), "CI 자동 검사"),
    (re.compile(r"tests?|verify|validation|quality", re.I), "테스트와 결과 검증"),
    (re.compile(r"build|compile", re.I), "빌드"),
    (re.compile(r"deploy|release|publish|hosting", re.I), "배포와 공개"),
    (re.compile(r"dashboard|\bui\b|frontend|screen|visual|display", re.I), "대시보드 화면"),
    (re.compile(r"agent|collaboration|handoff|meeting", re.I), "AI 직원 협업"),
    (re.compile(r"privacy|security|secret|credential", re.I), "개인정보 보호와 보안"),
    (re.compile(r"document|readme|docs?", re.I), "문서 정리"),
    (re.compile(r"research|investigat|analysis|audit", re.I), "조사와 분석"),
    (re.compile(r"code|implement|develop|fix|bug", re.I), "코드 구현과 문제 해결"),
    (re.compile(r"performance|benchmark", re.I), "성능 검증"),
    (re.compile(r"data|database|\bdb\b", re.I), "데이터 처리"),
)

ALLOWED_TERMS = {
    "api": "API",
    "ci": "CI",
    "github": "GitHub",
    "node": "Node",
    "npu": "NPU",
    "readme": "README",
}

ROLE_ASSIGNMENTS = {
    "explorer": ("코드 탐색 담당", "코드베이스 탐색"),
    "worker": ("구현 담당", "배정 기능 구현"),
    "office_builder": ("구현 엔지니어", "기능 구현"),
    "office_verifier": ("품질 검증 담당", "테스트와 수용 기준 검증"),
    "office_reviewer": ("코드 리뷰 담당", "회귀와 보안 검토"),
    "office_researcher": ("리서치 담당", "자료와 근거 조사"),
    "office_planner": ("기획 담당", "요구사항과 작업 분해"),
    "office_challenger": ("대안 검토 담당", "리스크와 대안 검토"),
}


def _topic_summary(value: str, kind: str) -> str | None:
    topics = []
    for pattern, label in TOPIC_LABELS:
        if pattern.search(value) and label not in topics:
            topics.append(label)
    if not topics:
        return "사용자 지시사항" if kind == "directive" else None
    subject = "·".join(topics[:3])
    if kind == "discussion":
        return f"{subject}에 관한 진행 상황을 공유했습니다."
    if kind == "assignment":
        return f"{subject} 업무"
    if kind == "handoff":
        return f"{subject}에 관한 담당 결과를 인계했습니다."
    return f"{subject}에 관한 지시사항"


def _korean_safe_detail(value: Any, kind: str) -> str | None:
    text = _meaningful_detail(value)
    if not text:
        return None
    if re.search(r"Referenced ChatGPT conversation|untrusted ChatGPT conversation reference", text, re.I):
        return "이전 대화에서 이어진 작업 지시"

    text = re.sub(r"<[^>]{0,500}>", " ", text)
    text = re.sub(r"```.*?```|`[^`]*`", " 기술 명령 ", text, flags=re.S)

    def replace_english(match: re.Match[str]) -> str:
        chunk = match.group(0).strip()
        allowed = ALLOWED_TERMS.get(chunk.lower())
        return allowed if allowed else (_topic_summary(chunk, kind) or "기술 내용")

    text = re.sub(
        r"[A-Za-z][A-Za-z0-9_./:=\\-]*(?:[ \t]+[A-Za-z][A-Za-z0-9_./:=\\-]*)*",
        replace_english,
        text,
    )
    text = " ".join(text.split()).strip(" -:;,")
    text = re.sub(r"(?:사용자 지시사항[\s,;:'\"#-]*){2,}", "사용자 지시사항", text)
    if not text or not re.search(r"[가-힣]", text):
        return _topic_summary(str(value), kind)
    return text[:280]


def _user_request(value: Any) -> str | None:
    text = _text(value, 4_000)
    if not text:
        return None
    text = re.sub(r"<in-app-browser-context\b[^>]*>.*?</in-app-browser-context>", " ", text, flags=re.I | re.S)
    request_marker = re.search(r"(?:^|\n)#{1,3}\s*My request:\s*", text, flags=re.I)
    if request_marker:
        text = text[request_marker.end():]
    return _korean_safe_detail(text, "directive")


def _detail_from(raw: dict[str, Any], event_name: str) -> tuple[str | None, str | None, str | None, str | None]:
    if event_name == "UserPromptSubmit":
        return _user_request(raw.get("prompt")), "directive", None, None
    if event_name == "SubagentStop":
        return _korean_safe_detail(raw.get("last_assistant_message"), "handoff"), "handoff", None, None
    if event_name != "PreToolUse":
        return None, None, None, None

    tool_name = re.sub(r"[^a-z]", "", str(raw.get("tool_name", "")).lower())
    tool_input = raw.get("tool_input")
    if not isinstance(tool_input, dict):
        return None, None, None, None
    if tool_name == "collaborationspawnagent":
        role_name, role_task = ROLE_ASSIGNMENTS.get(
            str(tool_input.get("agent_type", "")),
            ("업무 지원 담당", "지시사항 세부 작업"),
        )
        task = _korean_safe_detail(tool_input.get("message"), "assignment") or role_task
        return (
            task,
            "assignment",
            role_name,
            task,
        )
    if tool_name in {"collaborationsendmessage", "collaborationfollowuptask"}:
        return _korean_safe_detail(tool_input.get("message"), "discussion"), "discussion", None, None
    return None, None, None, None


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
    capture_details = _details_enabled(base_dir)
    detail, detail_kind, assignment_employee_name, assignment_task = (
        _detail_from(raw, event_name) if capture_details else (None, None, None, None)
    )

    # Detailed text is local opt-in and restricted to redacted user directives and
    # collaboration messages. Commands, arbitrary tool I/O, files, and raw IDs stay omitted.
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
        "detail": detail,
        "detailKind": detail_kind,
        "assignmentEmployeeName": assignment_employee_name,
        "assignmentTask": assignment_task,
        "detailCapture": capture_details,
    }
    return {key: value for key, value in event.items() if value is not None}


def main() -> int:
    try:
        raw = json.loads(sys.stdin.buffer.read().decode("utf-8"))
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
