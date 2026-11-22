import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { castAct, castState } from "../../server/admin/cast.ts";
import { Harness } from "../fixtures/net.ts";

test("Cast is there but idle unless set; its settings change live; the admin page reads it and plays a scene", () => {
  const h = new Harness({ entityRadius: 1 }, 2, 30, { wakeRadius: 1 });
  h.join("Ana");
  h.run(6000);
  const cast = h.host.cast;
  expect(cast.cast.settings.enabled).toBe(false);
  expect(cast.cast.stories.size).toBe(0);
  expect(castAct(h.host, { op: "set", name: "CastEnabled", value: "true" })).toBe("");
  expect(castAct(h.host, { op: "set", name: "CastActivity", value: "1.5" })).toBe("");
  expect(castAct(h.host, { op: "set", name: "CastModelKey", value: "x" })).toContain("never its key");
  h.run(6000);
  expect(cast.cast.settings.enabled).toBe(true);
  expect(cast.cast.settings.activity).toBe(1.5);
  expect(cast.cast.stories.size).toBeGreaterThan(0);
  expect(castAct(h.host, { op: "spawn", scene: "cast:flash_mob" })).toBe("");
  const state = JSON.parse(castState(h.host, Date.now()));
  expect(state.enabled).toBe(true);
  expect(state.stories.some((s: { sceneId: string; phase: string }) => s.sceneId === "cast:flash_mob" && s.phase !== "planned")).toBe(true);
  expect(state.scenes.find((s: { id: string }) => s.id === "cast:drive_by").placeholder).toBe(true);
  // Off again: nothing new starts, and its people walk off.
  expect(castAct(h.host, { op: "set", name: "CastEnabled", value: "false" })).toBe("");
  h.run(6000);
  expect([...cast.cast.stories.values()].every((s) => s.phase === "planned" || s.phase === "done")).toBe(true);
});

test("Cast's people and planned stories outlast a restart; its bodies never do", () => {
  const dir = mkdtempSync(join(tmpdir(), "cast-save-"));
  try {
    const db = join(dir, "world.db");
    const a = new Harness({ entityRadius: 1 }, 2, 30, { dbPath: db, cast: { size: 40, activity: 2 }, wakeRadius: 1 });
    a.join("Ana");
    a.run(60_000);
    const people = [...a.host.cast.cast.people.byId.values()].filter((c) => c.tier === "featured").map((c) => c.id).sort();
    const planned = [...a.host.cast.cast.stories.values()].filter((s) => s.phase === "planned").length;
    expect(planned).toBeGreaterThan(0);
    a.run(61_000);
    a.host.shutdown();
    const b = new Harness({ entityRadius: 1 }, 2, 30, { dbPath: db, cast: { size: 40 }, wakeRadius: 1 });
    expect([...b.host.cast.cast.people.byId.values()].filter((c) => c.tier === "featured").map((c) => c.id).sort()).toEqual(expect.arrayContaining(people));
    expect([...b.host.cast.cast.stories.values()].filter((s) => s.phase === "planned").length).toBeGreaterThan(0);
    expect([...b.host.records.byPid.values()].some((r) => r.extra.has(90))).toBe(false);
    b.host.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("every Cast setting takes hold live within seconds (CastModelKey is read with the rest, never shown)", () => {
  const h = new Harness({ entityRadius: 1 }, 2, 30, { wakeRadius: 1 });
  h.join("Ana");
  h.run(1000);
  const set: [string, string, keyof typeof h.host.cast.cast.settings, string | number | boolean][] = [
    ["CastEnabled", "true", "enabled", true], ["CastSize", "77", "size", 77], ["CastActivity", "0.5", "activity", 0.5], ["CastSpikiness", "0.2", "spikiness", 0.2],
    ["CastMaxBodies", "33", "maxBodies", 33], ["CastMaxPerPlayer", "5", "maxPerPlayer", 5], ["CastCrowdMax", "44", "crowdMax", 44], ["CastHostility", "1", "hostility", 1],
    ["CastHostileCooldown", "600", "hostileCooldown", 600], ["CastModel", "", "model", ""], ["CastCallsPerHour", "12", "callsPerHour", 12], ["CastHourlyBatch", "9", "hourlyBatch", 9],
  ];
  for (const [name, value] of set) expect([name, h.host.setSetting(name, value)]).toEqual([name, ""]);
  h.run(6000);
  for (const [name, , field, want] of set) expect([name, h.host.cast.cast.settings[field]]).toEqual([name, want]);
  // No model and no CastModelKey: the planner is off and Cast runs on its rules.
  expect(h.host.rules.text("CastModelKey")).toBe("");
  expect(h.host.cast.gate.ask).toBeNull();
});
