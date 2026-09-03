import assert from "node:assert/strict";
import test from "node:test";
import { ACTIVITY_GROUP_GAP_MS, EMPLOYEE_HANDOFF_MS, EMPLOYEE_INACTIVE_MS, PROJECT_INACTIVE_MS, reduceEvents, sanitizeEvent } from "../server/events-reducer.mjs";

function event(overrides = {}) {
  return {
    schemaVersion: 1,
    id: "event-1",
    at: "2026-08-26T06:00:00.000Z",
    type: "employee.tool.started",
    status: "working",
    project: { key: "project-a", name: "Project A", cwd: "C:\\secret\\workspace" },
    sessionId: "session-main",
    appendSeq: 1,
    rawEvent: "Stop",
    prompt: "do not expose this prompt",
    toolInput: "do not expose this input",
    toolOutput: "do not expose this output",
    ...overrides,
  };
}

test("sanitizes input to the supported event schema", () => {
  const clean = sanitizeEvent(event());
  assert.deepEqual(clean.project, { key: "project-a", name: "Project A" });
  assert.equal("rawEvent" in clean, false);
  assert.equal("prompt" in clean, false);
  assert.equal("toolInput" in clean, false);
  assert.equal("toolOutput" in clean, false);
  const untrustedDetail = sanitizeEvent(event({ detailKind: "discussion", detail: "should not pass without opt-in" }));
  assert.equal(untrustedDetail.detail, null);
  assert.equal(untrustedDetail.detailKind, null);
});

test("keeps turn.stopping visible until two quiet seconds have elapsed", () => {
  const events = [
    event({ id: "work", appendSeq: 1 }),
    event({ id: "stop", type: "turn.stopping", status: "stopping", appendSeq: 2 }),
  ];
  const beforeQuiet = reduceEvents(events, { now: new Date("2026-08-26T06:00:01.999Z") });
  const afterQuiet = reduceEvents(events, { now: new Date("2026-08-26T06:00:02.000Z") });
  assert.equal(beforeQuiet.projects[0].employees[0].status, "stopping");
  assert.equal(afterQuiet.projects[0].employees[0].status, "idle");
});

test("uses employeeId for subagents and represents the main session as an employee", () => {
  const snapshot = reduceEvents([
    event({ id: "main", type: "directive.submitted", status: "working", appendSeq: 1 }),
    event({ id: "sub", type: "employee.started", status: "working", employeeId: "agent-42", employeeRole: "office_builder", appendSeq: 2 }),
  ], { now: new Date("2026-08-26T06:00:03.000Z") });
  const employees = snapshot.projects[0].employees;
  assert.ok(employees.some((employee) => /^emp-[a-f0-9]{12}$/.test(employee.id) && employee.kind === "subagent"));
  assert.ok(employees.some((employee) => /^emp-[a-f0-9]{12}$/.test(employee.id) && employee.kind === "main"));
  assert.equal(new Set(employees.map((employee) => employee.id)).size, 2);
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes("secret\\workspace"), false);
  assert.equal(serialized.includes("do not expose"), false);
  assert.equal(serialized.includes("agent-42"), false);
  assert.equal(serialized.includes("session-main"), false);
  assert.match(snapshot.events[0].id, /^evt-[a-f0-9]{12}$/);
  assert.equal(snapshot.events[0].employeeId, employees.find((employee) => employee.kind === "subagent").id);
  assert.equal(employees.find((employee) => employee.kind === "main").name, "Project A 총괄");
  assert.equal(employees.find((employee) => employee.kind === "subagent").name, "구현 엔지니어");
});

test("names generic employees from their current functional tool without exposing tool input", () => {
  const snapshot = reduceEvents([
    event({ id: "started", type: "employee.started", status: "working", employeeId: "agent-default", employeeRole: "default", appendSeq: 1 }),
    event({ id: "editing", type: "employee.tool.started", status: "working", employeeId: "agent-default", employeeRole: "default", tool: "apply_patch", appendSeq: 2 }),
    event({ id: "completed", type: "employee.completed", status: "completed", employeeId: "agent-default", employeeRole: "default", appendSeq: 3 }),
  ], { now: new Date("2026-08-26T06:00:01.000Z") });
  assert.equal(snapshot.projects[0].employees[0].name, "코드 수정 담당");
  assert.equal(snapshot.projects[0].employees[0].role, "코드 변경");
  assert.equal(JSON.stringify(snapshot).includes("agent-default"), false);
});

test("groups repeated tool events into a long-term functional activity summary", () => {
  const events = [event({ id: "directive", type: "directive.submitted", status: "working", appendSeq: 1 })];
  for (let index = 0; index < 3; index += 1) {
    const at = new Date(Date.parse("2026-08-26T06:00:01.000Z") + index * 60_000).toISOString();
    events.push(event({ id: `start-${index}`, at, type: "employee.tool.started", status: "working", tool: "Bash", toolUseId: `tool-${index}`, appendSeq: index * 2 + 2 }));
    events.push(event({ id: `finish-${index}`, at, type: "employee.tool.completed", status: "working", tool: "Bash", toolUseId: `tool-${index}`, appendSeq: index * 2 + 3 }));
  }
  const snapshot = reduceEvents(events, { now: new Date("2026-08-26T06:03:00.000Z") });
  const summaries = snapshot.events.filter((item) => item.type === "activity.summary");
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].activityCategory, "workspace_check");
  assert.equal(summaries[0].activityLabel, "명령 실행·상태 점검");
  assert.equal(summaries[0].stepCount, 3);
  assert.equal(summaries[0].startedAt, "2026-08-26T06:00:01.000Z");
  assert.equal(summaries[0].at, "2026-08-26T06:02:01.000Z");
  assert.equal(JSON.stringify(summaries[0]).includes("Bash"), false);
});

test("starts a new activity summary at the ten-minute gap and after lifecycle events", () => {
  const events = [
    event({ id: "tool-a", type: "employee.tool.completed", status: "working", employeeId: "agent-a", employeeRole: "office_builder", tool: "apply_patch", toolUseId: "tool-a", appendSeq: 1 }),
    event({ id: "tool-b", at: new Date(Date.parse("2026-08-26T06:00:00.000Z") + ACTIVITY_GROUP_GAP_MS).toISOString(), type: "employee.tool.completed", status: "working", employeeId: "agent-a", employeeRole: "office_builder", tool: "apply_patch", toolUseId: "tool-b", appendSeq: 2 }),
    event({ id: "approval", at: "2026-08-26T06:10:01.000Z", type: "employee.approval.waiting", status: "waiting_approval", employeeId: "agent-a", employeeRole: "office_builder", appendSeq: 3 }),
    event({ id: "tool-c", at: "2026-08-26T06:10:02.000Z", type: "employee.tool.completed", status: "working", employeeId: "agent-a", employeeRole: "office_builder", tool: "apply_patch", toolUseId: "tool-c", appendSeq: 4 }),
  ];
  const snapshot = reduceEvents(events, { now: new Date("2026-08-26T06:10:03.000Z") });
  assert.equal(snapshot.events.filter((item) => item.type === "activity.summary").length, 3);
  assert.equal(snapshot.events.filter((item) => item.type === "employee.approval.waiting").length, 1);
});

test("uses specific safe categories for planning, documents, environment setup, and automation", () => {
  const tools = [
    ["update_plan", "planning", "작업 계획 관리"],
    ["mcp__codex_apps__codex_document_control__list_document_sessions", "document_work", "문서 작업"],
    ["codex_app__load_workspace_dependencies", "environment_setup", "작업 환경 준비"],
    ["mcp__node_repl__js", "automation", "자동화 실행"],
  ];
  const snapshot = reduceEvents(tools.map(([tool], index) => event({ id: `tool-${index}`, at: new Date(Date.parse("2026-08-26T06:00:00.000Z") + index * 1_000).toISOString(), type: "employee.tool.completed", status: "working", tool, toolUseId: `tool-use-${index}`, appendSeq: index + 1 })), { now: new Date("2026-08-26T06:00:05.000Z") });
  const categories = new Map(snapshot.events.map((item) => [item.activityCategory, item.activityLabel]));
  for (const [, category, label] of tools) assert.equal(categories.get(category), label);
});

test("removes completed subagents after a short handoff period while keeping their activity", () => {
  const events = [
    event({ id: "main", type: "directive.submitted", status: "working", appendSeq: 1 }),
    event({ id: "sub-start", type: "employee.started", status: "working", employeeId: "agent-done", employeeRole: "office_reviewer", appendSeq: 2 }),
    event({ id: "sub-stop", type: "employee.completed", status: "completed", employeeId: "agent-done", employeeRole: "office_reviewer", appendSeq: 3 }),
  ];
  const beforeRetirement = reduceEvents(events, { now: new Date(Date.parse("2026-08-26T06:00:00.000Z") + EMPLOYEE_HANDOFF_MS - 1) });
  const afterRetirement = reduceEvents(events, { now: new Date(Date.parse("2026-08-26T06:00:00.000Z") + EMPLOYEE_HANDOFF_MS) });
  assert.equal(beforeRetirement.projects[0].employees.some((employee) => employee.kind === "subagent"), true);
  assert.equal(afterRetirement.projects[0].employees.some((employee) => employee.kind === "subagent"), false);
  assert.equal(afterRetirement.events.some((item) => item.type === "employee.completed"), true);
});

test("removes ended main sessions after handoff without losing the project ended state", () => {
  const events = [
    event({ id: "work", type: "employee.tool.started", status: "working", sessionId: "session-a", appendSeq: 0 }),
    event({ id: "session-start", type: "session.started", status: "online", sessionId: "session-a", appendSeq: 1 }),
    event({ id: "session-end", type: "session.ended", status: "offline", sessionId: "session-a", appendSeq: 2 }),
  ];
  const snapshot = reduceEvents(events, { now: new Date(Date.parse("2026-08-26T06:00:00.000Z") + EMPLOYEE_HANDOFF_MS) });
  assert.equal(snapshot.projects[0].ended, true);
  assert.equal(snapshot.projects[0].status, "종료");
  assert.equal(snapshot.projects[0].employees.length, 0);
});

test("does not revive a completed employee for a delayed tool event", () => {
  const events = [
    event({ id: "sub-start", type: "employee.started", status: "working", employeeId: "agent-done", employeeRole: "worker", appendSeq: 1 }),
    event({ id: "sub-stop", type: "employee.completed", status: "completed", employeeId: "agent-done", employeeRole: "worker", appendSeq: 2 }),
    event({ id: "late-tool", type: "employee.tool.completed", status: "working", employeeId: "agent-done", employeeRole: "worker", tool: "Bash", appendSeq: 3 }),
  ];
  const duringHandoff = reduceEvents(events, { now: new Date("2026-08-26T06:00:01.000Z") });
  const afterHandoff = reduceEvents(events, { now: new Date(Date.parse("2026-08-26T06:00:00.000Z") + EMPLOYEE_HANDOFF_MS) });
  assert.equal(duringHandoff.projects[0].employees[0].status, "idle");
  assert.equal(afterHandoff.projects[0].employees.length, 0);
});

test("shows the same employee again only after an explicit restart event", () => {
  const snapshot = reduceEvents([
    event({ id: "sub-start", type: "employee.started", status: "working", employeeId: "agent-returning", employeeRole: "worker", appendSeq: 1 }),
    event({ id: "sub-stop", type: "employee.completed", status: "completed", employeeId: "agent-returning", employeeRole: "worker", appendSeq: 2 }),
    event({ id: "sub-restart", type: "employee.work.started", status: "working", employeeId: "agent-returning", employeeRole: "worker", appendSeq: 3 }),
  ], { now: new Date(Date.parse("2026-08-26T06:00:00.000Z") + EMPLOYEE_HANDOFF_MS) });
  assert.equal(snapshot.projects[0].employees.length, 1);
  assert.equal(snapshot.projects[0].employees[0].status, "working");
});

test("hides an employee after thirty minutes without activity while preserving activity history", () => {
  const events = [event({ id: "orphan", type: "employee.started", status: "working", employeeId: "agent-orphan", employeeRole: "explorer", appendSeq: 1 })];
  const beforeCleanup = reduceEvents(events, { now: new Date(Date.parse("2026-08-26T06:00:00.000Z") + EMPLOYEE_INACTIVE_MS - 1) });
  const afterCleanup = reduceEvents(events, { now: new Date(Date.parse("2026-08-26T06:00:00.000Z") + EMPLOYEE_INACTIVE_MS) });
  assert.equal(beforeCleanup.projects[0].employees.length, 1);
  assert.equal(afterCleanup.projects[0].employees.length, 0);
  assert.equal(afterCleanup.events[0].employeeName, "코드 탐색 담당");
});

test("ignores an inactive orphan main session when a current main session has ended", () => {
  const snapshot = reduceEvents([
    event({ id: "work", type: "employee.tool.started", status: "working", sessionId: "session-current", appendSeq: 0 }),
    event({ id: "orphan-start", type: "session.started", status: "online", sessionId: "session-orphan", appendSeq: 1 }),
    event({ id: "current-start", at: "2026-08-26T06:40:00.000Z", type: "session.started", status: "online", sessionId: "session-current", appendSeq: 2 }),
    event({ id: "current-end", at: "2026-08-26T06:40:01.000Z", type: "session.ended", status: "offline", sessionId: "session-current", appendSeq: 3 }),
  ], { now: new Date("2026-08-26T06:40:02.000Z") });
  assert.equal(snapshot.projects[0].ended, true);
  assert.equal(snapshot.projects[0].status, "종료");
  assert.equal(snapshot.projects[0].employees.length, 1);

  const orphanOnly = reduceEvents([
    event({ id: "work", type: "employee.tool.started", status: "working", sessionId: "session-orphan", appendSeq: 0 }),
    event({ id: "orphan-start", type: "session.started", status: "online", sessionId: "session-orphan", appendSeq: 1 }),
  ], { now: new Date("2026-08-26T06:40:02.000Z") });
  assert.equal(orphanOnly.projects[0].ended, false);
  assert.equal(orphanOnly.projects[0].status, "오프라인");
});

test("opaque IDs are stable for the same raw identifiers", () => {
  const options = { now: new Date("2026-08-26T06:00:01.000Z") };
  const first = reduceEvents([event({ id: "stable-event", employeeId: "stable-employee", employeeRole: "builder" })], options);
  const second = reduceEvents([event({ id: "stable-event", employeeId: "stable-employee", employeeRole: "builder" })], options);
  assert.equal(first.events[0].id, second.events[0].id);
  assert.equal(first.events[0].employeeId, second.events[0].employeeId);
  assert.equal(first.projects[0].employees[0].id, first.events[0].employeeId);
});

test("marks snapshots stale only after five minutes without an event", () => {
  const atBoundary = reduceEvents([event()], { now: new Date("2026-08-26T06:05:00.000Z") });
  const beyondBoundary = reduceEvents([event()], { now: new Date("2026-08-26T06:05:00.001Z") });
  assert.equal(atBoundary.freshness, "fresh");
  assert.equal(beyondBoundary.freshness, "stale");
  assert.equal(beyondBoundary.lastEventAt, "2026-08-26T06:00:00.000Z");
  assert.equal(beyondBoundary.projects[0].freshness, "stale");
  assert.ok(beyondBoundary.projects[0].employees.every((employee) => employee.freshness === "stale"));
});

test("groups two active employees in the same project into a meeting", () => {
  const snapshot = reduceEvents([
    event({ id: "main-working", type: "directive.submitted", status: "working", appendSeq: 1 }),
    event({ id: "sub-working", type: "employee.tool.started", status: "working", employeeId: "agent-active", employeeRole: "office_builder", appendSeq: 2 }),
    event({ id: "sub-waiting", type: "employee.approval.waiting", status: "waiting_approval", employeeId: "agent-waiting", employeeRole: "office_reviewer", appendSeq: 3 }),
  ], { now: new Date("2026-08-26T06:00:01.000Z") });
  const statuses = Object.fromEntries(snapshot.projects[0].employees.map((employee) => [employee.role, employee.status]));
  assert.equal(statuses["프로젝트 총괄"], "meeting");
  assert.equal(statuses["기능 구현"], "meeting");
  assert.equal(statuses["회귀·보안·유지보수 검토"], "waiting_approval");
});

test("marks a project ended only when all main sessions are offline", () => {
  const snapshot = reduceEvents([
    event({ id: "work", type: "employee.tool.started", status: "working", sessionId: "session-a", appendSeq: 0 }),
    event({ id: "session-a-start", type: "session.started", status: "online", sessionId: "session-a", appendSeq: 1 }),
    event({ id: "session-b-start", type: "session.started", status: "online", sessionId: "session-b", appendSeq: 2 }),
    event({ id: "session-a-end", type: "session.ended", status: "offline", sessionId: "session-a", appendSeq: 3 }),
  ], { now: new Date("2026-08-26T06:00:01.000Z") });
  assert.equal(snapshot.projects[0].ended, false);

  const ended = reduceEvents([
    event({ id: "work", type: "employee.tool.started", status: "working", sessionId: "session-a", appendSeq: 0 }),
    event({ id: "session-a-start", type: "session.started", status: "online", sessionId: "session-a", appendSeq: 1 }),
    event({ id: "session-a-end", type: "session.ended", status: "offline", sessionId: "session-a", appendSeq: 2 }),
  ], { now: new Date("2026-08-26T06:00:01.000Z") });
  assert.equal(ended.projects[0].ended, true);
  assert.equal(ended.projects[0].status, "종료");
});

test("ends a multi-session project only after every main session ends", () => {
  const snapshot = reduceEvents([
    event({ id: "work", type: "employee.tool.started", status: "working", sessionId: "session-a", appendSeq: 0 }),
    event({ id: "session-a-start", type: "session.started", status: "online", sessionId: "session-a", appendSeq: 1 }),
    event({ id: "session-b-start", type: "session.started", status: "online", sessionId: "session-b", appendSeq: 2 }),
    event({ id: "session-a-end", type: "session.ended", status: "offline", sessionId: "session-a", appendSeq: 3 }),
    event({ id: "session-b-end", type: "session.ended", status: "offline", sessionId: "session-b", appendSeq: 4 }),
  ], { now: new Date("2026-08-26T06:00:01.000Z") });
  assert.equal(snapshot.projects[0].ended, true);
});

test("keeps an ended session offline when a delayed tool event arrives", () => {
  const snapshot = reduceEvents([
    event({ id: "session-start", type: "session.started", status: "online", sessionId: "session-a", appendSeq: 1 }),
    event({ id: "session-end", type: "session.ended", status: "offline", sessionId: "session-a", appendSeq: 2 }),
    event({ id: "late-tool", type: "employee.tool.completed", status: "working", sessionId: "session-a", appendSeq: 3 }),
  ], { now: new Date("2026-08-26T06:00:01.000Z") });
  assert.equal(snapshot.projects[0].ended, true);
  assert.equal(snapshot.projects[0].employees[0].status, "offline");
});

test("resumes an ended project when a new main session starts", () => {
  const snapshot = reduceEvents([
    event({ id: "work", type: "employee.tool.started", status: "working", sessionId: "session-a", appendSeq: 0 }),
    event({ id: "old-start", type: "session.started", status: "online", sessionId: "session-a", appendSeq: 1 }),
    event({ id: "old-end", type: "session.ended", status: "offline", sessionId: "session-a", appendSeq: 2 }),
    event({ id: "new-start", type: "session.started", status: "online", sessionId: "session-b", appendSeq: 3 }),
  ], { now: new Date("2026-08-26T06:00:01.000Z") });
  assert.equal(snapshot.projects[0].ended, false);
  assert.equal(snapshot.projects[0].status, "대기");
});

test("returns demo mode only when there are no valid events", () => {
  const demo = reduceEvents([]);
  assert.equal(demo.mode, "demo");
  assert.equal(demo.freshness, "demo");
  assert.equal(demo.lastEventAt, null);
  assert.equal(reduceEvents([event()]).mode, "live");
});

test("hides lifecycle-only chats until a Codex work signal appears", () => {
  const chat = [
    event({ id: "chat-start", type: "session.started", status: "online", appendSeq: 1 }),
    event({ id: "chat-prompt", type: "directive.submitted", status: "working", appendSeq: 2 }),
    event({ id: "chat-stop", type: "turn.stopping", status: "stopping", appendSeq: 3 }),
  ];
  const hidden = reduceEvents(chat, { now: new Date("2026-08-26T06:00:01.000Z") });
  assert.deepEqual(hidden.projects, []);
  assert.deepEqual(hidden.events, []);
  assert.equal(hidden.mode, "live");

  const visible = reduceEvents([...chat, event({ id: "tool", type: "employee.tool.started", status: "working", tool: "Bash", appendSeq: 4 })], { now: new Date("2026-08-26T06:00:01.000Z") });
  assert.equal(visible.projects.length, 1);
  assert.ok(visible.events.some((item) => item.type === "activity.summary"));
});

test("hides inactive projects at 24 hours and restores them on later work", () => {
  const initial = [event({ id: "work", type: "employee.tool.started", status: "working", appendSeq: 1 })];
  const before = reduceEvents(initial, { now: new Date(Date.parse("2026-08-26T06:00:00.000Z") + PROJECT_INACTIVE_MS - 1) });
  const atBoundary = reduceEvents(initial, { now: new Date(Date.parse("2026-08-26T06:00:00.000Z") + PROJECT_INACTIVE_MS) });
  assert.equal(before.projects.length, 1);
  assert.deepEqual(atBoundary.projects, []);
  assert.deepEqual(atBoundary.events, []);

  const lateChatAt = new Date(Date.parse("2026-08-26T06:00:00.000Z") + PROJECT_INACTIVE_MS + 1).toISOString();
  const lateChat = reduceEvents([...initial, event({ id: "chat", at: lateChatAt, type: "directive.submitted", status: "working", appendSeq: 2 })], { now: new Date(lateChatAt) });
  assert.deepEqual(lateChat.projects, []);

  const restoredAt = lateChatAt;
  const restored = reduceEvents([...initial, event({ id: "later", at: restoredAt, type: "employee.tool.started", status: "working", appendSeq: 2 })], { now: new Date(restoredAt) });
  assert.equal(restored.projects.length, 1);
});

test("returns redacted details and discussions only for two active subagents", () => {
  const mainAndOne = reduceEvents([
    event({ id: "directive", type: "directive.submitted", detailKind: "directive", detail: "구현 범위를 확정합니다.", detailCapture: true, appendSeq: 1 }),
    event({ id: "sub-a", type: "employee.started", employeeId: "agent-a", employeeRole: "office_builder", appendSeq: 2 }),
    event({ id: "talk-a", type: "employee.tool.started", employeeId: "agent-a", employeeRole: "office_builder", tool: "collaborationsend_message", detailKind: "discussion", detail: "C:\\Users\\private\\Secret Folder\\work.txt; /mnt/private/key.pem; /private; api key = ABCD1234567890; Authorization: Basic dXNlcjpwYXNz", detailCapture: true, appendSeq: 3 }),
  ], { now: new Date("2026-08-26T06:00:01.000Z") });
  assert.deepEqual(mainAndOne.projects[0].discussions, []);
  assert.equal(mainAndOne.detailCaptureEnabled, true);
  assert.equal(JSON.stringify(mainAndOne).includes("Secret Folder"), false);
  assert.equal(JSON.stringify(mainAndOne).includes("/mnt/private"), false);
  assert.equal(JSON.stringify(mainAndOne).includes("ABCD1234567890"), false);
  assert.equal(JSON.stringify(mainAndOne).includes("dXNlcjpwYXNz"), false);

  const twoSubagents = reduceEvents([
    event({ id: "sub-a", type: "employee.started", employeeId: "agent-a", employeeRole: "office_builder", appendSeq: 1 }),
    event({ id: "sub-b", type: "employee.started", employeeId: "agent-b", employeeRole: "office_reviewer", appendSeq: 2 }),
    event({ id: "talk-a", type: "employee.tool.started", employeeId: "agent-a", employeeRole: "office_builder", tool: "collaborationsend_message", detailKind: "discussion", detail: "구현 경계를 리뷰 담당과 확인합니다.", detailCapture: true, appendSeq: 3 }),
    event({ id: "talk-b", type: "employee.tool.started", employeeId: "agent-b", employeeRole: "office_reviewer", tool: "collaborationfollowup_task", detailKind: "discussion", detail: "회귀 테스트 기준을 전달합니다.", detailCapture: true, appendSeq: 4 }),
  ], { now: new Date("2026-08-26T06:00:01.000Z") });
  assert.equal(twoSubagents.projects[0].discussions.length, 2);
  assert.match(twoSubagents.projects[0].discussions[0].employeeId, /^emp-[a-f0-9]{12}$/);
  assert.equal(JSON.stringify(twoSubagents).includes("agent-a"), false);
});
