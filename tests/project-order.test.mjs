import assert from "node:assert/strict";
import test from "node:test";
import { stabilizeProjectOrder } from "../src/project-order.js";

function project(id, overrides = {}) {
  return { id, name: id, ended: false, lastActivityAt: "2026-08-27T00:00:00.000Z", ...overrides };
}

test("keeps project blocks stable when only activity data changes", () => {
  const previous = [project("alpha"), project("beta")];
  const incoming = [project("beta", { lastActivityAt: "2026-08-27T00:02:00.000Z" }), project("alpha", { lastActivityAt: "2026-08-27T00:01:00.000Z" })];
  const result = stabilizeProjectOrder(previous, incoming);
  assert.deepEqual(result.map((item) => item.id), ["alpha", "beta"]);
  assert.equal(result[0].lastActivityAt, "2026-08-27T00:01:00.000Z");
});

test("appends a newly started project without moving existing blocks", () => {
  const previous = [project("alpha"), project("beta")];
  const incoming = [project("gamma"), project("beta"), project("alpha")];
  assert.deepEqual(stabilizeProjectOrder(previous, incoming).map((item) => item.id), ["alpha", "beta", "gamma"]);
});

test("moves a newly ended project behind active projects", () => {
  const previous = [project("alpha"), project("beta"), project("gamma", { ended: true })];
  const incoming = [project("alpha", { ended: true }), project("beta"), project("gamma", { ended: true })];
  assert.deepEqual(stabilizeProjectOrder(previous, incoming).map((item) => item.id), ["beta", "alpha", "gamma"]);
});

test("removes missing projects and moves a resumed project before ended projects", () => {
  const previous = [project("alpha"), project("beta", { ended: true }), project("gamma", { ended: true })];
  const incoming = [project("gamma"), project("beta", { ended: true })];
  assert.deepEqual(stabilizeProjectOrder(previous, incoming).map((item) => item.id), ["gamma", "beta"]);
});

test("replaces demo rooms with live projects even when the project count is unchanged", () => {
  const previous = [project("demo-office"), project("demo-research")];
  const incoming = [project("live-alpha"), project("live-beta")];
  assert.deepEqual(stabilizeProjectOrder(previous, incoming).map((item) => item.id), ["live-alpha", "live-beta"]);
});
