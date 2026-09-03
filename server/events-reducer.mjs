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
const DETAIL_KINDS = new Set(["directive", "assignment", "discussion", "handoff"]);

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
  "detail", "detailKind", "detailCapture", "assignmentEmployeeName", "assignmentTask",
  "assignmentName", "assignmentRole",
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

function isOpaqueDetail(value) {
  const compact = value.replace(/\s+/g, "");
  return /^gAAAAA[A-Za-z0-9_-]{32,}$/.test(compact)
    || (compact.length >= 48 && /^[A-Za-z0-9+/=_-]+$/.test(compact))
    || /^(?:[A-Fa-f0-9]{24,}|[A-Fa-f0-9-]{32,})$/.test(compact);
}

const TOPIC_LABELS = [
  [/\bci\b|github actions?/i, "CI 자동 검사"],
  [/tests?|verify|validation|quality/i, "테스트와 결과 검증"],
  [/build|compile/i, "빌드"],
  [/deploy|release|publish|hosting/i, "배포와 공개"],
  [/dashboard|\bui\b|frontend|screen|visual/i, "대시보드 화면"],
  [/agent|collaboration|handoff|meeting/i, "AI 직원 협업"],
  [/privacy|security|secret|credential/i, "개인정보 보호와 보안"],
  [/document|readme|docs?/i, "문서 정리"],
  [/research|investigat|analysis|audit/i, "조사와 분석"],
  [/code|implement|develop|fix|bug/i, "코드 구현과 문제 해결"],
  [/performance|benchmark/i, "성능 검증"],
  [/data|database|\bdb\b/i, "데이터 처리"],
];

function topicSummary(value, kind) {
  const topics = TOPIC_LABELS.filter(([pattern]) => pattern.test(value)).map(([, label]) => label);
  const uniqueTopics = [...new Set(topics)].slice(0, 3);
  if (uniqueTopics.length) {
    const subject = uniqueTopics.join("·");
    if (kind === "discussion") return `${subject}에 관한 협업 내용을 공유했습니다.`;
    if (kind === "assignment") return `${subject} 업무`;
    if (kind === "handoff") return `${subject}에 관한 담당 결과를 인계했습니다.`;
    return `${subject}에 관한 지시사항`;
  }
  return kind === "directive" ? "사용자 지시사항" : null;
}

function koreanDetail(value, kind) {
  let text = safeDetail(value);
  if (!text) return null;
  text = text
    .replace(/<in-app-browser-context\b[^>]*>.*?<\/in-app-browser-context>/gis, " ")
    .replace(/<[^>]{0,500}>/g, " ")
    .replace(/\[private key\]/gi, "[개인 키]")
    .replace(/\[secret\]/gi, "[비밀정보]")
    .replace(/\[credentials\]/gi, "[인증정보]")
    .replace(/\[email\]/gi, "[이메일]")
    .replace(/\[path\]/gi, "[경로]")
    .replace(/\bAuthorization\s*:\s*\[비밀정보\]/gi, "인증정보: [비밀정보]")
    .replace(/\bBearer\s+\[비밀정보\]/gi, "접근 토큰 [비밀정보]")
    .replace(/\b(password|passwd|token|api[\s_-]*key|secret)\s*=\s*\[비밀정보\]/gi, "민감정보=[비밀정보]")
    .replace(/\s+/g, " ")
    .trim();
  const requestMarker = text.match(/#{1,3}\s*My request:\s*/i);
  if (requestMarker) text = text.slice((requestMarker.index ?? 0) + requestMarker[0].length).trim();
  if (/Referenced ChatGPT conversation|untrusted ChatGPT conversation reference/i.test(text)) {
    return "이전 대화에서 이어진 작업 지시";
  }
  if (!text || isOpaqueDetail(text)) return null;
  text = text.replace(/```.*?```|`[^`]*`/gis, " 기술 명령 ");
  text = text.replace(/[A-Za-z][A-Za-z0-9_./:=\\-]*(?:[ \t]+[A-Za-z][A-Za-z0-9_./:=\\-]*)*/g, (chunk) => {
    const allowed = { api: "API", ci: "CI", github: "GitHub", node: "Node", npu: "NPU", readme: "README" }[chunk.trim().toLowerCase()];
    return allowed ?? topicSummary(chunk, kind) ?? "기술 내용";
  });
  text = text.replace(/\s+/g, " ").replace(/^[-:;,\s]+|[-:;,\s]+$/g, "").trim();
  text = text.replace(/(?:사용자 지시사항[\s,;:'"#-]*){2,}/g, "사용자 지시사항");
  return /[가-힣]/.test(text) ? text.slice(0, 280) : topicSummary(String(value ?? ""), kind);
}

function koreanLabel(value, fallback) {
  const text = safeText(value, 120);
  if (!text || !/[가-힣]/.test(text) || /[A-Za-z]{3,}/.test(text)) return fallback;
  return text;
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
  const tool = safeText(clean.tool, 120);
  const originalDetailKind = safeText(clean.detailKind, 40);
  const detailKind = /collaboration.*spawn.*agent/i.test(tool ?? "") && originalDetailKind === "discussion"
    ? "assignment"
    : originalDetailKind;
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
    tool,
    toolUseId: safeText(clean.toolUseId, 160),
    appendSeq: Number.isSafeInteger(clean.appendSeq) ? clean.appendSeq : null,
    detail: detailCapture && DETAIL_KINDS.has(detailKind) ? koreanDetail(clean.detail, detailKind) : null,
    detailKind: detailCapture && DETAIL_KINDS.has(detailKind) ? detailKind : null,
    assignmentEmployeeName: detailCapture && detailKind === "assignment"
      ? koreanLabel(clean.assignmentEmployeeName, null)
      : null,
    assignmentTask: detailCapture && detailKind === "assignment"
      ? koreanDetail(clean.assignmentTask, "assignment")
      : null,
    assignmentName: detailCapture && detailKind === "assignment" ? safeText(clean.assignmentName, 120) : null,
    assignmentRole: detailCapture && detailKind === "assignment" ? safeText(clean.assignmentRole, 120) : null,
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

const TASK_NAME_WORDS = {
  activity: "업무 활동", agent: "AI 직원", api: "API", backend: "서버", build: "빌드",
  builder: "구현", ci: "CI", code: "코드", collaboration: "협업", data: "데이터",
  deploy: "배포", deployment: "배포", detail: "상세 설명", display: "표시", docs: "문서",
  documentation: "문서", frontend: "화면", github: "GitHub", instruction: "지시사항",
  investigator: "조사", korean: "한국어", local: "로컬", log: "로그", planner: "계획",
  privacy: "개인정보 보호", project: "프로젝트", research: "자료 조사", reviewer: "검토",
  security: "보안", step: "단계", test: "테스트", ui: "화면", verifier: "검증", visual: "화면",
};

function assignmentIdentity(role) {
  return ROLE_ASSIGNMENTS[role] ?? ["업무 지원 담당", "배정된 세부 업무"];
}

function assignmentIdentityForEvent(event) {
  const explicit = assignmentIdentity(event.assignmentRole);
  if (event.assignmentEmployeeName || event.assignmentRole in ROLE_ASSIGNMENTS) {
    return [event.assignmentEmployeeName ?? explicit[0], explicit[1]];
  }
  const detail = `${event.assignmentTask ?? ""} ${event.detail ?? ""}`;
  if (/검증|테스트|품질/.test(detail)) return ["품질 검증 담당", "테스트·수용 기준 검증"];
  if (/화면|대시보드|표시/.test(detail)) return ["화면 검증 담당", "화면 동작 검증"];
  if (/보안|개인정보/.test(detail)) return ["보안 검토 담당", "개인정보 보호·보안 검토"];
  if (/문서/.test(detail)) return ["문서 정리 담당", "문서 작성·정리"];
  if (/조사|분석|자료/.test(detail)) return ["리서치 담당", "자료·근거 조사"];
  if (/코드|구현|문제 해결/.test(detail)) return ["구현 담당", "요청 기능 구현"];
  return ["지시 실행 담당", "CEO 지시사항 세부 작업"];
}

function assignmentTitle(event, currentDirective = null) {
  if (event.assignmentTask) return event.assignmentTask.slice(0, 120);
  const objective = event.detail?.match(/(?:^|\s)(?:목표|Objective)\s*:\s*([^\n.]+)/i)?.[1]?.trim();
  if (objective && /[가-힣]/.test(objective)) return objective.slice(0, 100);
  const translatedWords = (event.assignmentName ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((word) => TASK_NAME_WORDS[word])
    .filter(Boolean);
  const uniqueWords = [...new Set(translatedWords)];
  if (uniqueWords.length) return `${uniqueWords.join("·")} 업무`;
  if (event.detail && /[가-힣]/.test(event.detail) && !/세부 내용을 한국어로 확인할 수 없습니다|배정된 세부 업무/.test(event.detail)) {
    return event.detail.slice(0, 100);
  }
  const role = assignmentIdentityForEvent(event)[1];
  return currentDirective?.title ? `'${currentDirective.title}' 지시 중 ${role}` : role;
}

function assignmentName(event) {
  return assignmentIdentityForEvent(event)[0];
}

function directiveTitle(detail) {
  if (!detail) return "현재 지시사항";
  const cleaned = detail.replace(/^[#>*\s-]+/, "").replace(/\s+/g, " ").trim();
  const firstSentence = cleaned.split(/(?<=[.!?。])\s+|\n/)[0] || cleaned;
  return firstSentence.length > 64 ? `${firstSentence.slice(0, 63)}…` : firstSentence;
}

function projectDisplayName(name) {
  const knownNames = {
    memories: "메모리",
    "ai-office-dashboard": "AI 오피스 대시보드",
    "new-chat": "새 작업",
  };
  return knownNames[name.toLowerCase()] ?? name;
}

const WORK_STAGES = {
  planning: "1단계 · 지시 분석과 작업 계획",
  research: "2단계 · 자료와 현황 조사",
  workspace_check: "2단계 · 실행 환경과 현재 상태 확인",
  environment_setup: "2단계 · 작업 환경 준비",
  code_change: "3단계 · 요청 사항 구현",
  document_work: "3단계 · 문서 작성과 정리",
  automation: "3단계 · 자동화 작업 실행",
  coordination: "협업 단계 · 담당자 간 업무 조율",
  visual_check: "4단계 · 화면과 동작 검증",
  validation: "4단계 · 결과와 회귀 검증",
  general: "3단계 · 세부 작업 수행",
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
  if (/browser|playwright|computer|screenshot|view_image|imagegen|cua/i.test(tool ?? "")) return ["visual_check", "화면 동작 검증"];
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

function activityMessage(event, employee, instructionTitle = "현재 지시사항") {
  switch (event.type) {
    case "session.started": return `${employee.name}이(가) 업무 공간에 접속했습니다.`;
    case "session.ended": return `${employee.name}의 세션이 종료되었습니다.`;
    case "directive.submitted": return `CEO가 '${instructionTitle}' 지시를 전달했습니다.`;
    case "employee.tool.started": return event.detailKind === "assignment"
      ? `${assignmentName(event)}에게 '${assignmentTitle(event, { title: instructionTitle })}'를 배정했습니다.`
      : `${employee.name}이(가) '${instructionTitle}' 지시에 따른 세부 작업을 진행하고 있습니다.`;
    case "employee.spawned":
    case "employee.started": return `${employee.name}이(가) '${instructionTitle}' 지시의 담당 업무에 합류했습니다.`;
    case "employee.work.started": return `${employee.name}이(가) '${instructionTitle}' 지시에 따른 배정 업무를 시작했습니다.`;
    case "employee.completed": return `${employee.name}이(가) '${instructionTitle}' 지시의 담당 결과를 정리하여 인계했습니다.`;
    case "employee.work.completed":
    case "employee.tool.completed": return event.status === "completed"
      ? `${employee.name}이(가) '${instructionTitle}' 지시의 담당 작업을 인계했습니다.`
      : `${employee.name}이(가) '${instructionTitle}' 지시의 현재 단계를 마쳤습니다.`;
    case "employee.approval.waiting": return `${employee.name}이(가) '${instructionTitle}' 지시에 대한 CEO 승인을 기다리고 있습니다.`;
    case "session.compacting": return `${employee.name}이(가) 작업 맥락을 정리하고 있습니다.`;
    case "session.working": return `${employee.name}이(가) 정리된 맥락으로 업무를 재개했습니다.`;
    case "turn.stopping": return `${employee.name}이(가) 현재 작업을 정리하고 있습니다.`;
    default: return `${employee.name}의 상태가 갱신되었습니다.`;
  }
}

function updateActivitySummary(recent, activityGroups, event, employee, projectId, currentDirective) {
  const [activityCategory, activityLabel] = activityForTool(event.tool);
  const key = `${projectId}:${currentDirective.id}:${employee.id}:${activityCategory}`;
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
      directiveId: currentDirective.id,
      instructionTitle: currentDirective.title,
      workStage: WORK_STAGES[activityCategory],
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
  summary.instructionTitle = currentDirective.title;
  summary.workStage = WORK_STAGES[activityCategory];
  summary._order = event.appendSeq ?? Date.parse(event.at);
  summary.message = `${employee.name}이(가) '${currentDirective.title}' 지시에 따라 '${WORK_STAGES[activityCategory]}'에서 '${activityLabel}'을 진행하고 있습니다.`;
  if (event.detail) {
    summary.detail = event.detail;
    summary.detailKind = event.detailKind;
  }
}

function closeProjectActivitySummaries(activityGroups, projectId) {
  const prefix = `${projectId}:`;
  for (const key of activityGroups.keys()) {
    if (key.startsWith(prefix)) activityGroups.delete(key);
  }
}

function closeActivitySummaries(activityGroups, projectId, employeeId) {
  for (const [key, summary] of activityGroups.entries()) {
    if (summary.projectId === projectId && summary.employeeId === employeeId) activityGroups.delete(key);
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
      project = {
        key: event.project.key,
        name: projectDisplayName(event.project.name),
        lastActivityAt: event.at,
        lastWorkAt: null,
        employees: new Map(),
        hasCodexWork: false,
        currentDirective: null,
        assignments: [],
        discussions: [],
      };
      projects.set(project.key, project);
    }
    project.name = projectDisplayName(event.project.name);
    project.lastActivityAt = event.at;
    if (CODEX_WORK_EVENT_TYPES.has(event.type)) {
      project.hasCodexWork = true;
      project.lastWorkAt = event.at;
    }
    if (event.detailKind === "directive") {
      closeProjectActivitySummaries(activityGroups, project.key);
      project.currentDirective = {
        id: opaqueId("directive", event.id),
        at: event.at,
        title: directiveTitle(event.detail),
        summary: event.detail ?? "현재 지시사항의 세부 내용을 한국어로 확인할 수 없습니다.",
      };
    }
    if (!project.currentDirective) {
      project.currentDirective = {
        id: opaqueId("directive", `${project.key}:기본 지시`),
        at: event.at,
        title: "현재 지시사항",
        summary: "현재 지시사항에 따라 작업하고 있습니다.",
      };
    }
    const currentDirective = project.currentDirective;
    if (event.detailKind === "assignment") {
      const assignment = assignmentIdentityForEvent(event);
      project.assignments.push({
        id: opaqueId("assignment", event.id),
        at: event.at,
        employeeName: assignment[0],
        employeeRole: assignment[1],
        task: assignmentTitle(event, currentDirective),
        directiveId: currentDirective.id,
        instructionTitle: currentDirective.title,
      });
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

    if (event.detailKind === "discussion" && event.employeeId) {
      project.discussions.push({
        id: opaqueId("discussion", event.id),
        at: event.at,
        employeeId: identity.id,
        employeeName: identity.name,
        message: event.detail ?? `'${currentDirective.title}' 지시와 관련해 ${identity.role} 진행 상황을 담당자들과 공유했습니다.`,
        directiveId: currentDirective.id,
        instructionTitle: currentDirective.title,
        workStage: "협업 단계 · 담당자 간 업무 조율",
      });
    }

    const isToolActivity = ["employee.tool.started", "employee.tool.completed"].includes(event.type)
      && event.status !== "completed"
      && event.detailKind !== "assignment";
    if (isToolActivity) {
      updateActivitySummary(recent, activityGroups, event, identity, project.key, currentDirective);
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
          message: activityMessage(event, identity, currentDirective.title),
          detail: event.detail,
          detailKind: event.detailKind,
          directiveId: currentDirective.id,
          instructionTitle: currentDirective.title,
          workStage: event.detailKind === "assignment"
            ? "직원 배정 단계"
            : event.detailKind === "handoff" ? "5단계 · 결과 정리와 인계" : null,
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
    employees = employees.map(({ assignmentIsSpecific, terminalAt, tool, ...employee }) => ({ ...employee, freshness: projectFreshness }));
    const collaboratingSubagents = employees.filter((employee) => employee.kind === "subagent" && employee.status === "meeting");
    const discussions = collaboratingSubagents.length >= 2
      ? project.discussions.filter((discussion) => (
        discussion.directiveId === project.currentDirective?.id
        && nowMs - Date.parse(discussion.at) <= DISCUSSION_MAX_AGE_MS
      )).slice(-5).reverse()
      : [];
    const seenAssignments = new Set();
    const assignments = [...project.assignments]
      .filter((assignment) => assignment.directiveId === project.currentDirective?.id)
      .reverse()
      .filter((assignment) => {
        const key = `${assignment.employeeName}:${assignment.task}`;
        if (seenAssignments.has(key)) return false;
        seenAssignments.add(key);
        return true;
      })
      .slice(0, 4);
    return {
      key: project.key,
      name: project.name,
      status: projectStatus(employees, ended),
      ended,
      freshness: projectFreshness,
      lastActivityAt: project.lastActivityAt,
      currentDirective: project.currentDirective,
      assignments,
      employees,
      discussions,
    };
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
