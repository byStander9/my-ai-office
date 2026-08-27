import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
