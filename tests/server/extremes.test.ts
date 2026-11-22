import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHUNK_SIZE, chunkCx, chunkCz } from "../../shared/coords.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { Harness } from "../fixtures/net.ts";

const TICK_MS = 1000 / 30;

/** `count` walls on a lattice high above `chunk`, where nothing collides with them. Returns their refs. */
function wallsAbove(h: Harness, chunk: number, count: number): number[] {
  const dims = h.world.dims;
  const wall = h.reg.index.get("core:wall")!;
  const x0 = chunkCx(dims, chunk) * CHUNK_SIZE;
  const z0 = chunkCz(dims, chunk) * CHUNK_SIZE;
  const refs: number[] = [];
  for (let n = 0; n < count; n++) {
    refs.push(h.world.structs.add(wall, x0 + 2 + (n % 20) * 3, 400 + Math.floor(n / 400) * 4, z0 + 2 + (Math.floor(n / 20) % 20) * 3, 0, 1, 1e6));
  }
  return refs;
}

test("a client finishes taking in a large chunk while a nearer chunk changes every tick", () => {
  const h = new Harness();
  const s = h.join("ada");
  h.run(1000);
  const dims = h.world.dims;
  const near = h.client(s)!.chunk;
  const far = near + (chunkCx(dims, near) + 1 < dims.chunksX ? 1 : -1);
  const [target] = wallsAbove(h, near, 1);
  // Five ticks of the default budget of 256 rows.
  wallsAbove(h, far, 1200);
  const before = h.server.stats.chunkBytes;
  h.run(60 * TICK_MS, () => h.world.structs.damage(target!, 1));
  expect(s.world!.structs.chunks[far]?.live).toBe(h.world.structs.chunks[far]!.live);
  // Each row is sent about once: 1,200 rows of at most 21 bytes, plus the near chunk's one row a tick.
  expect(h.server.stats.chunkBytes - before).toBeLessThan(1200 * 21 + 60 * 40 + 4096);
});

test("a survivor killed by a fire another survivor lit is told it was killed", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const ada = h.join("ada");
  const bob = h.join("bob");
  h.run(600);
  const rec = (s: typeof ada) => h.host.records.byPid.get(h.world.ents.pid[h.ent(s)]!)!;
  const victim = rec(bob);
  h.host.survival.add(victim, V_HEALTH, -(h.host.survival.value(victim, V_HEALTH) - 10));
  // The fire takes eight health a second, so the last ten go at a deadline, not with a blow.
  h.host.buffs.give(victim, h.reg.index.get("core:burning")!, rec(ada).pid);
  h.run(2500);
  expect(victim.dead).toBe(true);
  expect(bob.log.at(-1)!.text).toBe("You were killed.");
});

test("a body that moved is saved within a second, however many creatures sleep elsewhere, and again as it falls asleep", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-extremes-"));
  const dbPath = join(dir, "world.db");
  const h = new Harness({}, 1, 60, { dev: true, dbPath });
  const ada = h.join("ada");
  h.run(600);
  h.say(ada, "enablecheats");
  const ents = h.world.ents;
  const me = h.ent(ada);
  // Four chunks from anyone, so asleep. Before the fix each took a turn of the 256 positions saved per commit.
  let asleep = 0;
  for (let n = 0; n < 20000 && asleep < 3000; n++) if (h.host.spawnCreature("core:dummy", 8 + (n % 50), 8 + Math.floor(n / 50) % 50, 1) >= 0) asleep++;
  expect(asleep).toBe(3000);
  const e = h.host.spawnCreature("core:dummy", ents.x[me]! + 4, ents.z[me]!, 1);
  const pid = ents.pid[e]!;
  h.run(400);
  /** Where the save has it, read beside the running server. */
  const saved = (): number => {
    const db = new Database(dbPath, { readonly: true });
    const row = db.query("SELECT x FROM entities WHERE pid = ?").get(pid) as { x: number };
    db.close();
    return row.x;
  };
  ents.setPosition(e, ents.x[e]! + 2, ents.y[e]!, ents.z[e]!);
  h.run(1000);
  expect(saved()).toBe(ents.x[e]!);
  // Moved again, and its chunk put to sleep at once by the only survivor leaving.
  ents.setPosition(e, ents.x[e]! + 2, ents.y[e]!, ents.z[e]!);
  h.say(ada, "tp 20 20");
  expect(h.host.creatures.isChunkAwake(ents.chunk[e]!)).toBe(false);
  expect(saved()).toBe(ents.x[e]!);
  h.host.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

test("the database is checkpointed between ticks when the host is given the time, not inside a commit", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-extremes-"));
  const dbPath = join(dir, "world.db");
  const h = new Harness({}, 1, 60, { dev: true, dbPath });
  h.join("ada");
  h.run(1000);
  for (let n = 0; n < 2000; n++) h.host.spawnCreature("core:dummy", 8 + (n % 50), 8 + Math.floor(n / 50), 1);
  h.run(6000);
  // The harness never calls idle, so what was committed is still in the write-ahead log.
  const before = statSync(dbPath).size;
  h.host.idle();
  expect(statSync(dbPath).size).toBeGreaterThan(before + 100_000);
  // Nothing new was committed since, so there is nothing to do.
  const after = statSync(dbPath).size;
  h.host.idle();
  expect(statSync(dbPath).size).toBe(after);
  h.host.shutdown();
  rmSync(dir, { recursive: true, force: true });
});
