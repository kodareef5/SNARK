// A turn with nothing to save writes nothing: an idle world keeps its clock a minute apart, and whatever does change is
// still saved at the next turn with the tick it happened at.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TICK_RATE } from "../../shared/coords.ts";
import { WorldStore } from "../../server/persist/store.ts";
import { Harness } from "../fixtures/net.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-quiet-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A world with a save and nothing in it that moves by itself. */
function empty(name: string) {
  const db = join(dir, `${name}.db`);
  const h = new Harness({}, 1, 60, { dbPath: db, startingCreatures: 0 });
  h.run(1000);
  return { db, h, p: h.host.persistence! };
}

/** What the file holds under `key`, read by a store of its own once the world has let go of it without a last commit. */
function kept(h: Harness, db: string, key: string): number {
  h.host.persistence!.close();
  const store = new WorldStore(db, h.reg);
  const value = Number(store.meta(key));
  store.close();
  return value;
}

test("an idle world writes its clock a minute apart, and a crash sets it back less than that", () => {
  const { db, h, p } = empty("idle");
  const commits = p.commits;
  h.run(120_000);
  // Five commits a second would be six hundred. A supply circuit's look once a minute is the most this world does.
  expect(p.commits - commits).toBeGreaterThanOrEqual(2);
  expect(p.commits - commits).toBeLessThan(12);
  // With the save's clock alone moving, each minute is one commit that changes nothing a backup would hold.
  const [at, changes] = [p.commits, p.changes];
  for (let n = 0; n < 180 * TICK_RATE; n++) {
    h.world.tick++;
    p.tryCommit(6);
  }
  expect([p.commits - at, p.changes - changes]).toEqual([3, 0]);
  const tick = h.world.tick;
  const saved = kept(h, db, "tick");
  expect(saved).toBeLessThanOrEqual(tick);
  expect(tick - saved).toBeLessThan(60 * TICK_RATE);
});

test("the hour set alone, and a team numbered alone, are saved at the next turn", () => {
  const { db, h, p } = empty("alone");
  h.run(2000);
  const at = p.commits;
  h.world.dayOffset += 12345;
  h.run(400);
  expect(p.commits).toBe(at + 1);
  const team = h.host.records.newTeam();
  h.run(400);
  expect([p.commits, p.changes > 0]).toEqual([at + 2, true]);
  const [offset, next] = [h.world.dayOffset, h.host.records.nextTeam];
  expect(team).toBeGreaterThan(0);
  h.host.persistence!.close();
  const store = new WorldStore(db, h.reg);
  expect([Number(store.meta("day_offset")), Number(store.meta("next_team"))]).toEqual([offset, next]);
  store.close();
});

test("a survivor standing still is saved within the minute, and nothing between", () => {
  const db = join(dir, "still.db");
  const h = new Harness({}, 1, 60, { dbPath: db, startingCreatures: 0 });
  const ada = h.join("ada");
  h.run(3000);
  const p = h.host.persistence!;
  p.commit();
  const pid = h.client(ada)!.pid;
  const writes: number[] = [];
  const save = p.store.saveEntity.bind(p.store);
  p.store.saveEntity = (rec) => (writes.push(rec.pid), save(rec));
  const at = p.commits;
  // Only the save's clock moves, so nothing but the rotation can ask for a write.
  for (let n = 0; n < 60 * TICK_RATE; n++) {
    h.world.tick++;
    p.tryCommit(6);
  }
  expect(writes).toEqual([pid]);
  expect(p.commits - at).toBeLessThanOrEqual(2);
  h.host.shutdown();
});

test("a commit that failed writes what it meant to at the next, the values it did not change among them", () => {
  const { db, h, p } = empty("failed");
  h.world.dayOffset += 777;
  const real = p.store.transaction.bind(p.store);
  let fail = true;
  p.onFailing = null;
  p.store.transaction = (write) => {
    if (fail) throw Object.assign(new Error("database or disk is full"), { code: "SQLITE_FULL" });
    return real(write);
  };
  h.run(400);
  expect(p.failing!.code).toBe("SQLITE_FULL");
  fail = false;
  const keys: string[] = [];
  const set = p.store.setMeta.bind(p.store);
  p.store.setMeta = (key, value) => (keys.push(key), set(key, value));
  h.run(6000);
  expect(p.failing).toBeNull();
  // Nothing is taken as written after a failure, so every value goes again.
  expect(new Set(keys)).toEqual(new Set(["tick", "day_offset", "next_seq", "next_team", "next_survivor", "frame_next", "world_id", "save_id", "map_id", "map_hash"]));
  expect(kept(h, db, "day_offset")).toBe(h.world.dayOffset);
});

test("a world saved elsewhere holds every value in its new file, and only the clock is written after", () => {
  const { h, p } = empty("moved");
  const to = join(dir, "moved-to.db");
  p.saveAs(to);
  for (const key of ["tick", "day_offset", "next_seq", "next_team", "next_survivor", "frame_next", "world_id", "save_id", "map_id", "map_hash"]) expect([key, p.store.meta(key) === null]).toEqual([key, false]);
  const keys: string[] = [];
  const set = p.store.setMeta.bind(p.store);
  p.store.setMeta = (key, value) => (keys.push(key), set(key, value));
  h.run(61_000);
  expect(new Set(keys)).toEqual(new Set(["tick"]));
  h.host.shutdown();
});
