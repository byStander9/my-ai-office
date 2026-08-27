import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const action = process.argv[2];
if (!["install", "remove"].includes(action)) {
  process.stderr.write("Usage: node scripts/configure-codex-hooks.mjs <install|remove>\n");
  process.exit(1);
}

const codexDir = process.env.AI_OFFICE_CODEX_DIR || join(homedir(), ".codex");
const hooksPath = join(codexDir, "hooks.json");
const sinkPath = join(codexDir, "ai-office", "event_sink.py");
const events = [
  "SessionStart", "SessionEnd", "UserPromptSubmit", "SubagentStart", "SubagentStop",
  "PermissionRequest", "PreCompact", "PostCompact", "PreToolUse", "PostToolUse", "Stop",
];

function isOfficeCommand(command) {
  return typeof command === "string" && /ai-office[\\/]event_sink\.py/i.test(command);
}

function withoutOfficeHooks(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || !Array.isArray(entry.hooks)) return [entry];
    const hooks = entry.hooks.filter((hook) => !isOfficeCommand(hook?.command) && !isOfficeCommand(hook?.commandWindows));
    return hooks.length ? [{ ...entry, hooks }] : [];
  });
}

let config = { description: "Codex user hooks.", hooks: {} };
let original = null;
try {
  original = await readFile(hooksPath, "utf8");
  config = JSON.parse(original);
} catch (error) {
  if (error?.code !== "ENOENT") {
    process.stderr.write(`Cannot parse ${hooksPath}. Fix the JSON before running this installer.\n`);
    process.exit(1);
  }
}

if (!config || typeof config !== "object" || Array.isArray(config)) config = {};
if (!config.hooks || typeof config.hooks !== "object" || Array.isArray(config.hooks)) config.hooks = {};

for (const event of events) {
  const retained = withoutOfficeHooks(config.hooks[event]);
  if (action === "install") {
    const hook = {
      type: "command",
      command: "python ~/.codex/ai-office/event_sink.py",
      commandWindows: `py -3 "${sinkPath}"`,
      timeout: 3,
    };
    retained.push({ ...(event === "PreToolUse" || event === "PostToolUse" ? { matcher: ".*" } : {}), hooks: [hook] });
  }
  if (retained.length) config.hooks[event] = retained;
  else delete config.hooks[event];
}

await mkdir(dirname(hooksPath), { recursive: true });
if (original !== null) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await copyFile(hooksPath, `${hooksPath}.backup-${stamp}`);
}
const temporaryPath = `${hooksPath}.tmp-${process.pid}`;
await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
await rename(temporaryPath, hooksPath);
process.stdout.write(`${action === "install" ? "Installed" : "Removed"} My AI Office hooks in ${hooksPath}\n`);
