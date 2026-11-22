import { Harness, testKey } from "../fixtures/net.ts";
import { SESSION_CREATING, SESSION_ALIVE, REJECT_NAME, REJECT_PASSWORD } from "../../shared/net/protocol.ts";
import { expect, test } from "bun:test";
import { SurvivorActivity } from "../../server/survivor-activity.ts";
import { EntityRecord, hashKey } from "../../server/records.ts";
import { SurvivorAccess, ownsSurvivor } from "../../server/survivor-access.ts";
import type { Host } from "../../server/host.ts";
import { readLaunch } from "../../client/core/entry-state.ts";
import { MIAMI_FLIGHT, flightPosition } from "../../client/core/title-route.ts";
import { defaultLook } from "../../shared/anim/look.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const post = (d: object) =>
  new Request("https://directory.example/directory", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(d),
  });

test("browser approval is scoped to a survivor, survives a new access service and recovery consumes its secret", async () => {
  const owner = "11".repeat(16),
    other = "22".repeat(16),
    third = "33".repeat(16),
    unhex = (s: string) => Uint8Array.from(Buffer.from(s, "hex"));
  const a = new EntityRecord(1, 1),
    b = new EntityRecord(2, 1);
  a.name = "Reef";
  b.name = "Bay";
  a.keyHash = b.keyHash = hashKey(unhex(owner));
  const host = {
    records: {
      byPid: new Map([
        [1, a],
        [2, b],
      ]),
      dirty: new Set<number>(),
    },
    activity: { summary: () => ({ lastLogin: null, playMs: null }) },
    game: { clients: [] },
    progression: { levelOf: () => 1 },
    survivorIds: () => [1, 2].values(),
    survivorRecord: (name: string) => [a, b].find((r) => r.name === name),
  } as unknown as Host;
  let service = new SurvivorAccess(host);
  const ask = (action: string, key: string, data: object = {}) => service.answer(post({ action, key, ...data }), "local");
  const { code } = (await (await ask("pair", other)).json()) as { code: string };
  expect((await ask("approve", third, { name: a.name, code })).status).toBe(403);
  expect((await ask("approve", owner, { name: a.name, code })).ok).toBe(true);
  expect((await ask("approve", owner, { name: b.name, code })).status).toBe(410);
  expect(((await (await ask("poll", other, { code })).json()) as { survivor: { name: string } }).survivor.name).toBe("Reef");
  expect((await ask("poll", owner, { code })).status).toBe(410);
  service = new SurvivorAccess(host);
  expect(
    ((await (await ask("roster", other)).json()) as { survivors: { name: string }[] }).survivors.map((r: { name: string }) => r.name),
  ).toEqual(["Reef"]);
  const backup = ((await (await ask("backup", other, { name: a.name })).json()) as { code: string }).code;
  expect((await ask("recover", third, { name: a.name, code: backup })).ok).toBe(true);
  expect((await ask("recover", other, { name: a.name, code: backup })).status).toBe(403);
  expect(ownsSurvivor(a, unhex(owner))).toBe(true);
  expect(ownsSurvivor(b, unhex(third))).toBe(false);
});
test("new and returning entry intents remain distinct and the mounted flight repeats at the cut", () => {
  const draft = { intent: "create" as const, name: "Reef", password: "", look: Array.from(defaultLook()), spawn: 2 };
  expect(readLaunch(JSON.stringify(draft))).toEqual(draft);
  expect(readLaunch(JSON.stringify({ ...draft, spawn: -1 }))).toBeNull();
  expect(readLaunch(JSON.stringify({ ...draft, name: " " }))).toBeNull();
  expect(readLaunch(JSON.stringify({ intent: "resume", name: "Reef", password: "" }))?.intent).toBe("resume");
  expect(flightPosition(0)).toEqual(flightPosition(MIAMI_FLIGHT.seconds));
  expect(flightPosition(18)).toEqual(flightPosition(18 + MIAMI_FLIGHT.seconds));
});

test("a protected world commits one named draft, accepts its interrupted retry and keeps different drafts apart", () => {
  const h = new Harness({ password: "reef" }),
    request = testKey("transaction"),
    opts = { intent: "create" as const, look: null, password: "reef", createRequest: request },
    name = "Harbour";
  const denied = h.join(name, {}, { ...opts, password: "wrong" });
  h.run(300);
  expect(denied.closeReason).toBe(REJECT_PASSWORD);
  const missing = h.join(name, {}, { ...opts, intent: "resume" });
  h.run(300);
  expect(missing.closeReason).toBe(REJECT_NAME);
  const c = h.join(name, {}, opts);
  h.run(400);
  expect(c.sessionState).toBe(SESSION_CREATING);
  const clash = h.join(name, {}, { ...opts, createRequest: testKey("different") });
  h.run(300);
  expect(clash.closeReason).toBe(REJECT_NAME);
  c.create(defaultLook(), 255);
  h.run(400);
  expect(c.sessionState).toBe(SESSION_CREATING);
  c.create(defaultLook(), 1);
  h.run(400);
  expect(c.sessionState).toBe(SESSION_ALIVE);
  const at = h.host.world.spawns[1]!;
  const body = h.host.game.clients.find(client => client?.active && client.name === name)!.body;
  expect(Math.hypot(body.x - at.x, body.z - at.z)).toBeLessThan(5);
  const pid = h.host.survivorRecord(name)!.pid;
  const retry = h.join(name, {}, opts);
  h.run(400);
  expect(retry.sessionState).toBe(SESSION_ALIVE);
  expect(retry.state).toBe("active");
  expect(c.state).toBe("closed");
  expect(h.host.survivorRecord(name)!.pid).toBe(pid);
  const taken = h.join(name, {}, { ...opts, createRequest: testKey("different") });
  h.run(300);
  expect(taken.closeReason).toBe(REJECT_NAME);
  const stranger = h.join(name, {}, { ...opts, key: testKey("new-device") });
  h.run(300);
  expect(stranger.state).toBe("closed");
  h.host.shutdown();
});

test("survivor play time follows the connection through checkpoints, repeated exits and returns", () => {
  const h = new Harness(),
    rec = h.host.records.create(h.reg.index.get("core:survivor")!, "Kai");
  let now = 2000;
  const meter = () =>
    new SurvivorActivity(
      h.host.records,
      () => 100000 + now,
      () => now,
    );
  const activity = meter();
  expect(activity.summary(rec)).toEqual({ lastLogin: null, playMs: null });
  activity.login(rec.pid);
  now += 1500;
  activity.checkpointAll();
  activity.login(rec.pid);
  now += 500;
  activity.leave(rec.pid);
  now += 30000;
  activity.leave(rec.pid);
  const again = meter();
  expect(again.summary(rec)).toEqual({ lastLogin: 102000, playMs: 2000 });
  again.login(rec.pid);
  now += 4000;
  expect(again.summary(rec)).toEqual({ lastLogin: 134000, playMs: 6000 });
  h.host.shutdown();
});

test("a survivor stops accruing time on disconnect and restores its activity from the world save", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-activity-"));
  const opts = { dbPath: join(dir, "world.sqlite"), dev: true, startingCreatures: 0 };
  let h: Harness | undefined;
  try {
    h = new Harness({ lingerTicks: 300 }, 1, 60, opts);
    const c = h.join("Piper");
    h.run(650);
    expect(c.sessionState).toBe(SESSION_ALIVE);
    const rec = h.host.survivorRecord("Piper")!;
    h.ends[0]!.close();
    h.run(120);
    const left = h.host.activity.summary(rec);
    expect(left.lastLogin!).toBeGreaterThan(0);
    expect(left.playMs!).toBeGreaterThan(0);
    h.run(700);
    expect(h.host.activity.summary(rec)).toEqual(left);
    h.host.shutdown();
    h = undefined;
    h = new Harness({}, 1, 60, opts);
    const restored = h.host.survivorRecord("Piper")!;
    expect(h.host.activity.summary(restored)).toEqual(left);
    h.join("Piper", {}, { intent: "resume" });
    h.run(500);
    const resumed = h.host.activity.summary(restored);
    expect(resumed.lastLogin!).toBeGreaterThan(left.lastLogin!);
    expect(resumed.playMs!).toBeGreaterThan(left.playMs!);
  } finally {
    h?.host.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});
