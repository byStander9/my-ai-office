import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("event sink persists only privacy-minimized metadata", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "ai-office-sink-"));
  const eventsPath = join(root, "events.jsonl");
  context.after(() => rm(root, { recursive: true, force: true }));

  const raw = {
    hook_event_name: "PreToolUse",
    cwd: "C:\\private-workspace\\Secret Project",
    session_id: "raw-session-id",
    turn_id: "raw-turn-id",
    agent_id: "raw-employee-id",
    agent_type: "office_builder",
    tool_name: "apply_patch",
    tool_use_id: "raw-tool-use-id",
    prompt: "private prompt",
    command: "private command",
    tool_input: "private input",
    tool_output: "private output",
  };
  const executable = process.platform === "win32" ? "py" : "python3";
  const args = process.platform === "win32" ? ["-3", resolve("codex/event_sink.py")] : [resolve("codex/event_sink.py")];
  const result = spawnSync(executable, args, {
    cwd: resolve("."),
    env: { ...process.env, AI_OFFICE_EVENTS_PATH: eventsPath },
    input: JSON.stringify(raw),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);

  const event = JSON.parse((await readFile(eventsPath, "utf8")).trim());
  assert.deepEqual(event.project.name, "Secret Project");
  assert.match(event.sessionId, /^session-[a-f0-9]{24}$/);
  assert.match(event.employeeId, /^employee-[a-f0-9]{24}$/);
  const serialized = JSON.stringify(event);
  for (const privateValue of ["private-workspace", "raw-session-id", "raw-turn-id", "raw-employee-id", "raw-tool-use-id", "private prompt", "private command", "private input", "private output"]) {
    assert.equal(serialized.includes(privateValue), false, `leaked ${privateValue}`);
  }
  assert.equal("cwd" in event.project, false);
});

test("event sink captures only redacted opt-in directive and collaboration details", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "ai-office-detail-sink-"));
  const eventsPath = join(root, "events.jsonl");
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "settings.json"), JSON.stringify({ captureDetails: true }), "utf8");

  const executable = process.platform === "win32" ? "py" : "python3";
  const args = process.platform === "win32" ? ["-3", resolve("codex/event_sink.py")] : [resolve("codex/event_sink.py")];
  const run = (raw) => spawnSync(executable, args, {
    cwd: resolve("."),
    env: { ...process.env, AI_OFFICE_EVENTS_PATH: eventsPath, AI_OFFICE_CAPTURE_DETAILS: "" },
    input: JSON.stringify({ cwd: "C:\\workspace\\Project", session_id: "session", ...raw }),
    encoding: "utf8",
  });

  assert.equal(run({ hook_event_name: "UserPromptSubmit", prompt: "API를 점검해줘. Run npm test -- --reporter=spec with token=super-secret; C:\\Users\\person\\Secret Folder\\private.txt; /mnt/private/key.pem; /private; person@example.com; https://user:pass@example.com; api key = ABCD1234567890; Authorization: Basic dXNlcjpwYXNz" }).status, 0);
  assert.equal(run({ hook_event_name: "PreToolUse", agent_id: "agent-a", tool_name: "collaboration_send_message", tool_input: { message: "테스트 범위를 함께 확정하겠습니다. Bearer abcdefghijklmnop" } }).status, 0);
  assert.equal(run({ hook_event_name: "PreToolUse", tool_name: "collaboration_spawn_agent", tool_input: { task_name: "korean_display_auditor", agent_type: "office_researcher", message: "화면에 표시되는 영문과 내부 식별자를 조사합니다." } }).status, 0);
  assert.equal(run({ hook_event_name: "PreToolUse", agent_id: "agent-a", tool_name: "collaboration_send_message", tool_input: { message: `gAAAAA${"A".repeat(80)}` } }).status, 0);
  assert.equal(run({ hook_event_name: "SubagentStop", agent_id: "agent-a", agent_type: "office_researcher", last_assistant_message: "한국어 표시 경로를 확인했고 회귀 테스트 기준을 인계합니다. Run npm test in C:\\secret\\repo with token=handoff-secret" }).status, 0);
  assert.equal(run({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { message: "never capture arbitrary tool input" } }).status, 0);
  assert.equal(run({ hook_event_name: "PostToolUse", tool_name: "collaboration_send_message", tool_input: { message: "duplicate" }, tool_response: "never capture response" }).status, 0);

  const events = (await readFile(eventsPath, "utf8")).trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(events[0].detailKind, "directive");
  assert.match(events[0].detail, /민감정보=\[비밀정보\]/);
  assert.match(events[0].detail, /\[경로\]/);
  assert.match(events[0].detail, /\[이메일\]/);
  assert.match(events[0].detail, /\[인증정보\]/);
  assert.equal(events[1].detailKind, "discussion");
  assert.match(events[1].detail, /접근 토큰 \[비밀정보\]/);
  assert.equal(events[2].detailKind, "assignment");
  assert.equal(events[2].assignmentEmployeeName, "리서치 담당");
  assert.match(events[2].assignmentTask, /영문과 내부 식별자/);
  assert.equal("assignmentName" in events[2], false);
  assert.equal("assignmentRole" in events[2], false);
  assert.match(events[2].detail, /영문과 내부 식별자/);
  assert.equal(events[3].detailKind, "discussion");
  assert.equal("detail" in events[3], false);
  assert.equal(events[4].detailKind, "handoff");
  assert.match(events[4].detail, /회귀 테스트 기준/);
  assert.equal("detail" in events[5], false);
  assert.equal("detail" in events[6], false);
  const serialized = JSON.stringify(events);
  for (const privateValue of ["Run npm test", "--reporter=spec", "super-secret", "handoff-secret", "person@example.com", "private.txt", "/mnt/private", "/private", "user:pass", "ABCD1234567890", "dXNlcjpwYXNz", "abcdefghijklmnop", "never capture arbitrary tool input", "never capture response"]) {
    assert.equal(serialized.includes(privateValue), false, `leaked ${privateValue}`);
  }
  assert.equal(serialized.includes("gAAAAA"), false);
});
