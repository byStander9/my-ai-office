import { createHash } from "node:crypto";

const QUIET_AFTER_MS = 2_000;
const STALE_AFTER_MS = 5 * 60 * 1_000;
const ACTIVE_STATUSES = new Set(["working", "compacting", "stopping"]);

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
  };
}

function employeeIdentity(event) {
  if (event.employeeId) {
    const id = opaqueId("emp", event.employeeId);
    return {
      id,
      name: event.employeeRole || `AI 직원 ${id.slice(-4)}`,
      role: event.employeeRole || "기능 담당",
      kind: "subagent",
    };
  }
  const id = opaqueId("emp", `main:${event.sessionId || event.project.key}`);
  return {
    id,
    name: `메인 직원 ${id.slice(-4)}`,
    role: "총괄 실행 담당",
    kind: "main",
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
  const toolLabel = event.tool ? ` · ${event.tool}` : "";
  switch (event.type) {
    case "session.started": return `${employee.name}이(가) 업무 공간에 접속했습니다.`;
    case "session.ended": return `${employee.name}의 세션이 종료되었습니다.`;
    case "directive.submitted": return `${employee.name}이(가) 새 지시를 처리하고 있습니다.`;
    case "employee.spawned":
    case "employee.started": return `${employee.name}이(가) 프로젝트에 합류했습니다.`;
    case "employee.work.started":
    case "employee.tool.started": return `${employee.name}이(가) 작업을 시작했습니다${toolLabel}.`;
    case "employee.completed": return `${employee.name}이(가) 담당 작업을 인계했습니다.`;
    case "employee.work.completed":
    case "employee.tool.completed": return event.status === "completed"
      ? `${employee.name}이(가) 담당 작업을 인계했습니다.`
      : `${employee.name}이(가) 작업 단계를 마쳤습니다${toolLabel}.`;
    case "employee.approval.waiting": return `${employee.name}이(가) CEO 승인을 기다리고 있습니다.`;
    case "session.compacting": return `${employee.name}이(가) 작업 맥락을 정리하고 있습니다.`;
    case "session.working": return `${employee.name}이(가) 정리된 맥락으로 업무를 재개했습니다.`;
    case "turn.stopping": return `${employee.name}이(가) 현재 작업을 정리하고 있습니다.`;
    default: return `${employee.name}의 상태가 갱신되었습니다.`;
  }
}

function projectEnded(employees) {
  const mainEmployees = employees.filter((employee) => employee.kind === "main");
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

export function reduceEvents(rawEvents, { now = new Date() } = {}) {
  const nowMs = now.getTime();
  const events = rawEvents.map(sanitizeEvent).filter(Boolean).sort((a, b) => {
    const sequenceDifference = (a.appendSeq ?? 0) - (b.appendSeq ?? 0);
    return sequenceDifference || Date.parse(a.at) - Date.parse(b.at);
  });
  const projects = new Map();
  const recent = [];
  const lastEventAt = events.length ? events[events.length - 1].at : null;
  const freshness = !lastEventAt ? "demo" : nowMs - Date.parse(lastEventAt) > STALE_AFTER_MS ? "stale" : "fresh";

  for (const event of events) {
    let project = projects.get(event.project.key);
    if (!project) {
      project = { key: event.project.key, name: event.project.name, lastActivityAt: event.at, employees: new Map() };
      projects.set(project.key, project);
    }
    project.name = event.project.name;
    project.lastActivityAt = event.at;

    const identity = employeeIdentity(event);
    const employee = project.employees.get(identity.id) ?? { ...identity, status: "online", lastActivityAt: event.at, tool: null };
    employee.name = identity.name;
    employee.role = identity.role;
    employee.kind = identity.kind;
    employee.status = statusFor(event, nowMs);
    employee.lastActivityAt = event.at;
    employee.tool = event.tool;
    project.employees.set(identity.id, employee);

    recent.push({
      id: opaqueId("evt", event.id),
      at: event.at,
      type: event.type,
      status: statusFor(event, nowMs),
      projectId: project.key,
      employeeId: identity.id,
      employeeName: identity.name,
      tool: event.tool,
      message: activityMessage(event, identity),
    });
  }

  const projectSnapshots = [...projects.values()].map((project) => {
    let employees = [...project.employees.values()].sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt));
    if (employees.filter((employee) => ACTIVE_STATUSES.has(employee.status)).length >= 2) {
      employees = employees.map((employee) => ACTIVE_STATUSES.has(employee.status) ? { ...employee, status: "meeting" } : employee);
    }
    employees = employees.map((employee) => ({ ...employee, freshness }));
    const ended = projectEnded(employees);
    return { key: project.key, name: project.name, status: projectStatus(employees, ended), ended, freshness, lastActivityAt: project.lastActivityAt, employees };
  }).sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt));

  return {
    mode: events.length ? "live" : "demo",
    freshness,
    lastEventAt,
    generatedAt: now.toISOString(),
    quietAfterMs: QUIET_AFTER_MS,
    projects: projectSnapshots,
    events: recent.reverse().slice(0, 80),
  };
}

export { QUIET_AFTER_MS, STALE_AFTER_MS };
