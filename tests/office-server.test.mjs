import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createOfficeServer } from "../server/office-server.mjs";

function line({ id, at, type, projectKey, projectName, sessionId, employeeId, employeeRole, appendSeq }) {
  return JSON.stringify({ schemaVersion: 1, id, at, type, status: "working", project: { key: projectKey, name: projectName, cwd: "C:\\private" }, sessionId, employeeId, employeeRole, appendSeq, rawEvent: "private raw event" });
}

test("serves static files and reduces rotated then current JSONL through GET /api/events", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "ai-office-dashboard-"));
  const clientDir = join(root, "client");
  const eventsPath = join(root, "events.jsonl");
  await mkdir(clientDir);
  await writeFile(join(clientDir, "index.html"), "<main>office</main>", "utf8");
  await writeFile(`${eventsPath}.1`, `${line({ id: "old", at: "2026-08-26T05:59:58.000Z", type: "employee.started", projectKey: "old-project", projectName: "Old Project", sessionId: "session-old", employeeId: "employee-old", employeeRole: "office_researcher", appendSeq: 1 })}\n`, "utf8");
  await writeFile(eventsPath, `${line({ id: "new", at: "2026-08-26T06:00:00.000Z", type: "employee.started", projectKey: "new-project", projectName: "New Project", sessionId: "session-new", employeeId: "employee-9", employeeRole: "office_builder", appendSeq: 2 })}\n`, "utf8");

  const server = createOfficeServer({ eventsPath, clientDir, now: () => new Date("2026-08-26T06:00:01.000Z") });
  await new Promise((resolveReady, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolveReady); });
  context.after(async () => {
    await new Promise((resolveClosed) => server.close(resolveClosed));
    await rm(root, { recursive: true, force: true });
  });

  const address = server.address();
  assert.equal(address.address, "127.0.0.1");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const apiResponse = await fetch(`${baseUrl}/api/events`);
  const snapshot = await apiResponse.json();
  assert.equal(apiResponse.status, 200);
  assert.equal(snapshot.mode, "live");
  assert.equal(snapshot.freshness, "fresh");
  assert.equal(snapshot.lastEventAt, "2026-08-26T06:00:00.000Z");
  assert.deepEqual(snapshot.projects.map((project) => project.key), ["new-project", "old-project"]);
  assert.match(snapshot.events[0].id, /^evt-[a-f0-9]{12}$/);
  assert.match(snapshot.events[0].employeeId, /^emp-[a-f0-9]{12}$/);
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes("C:\\\\private"), false);
  assert.equal(serialized.includes("private raw event"), false);
  assert.equal(serialized.includes("employee-9"), false);
  assert.equal(serialized.includes("session-new"), false);
  assert.equal(serialized.includes('"id":"new"'), false);

  const pageResponse = await fetch(`${baseUrl}/`);
  assert.equal(await pageResponse.text(), "<main>office</main>");
});

test("returns explicit demo mode for a missing or empty event file", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "ai-office-dashboard-empty-"));
  const clientDir = join(root, "client");
  await mkdir(clientDir);
  await writeFile(join(clientDir, "index.html"), "office", "utf8");
  const server = createOfficeServer({ eventsPath: join(root, "missing.jsonl"), clientDir });
  await new Promise((resolveReady, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolveReady); });
  context.after(async () => {
    await new Promise((resolveClosed) => server.close(resolveClosed));
    await rm(root, { recursive: true, force: true });
  });
  const address = server.address();
  const snapshot = await fetch(`http://127.0.0.1:${address.port}/api/events`).then((response) => response.json());
  assert.equal(snapshot.mode, "demo");
  assert.equal(snapshot.freshness, "demo");
  assert.equal(snapshot.lastEventAt, null);
  assert.deepEqual(snapshot.projects, []);
  assert.deepEqual(snapshot.events, []);
});
