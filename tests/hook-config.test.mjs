import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

function run(action, codexDir) {
  return spawnSync(process.execPath, [resolve("scripts/configure-codex-hooks.mjs"), action], {
    cwd: resolve("."),
    env: { ...process.env, AI_OFFICE_CODEX_DIR: codexDir },
    encoding: "utf8",
  });
}

function officeHookCount(config, event) {
  return (config.hooks[event] ?? []).flatMap((entry) => entry.hooks ?? []).filter((hook) => /ai-office[\\/]event_sink\.py/i.test(hook.commandWindows ?? hook.command ?? "")).length;
}

test("hook installer is repeatable and preserves unrelated hooks", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "ai-office-hooks-"));
  const hooksPath = join(root, "hooks.json");
  context.after(() => rm(root, { recursive: true, force: true }));
  const unrelated = { type: "command", command: "python keep-me.py", timeout: 2 };
  await writeFile(hooksPath, `${JSON.stringify({ hooks: { SessionStart: [{ hooks: [unrelated] }] } }, null, 2)}\n`, "utf8");

  assert.equal(run("install", root).status, 0);
  assert.equal(run("install", root).status, 0);
  let config = JSON.parse(await readFile(hooksPath, "utf8"));
  assert.equal(officeHookCount(config, "SessionStart"), 1);
  assert.ok(config.hooks.SessionStart.some((entry) => entry.hooks?.some((hook) => hook.command === unrelated.command)));
  assert.ok((await readdir(root)).some((name) => name.startsWith("hooks.json.backup-")));

  assert.equal(run("remove", root).status, 0);
  config = JSON.parse(await readFile(hooksPath, "utf8"));
  assert.equal(officeHookCount(config, "SessionStart"), 0);
  assert.ok(config.hooks.SessionStart.some((entry) => entry.hooks?.some((hook) => hook.command === unrelated.command)));
});
