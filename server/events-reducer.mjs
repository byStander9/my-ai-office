import { createHash } from "node:crypto";

const QUIET_AFTER_MS = 2_000;
const STALE_AFTER_MS = 5 * 60 * 1_000;
const EMPLOYEE_HANDOFF_MS = 15_000;
const EMPLOYEE_INACTIVE_MS = 30 * 60 * 1_000;
const ACTIVITY_GROUP_GAP_MS = 10 * 60 * 1_000;
const PROJECT_INACTIVE_MS = 24 * 60 * 60 * 1_000;
const DISCUSSION_MAX_AGE_MS = 30 * 60 * 1_000;
const ACTIVE_STATUSES = new Set(["working", "compacting", "stopping"]);
const RESTART_EVENT_TYPES = new Set(["session.started", "employee.started", "employee.spawned", "employee.work.started"]);
const CODEX_WORK_EVENT_TYPES = new Set([
  "employee.spawned", "employee.started", "employee.completed", "employee.work.started",
  "employee.work.completed", "employee.tool.started", "employee.tool.completed", "employee.approval.waiting",
]);
const DETAIL_KINDS = new Set(["directive", "discussion"]);

const ALLOWED_EVENT_TYPES = new Set([
  "session.started",
  "session.ended",
  "directive.submitted",
  "employee.spawned",
  "employee.started",
  "employee.completed",
  "employee.work.started",
  "employee.work.completed",
  "employee.tool.started",
  "employee.tool.completed",
  "employee.approval.waiting",
  "session.compacting",
  "session.working",
  "turn.stopping",
  "activity.observed",
]);

const SAFE_TOP_LEVEL_KEYS = new Set([
  "schemaVersion", "id", "at", "type", "status", "project", "sessionId",
  "turnId", "employeeId", "employeeRole", "tool", "toolUseId", "appendSeq",
  "detail", "detailKind", "detailCapture",
]);

function safeText(value, maxLength = 160) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function safeTimestamp(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function safeDetail(value) {
  const text = safeText(value, 280);
  if (!text) return null;
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/-----BEGIN[^-]*PRIVATE KEY-----.*?-----END[^-]*PRIVATE KEY-----/gis, "[private key]")
    .replace(/\b(?:sk|ghp|github_pat|glpat|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b/gi, "[secret]")
    .replace(/\bAKIA[A-Z0-9]{16}\b/g, "[secret]")
    .replace(/\bAuthorization\s*:\s*[^\r\n,;]+/gi, "Authorization: [secret]")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [secret]")
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^@\s/]+@/gi, "$1[credentials]@")
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "[email]")
    .replace(/\b[A-Za-z]:\\[^\r\n,;]+/g, "[path]")
    .replace(/(^|[^\w:])\/(?:[A-Za-z0-9._~-]+(?:\/[^\s,;]+)*)/g, "$1[path]")
    .replace(/\b(password|passwd|token|api[\s_-]*key|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[secret]");
}

function opaqueId(prefix, value) {
  const digest = createHash("sha256").update(`${prefix}:${value}`).digest("hex").slice(0, 12);
  return `${prefix}-${digest}`;
}

export function sanitizeEvent(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;

  const clean = {};
  for (const [key, value] of Object.entries(input)) {
    if (SAFE_TOP_LEVEL_KEYS.has(key)) clean[key] = value;
  }

  const projectKey = safeText(clean.project?.key, 120);
  const projectName = safeText(clean.project?.name, 160);
  const type = safeText(clean.type, 80);
  const at = safeTimestamp(clean.at);
  if (!projectKey || !projectName || !type || !at) return null;
  const detailKind = safeText(clean.detailKind, 40);
  const detailCapture = clean.detailCapture === true;

  return {
    schemaVersion: Number.isInteger(clean.schemaVersion) ? clean.schemaVersion : 1,
    id: safeText(clean.id, 160) ?? `${projectKey}:${at}`,
    at,
    type: ALLOWED_EVENT_TYPES.has(type) ? type : "activity.observed",
    status: safeText(clean.status, 80) ?? "observed",
    project: { key: projectKey, name: projectName },
    sessionId: safeText(clean.sessionId, 160),
    turnId: safeText(clean.turnId, 160),
    employeeId: safeText(clean.employeeId, 160),
    employeeRole: safeText(clean.employeeRole, 120),
    tool: safeText(clean.tool, 120),
    toolUseId: safeText(clean.toolUseId, 160),
    appendSeq: Number.isSafeInteger(clean.appendSeq) ? clean.appendSeq : null,
    detail: detailCapture && DETAIL_KINDS.has(detailKind) ? safeDetail(clean.detail) : null,
    detailKind: detailCapture && DETAIL_KINDS.has(detailKind) ? detailKind : null,
    detailCapture,
  };
}

const ROLE_ASSIGNMENTS = {
  explorer: ["코드 탐색 담당", "코드베이스 탐색"],
  worker: ["구현 담당", "배정 기능 구현"],
  office_builder: ["구현 엔지니어", "기능 구현"],
  office_verifier: ["품질 검증 담당", "테스트·수용 기준 검증"],
  office_reviewer: ["코드 리뷰 담당", "회귀·보안·유지보수 검토"],
  office_researcher: ["리서치 담당", "자료·근거 조사"],
  office_planner: ["기획 담당", "요구사항·작업 분해"],
  office_challenger: ["대안 검토 담당", "리스크·대안 검토"],
};

function toolAssignment(tool) {
  if (!tool) return null;
  if (/apply_patch|edit|write/i.test(tool)) return ["코드 수정 담당", "코드 변경"];
  if (/browser|playwright|computer|screenshot/i.test(tool)) return ["화면 검증 담당", "화면 동작 검증"];
  if (/web|search|open|fetch/i.test(tool)) return ["자료 조사 담당", "자료·근거 조사"];
  if (/bash|shell|exec|command|terminal/i.test(tool)) return ["실행·점검 담당", "명령 실행·상태 점검"];
  return null;
}

function activityForTool(tool) {
  if (/update_plan/i.test(tool ?? "")) return ["planning", "작업 계획 관리"];
  if (/document_control/i.test(tool ?? "")) return ["document_work", "문서 작업"];
  if (/workspace_dependencies/i.test(tool ?? "")) return ["environment_setup", "작업 환경 준비"];
  if (/node_repl|programmatic/i.test(tool ?? "")) return ["automation", "자동화 실행"];
  if (/apply_patch|edit|write/i.test(tool ?? "")) return ["code_change", "코드 변경"];
  if (/browser|playwright|computer|screenshot|view_image|imagegen/i.test(tool ?? "")) return ["visual_check", "화면 동작 검증"];
  if (/web|search|open|fetch|read/i.test(tool ?? "")) return ["research", "자료·근거 조사"];
  if (/collaboration|spawn|agent/i.test(tool ?? "")) return ["coordination", "AI 직원 협업 조율"];
  if (/test|verify|review|audit|lint/i.test(tool ?? "")) return ["validation", "품질 검증"];
  if (/bash|shell|exec|command|terminal/i.test(tool ?? "")) return ["workspace_check", "명령 실행·상태 점검"];
  return ["general", "도구 기반 작업"];
}

function employeeIdentity(event) {
  if (event.employeeId) {
    const id = opaqueId("emp", event.employeeId);
    const assignment = ROLE_ASSIGNMENTS[event.employeeRole] ?? toolAssignment(event.tool) ?? ["기능 실행 담당", "지정 기능 수행"];
    return {
      id,
      name: assignment[0],
      role: assignment[1],
      kind: "subagent",
      assignmentIsSpecific: Boolean(ROLE_ASSIGNMENTS[event.employeeRole] || toolAssignment(event.tool)),
    };
  }
  const id = opaqueId("emp", `main:${event.sessionId || event.project.key}`);
  return {
    id,
    name: `${event.project.name} 총괄`,
    role: "프로젝트 총괄",
    kind: "main",
    assignmentIsSpecific: true,
  };
}

function statusFor(event, nowMs) {
  if (event.type === "turn.stopping") {
    return nowMs - Date.parse(event.at) >= QUIET_AFTER_MS ? "idle" : "stopping";
  }
  if (event.type === "session.ended") return "offline";
  if (event.type === "employee.approval.waiting") return "waiting_approval";
  if (event.type === "session.compacting") return "compacting";
  if (["employee.completed", "employee.work.completed"].includes(event.type) && event.status === "completed") return "idle";
  if (["directive.submitted", "employee.spawned", "employee.started", "employee.work.started", "employee.tool.started", "employee.tool.completed", "session.working"].includes(event.type)) return "working";
  if (event.type === "session.started") return "online";
  return event.status;
}

function activityMessage(event, employee) {
  switch (event.type) {
    case "session.started": return `${employee.name}이(가) 업무 공간에 접속했습니다.`;
    case "session.ended": return `${employee.name}의 세션이 종료되었습니다.`;
    case "directive.submitted": return `${employee.name}이(가) 새 지시를 처리하고 있습니다.`;
    case "employee.spawned":
    case "employee.started": return `${employee.name}이(가) 프로젝트에 합류했습니다.`;
    case "employee.work.started": return `${employee.name}이(가) 배정 업무를 시작했습니다.`;
    case "employee.completed": return `${employee.name}이(가) 담당 작업을 인계했습니다.`;
    case "employee.work.completed":
    case "employee.tool.completed": return event.status === "completed"
      ? `${employee.name}이(가) 담당 작업을 인계했습니다.`
      : `${employee.name}이(가) 작업 단계를 마쳤습니다.`;
    case "employee.approval.waiting": return `${employee.name}이(가) CEO 승인을 기다리고 있습니다.`;
    case "session.compacting": return `${employee.name}이(가) 작업 맥락을 정리하고 있습니다.`;
    case "session.working": return `${employee.name}이(가) 정리된 맥락으로 업무를 재개했습니다.`;
    case "turn.stopping": return `${employee.name}이(가) 현재 작업을 정리하고 있습니다.`;
    default: return `${employee.name}의 상태가 갱신되었습니다.`;
  }
}

function updateActivitySummary(recent, activityGroups, event, employee, projectId) {
  const [activityCategory, activityLabel] = activityForTool(event.tool);
  const key = `${projectId}:${employee.id}:${activityCategory}`;
  let summary = activityGroups.get(key);
  if (!summary || Date.parse(event.at) - Date.parse(summary.at) >= ACTIVITY_GROUP_GAP_MS) {
    summary = {
      id: opaqueId("evt", event.id),
      at: event.at,
      startedAt: event.at,
      type: "activity.summary",
      status: "working",
      projectId,
      employeeId: employee.id,
      employeeName: employee.name,
      activityCategory,
      activityLabel,
      stepCount: 0,
      message: "",
      _order: event.appendSeq ?? Date.parse(event.at),
      _toolUseIds: new Set(),
    };
    activityGroups.set(key, summary);
    recent.push(summary);
  }

  if (event.toolUseId) {
    if (!summary._toolUseIds.has(event.toolUseId)) {
      summary._toolUseIds.add(event.toolUseId);
      summary.stepCount += 1;
    }
  } else if (event.type === "employee.tool.started" || summary.stepCount === 0) {
    summary.stepCount += 1;
  }
  summary.at = event.at;
  summary.employeeName = employee.name;
  summary._order = event.appendSeq ?? Date.parse(event.at);
  summary.message = `${employee.name}이(가) ${activityLabel} 업무를 진행했습니다.`;
  if (event.detail) {
    summary.detail = event.detail;
    summary.detailKind = event.detailKind;
  }
}

function closeActivitySummaries(activityGroups, projectId, employeeId) {
  const prefix = `${projectId}:${employeeId}:`;
  for (const key of activityGroups.keys()) {
    if (key.startsWith(prefix)) activityGroups.delete(key);
  }
}

function projectEnded(employees, nowMs) {
  const mainEmployees = employees.filter((employee) => employee.kind === "main" && (employee.terminalAt || nowMs - Date.parse(employee.lastActivityAt) < EMPLOYEE_INACTIVE_MS));
  return mainEmployees.length > 0 && mainEmployees.every((employee) => employee.status === "offline");
}

function projectStatus(employees, ended) {
  if (ended) return "종료";
  const statuses = new Set(employees.map((employee) => employee.status));
  if (statuses.has("waiting_approval")) return "승인 대기";
  if (["working", "compacting", "stopping", "meeting"].some((status) => statuses.has(status))) return "작업 중";
  if (statuses.has("online") || statuses.has("idle")) return "대기";
  return "오프라인";
}

function isVisibleEmployee(employee, nowMs) {
  if (employee.terminalAt) return nowMs - Date.parse(employee.terminalAt) < EMPLOYEE_HANDOFF_MS;
  return nowMs - Date.parse(employee.lastActivityAt) < EMPLOYEE_INACTIVE_MS;
}

function isTerminalEvent(event) {
  return event.type === "session.ended"
    || (["employee.completed", "employee.work.completed"].includes(event.type) && event.status === "completed");
}

export function reduceEvents(rawEvents, { now = new Date() } = {}) {
  const nowMs = now.getTime();
  const events = rawEvents.map(sanitizeEvent).filter(Boolean).sort((a, b) => {
    const sequenceDifference = (a.appendSeq ?? 0) - (b.appendSeq ?? 0);
    return sequenceDifference || Date.parse(a.at) - Date.parse(b.at);
  });
  const projects = new Map();
  const recent = [];
  const activityGroups = new Map();

  for (const event of events) {
    let project = projects.get(event.project.key);
    if (!project) {
      project = { key: event.project.key, name: event.project.name, lastActivityAt: event.at, lastWorkAt: null, employees: new Map(), hasCodexWork: false, discussions: [] };
      projects.set(project.key, project);
    }
    project.name = event.project.name;
    project.lastActivityAt = event.at;
    if (CODEX_WORK_EVENT_TYPES.has(event.type)) {
      project.hasCodexWork = true;
      project.lastWorkAt = event.at;
    }

    const identity = employeeIdentity(event);
    const existingEmployee = project.employees.get(identity.id);
    const employee = existingEmployee ?? { ...identity, status: "online", lastActivityAt: event.at, tool: null, terminalAt: null };
    if (!existingEmployee || identity.assignmentIsSpecific || employee.name === "기능 실행 담당") {
      employee.name = identity.name;
      employee.role = identity.role;
    }
    employee.kind = identity.kind;
    const nextStatus = statusFor(event, nowMs);
    const isRestart = RESTART_EVENT_TYPES.has(event.type);
    if (isRestart) employee.terminalAt = null;
    employee.status = employee.terminalAt && !isRestart ? employee.status : nextStatus;
    if (isTerminalEvent(event)) {
      employee.terminalAt = event.at;
      employee.status = nextStatus;
    }
    employee.lastActivityAt = event.at;
    employee.tool = event.tool;
    project.employees.set(identity.id, employee);

    if (event.detailKind === "discussion" && event.detail && event.employeeId) {
      project.discussions.push({
        id: opaqueId("discussion", event.id),
        at: event.at,
        employeeId: identity.id,
        employeeName: identity.name,
        message: event.detail,
      });
    }

    const isToolActivity = ["employee.tool.started", "employee.tool.completed"].includes(event.type) && event.status !== "completed";
    if (isToolActivity) {
      updateActivitySummary(recent, activityGroups, event, identity, project.key);
    } else {
      closeActivitySummaries(activityGroups, project.key, identity.id);
      if (event.type !== "activity.observed") {
        recent.push({
          id: opaqueId("evt", event.id),
          at: event.at,
          type: event.type,
          status: statusFor(event, nowMs),
          projectId: project.key,
          employeeId: identity.id,
          employeeName: identity.name,
          message: activityMessage(event, identity),
          detail: event.detail,
          detailKind: event.detailKind,
          _order: event.appendSeq ?? Date.parse(event.at),
        });
      }
    }
  }

  const visibleProjects = [...projects.values()].filter((project) => (
    project.hasCodexWork && nowMs - Date.parse(project.lastWorkAt) < PROJECT_INACTIVE_MS
  ));
  const lastEventAt = visibleProjects.length
    ? visibleProjects.reduce((latest, project) => Date.parse(project.lastActivityAt) > Date.parse(latest) ? project.lastActivityAt : latest, visibleProjects[0].lastActivityAt)
    : null;
  const freshness = !events.length ? "demo" : !lastEventAt ? "stale" : nowMs - Date.parse(lastEventAt) > STALE_AFTER_MS ? "stale" : "fresh";

  const projectSnapshots = visibleProjects.map((project) => {
    const allEmployees = [...project.employees.values()];
    const ended = projectEnded(allEmployees, nowMs);
    let employees = allEmployees.filter((employee) => isVisibleEmployee(employee, nowMs)).sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt));
    if (employees.filter((employee) => ACTIVE_STATUSES.has(employee.status)).length >= 2) {
      employees = employees.map((employee) => ACTIVE_STATUSES.has(employee.status) ? { ...employee, status: "meeting" } : employee);
    }
    const projectFreshness = nowMs - Date.parse(project.lastActivityAt) > STALE_AFTER_MS ? "stale" : "fresh";
    employees = employees.map(({ assignmentIsSpecific, terminalAt, ...employee }) => ({ ...employee, freshness: projectFreshness }));
    const collaboratingSubagents = employees.filter((employee) => employee.kind === "subagent" && employee.status === "meeting");
    const discussions = collaboratingSubagents.length >= 2
      ? project.discussions.filter((discussion) => nowMs - Date.parse(discussion.at) <= DISCUSSION_MAX_AGE_MS).slice(-5).reverse()
      : [];
    return { key: project.key, name: project.name, status: projectStatus(employees, ended), ended, freshness: projectFreshness, lastActivityAt: project.lastActivityAt, employees, discussions };
  }).sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt));

  const visibleProjectKeys = new Set(projectSnapshots.map((project) => project.key));
  const detailCaptureEnabled = events.some((event) => event.detailCapture && nowMs - Date.parse(event.at) <= STALE_AFTER_MS);

  return {
    mode: events.length ? "live" : "demo",
    freshness,
    lastEventAt,
    generatedAt: now.toISOString(),
    quietAfterMs: QUIET_AFTER_MS,
    detailCaptureEnabled,
    projects: projectSnapshots,
    events: recent.filter((event) => visibleProjectKeys.has(event.projectId)).sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b._order - a._order).slice(0, 80).map(({ _order, _toolUseIds, ...event }) => event),
  };
}

export { ACTIVITY_GROUP_GAP_MS, EMPLOYEE_HANDOFF_MS, EMPLOYEE_INACTIVE_MS, PROJECT_INACTIVE_MS, QUIET_AFTER_MS, STALE_AFTER_MS };
