import assert from "node:assert/strict";
import test from "node:test";
import { EMPLOYEE_HANDOFF_MS, reduceEvents, sanitizeEvent } from "../server/events-reducer.mjs";

function event(overrides = {}) {
  return {
    schemaVersion: 1,
    id: "event-1",
    at: "2026-08-26T06:00:00.000Z",
    type: "turn.stopping",
    status: "stopping",
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
});

test("keeps turn.stopping visible until two quiet seconds have elapsed", () => {
  const beforeQuiet = reduceEvents([event()], { now: new Date("2026-08-26T06:00:01.999Z") });
  const afterQuiet = reduceEvents([event()], { now: new Date("2026-08-26T06:00:02.000Z") });
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

test("opaque IDs are stable for the same raw identifiers", () => {
  const first = reduceEvents([event({ id: "stable-event", employeeId: "stable-employee", employeeRole: "builder" })]);
  const second = reduceEvents([event({ id: "stable-event", employeeId: "stable-employee", employeeRole: "builder" })]);
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
    event({ id: "session-a-start", type: "session.started", status: "online", sessionId: "session-a", appendSeq: 1 }),
    event({ id: "session-b-start", type: "session.started", status: "online", sessionId: "session-b", appendSeq: 2 }),
    event({ id: "session-a-end", type: "session.ended", status: "offline", sessionId: "session-a", appendSeq: 3 }),
  ], { now: new Date("2026-08-26T06:00:01.000Z") });
  assert.equal(snapshot.projects[0].ended, false);

  const ended = reduceEvents([
    event({ id: "session-a-start", type: "session.started", status: "online", sessionId: "session-a", appendSeq: 1 }),
    event({ id: "session-a-end", type: "session.ended", status: "offline", sessionId: "session-a", appendSeq: 2 }),
  ], { now: new Date("2026-08-26T06:00:01.000Z") });
  assert.equal(ended.projects[0].ended, true);
  assert.equal(ended.projects[0].status, "종료");
});

test("ends a multi-session project only after every main session ends", () => {
  const snapshot = reduceEvents([
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
