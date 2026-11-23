// A save holds what differs from the map: the map's statics are set down from the map at every start, and the save's chunks
// are laid over them.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClientSession } from "../../client/core/session.ts";
import { listBackups, restoreBackup } from "../../server/persist/backup.ts";
import type { WorldStore } from "../../server/persist/store.ts";
import type { ServerWorld } from "../../server/world.ts";
import { S_FAR } from "../../shared/net/protocol.ts";
import { TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { writeMap, type MapStatic } from "../../shared/world/mapfile.ts";
import { Found } from "../../shared/world/structures.ts";
import { Harness } from "../fixtures/net.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-savemap-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** The chunks the save holds structures of, and their bytes. */
function saved(store: WorldStore): { chunks: number[]; bytes: number } {
  const rows = store.db.query("SELECT chunk, length(data) AS n FROM chunk_structs ORDER BY chunk").all() as { chunk: number; n: number }[];
  return { chunks: rows.map((r) => r.chunk), bytes: rows.reduce((n, r) => n + r.n, 0) };
}

/** The chunks that no longer stand as the map placed them. */
function changed(world: ServerWorld): number[] {
  return world.structs.held.filter((c) => !world.structs.asPlaced(c));
}

/** Whether every chunk as placed lends its places from the map's own columns and is exactly as large as its statics. */
function lent(world: ServerWorld): boolean {
  const s = world.statics!;
  return world.structs.held.every((c) => !world.structs.asPlaced(c) || (world.structs.chunks[c]!.x.buffer === s.x.buffer && world.structs.chunks[c]!.cap === s.first[c + 1]! - s.first[c]!));
}

test("a fresh save on a map with statics holds none of them, and a restart sets them down from the map as a fresh world does", () => {
  const db = join(dir, "fresh.db");
  const h = new Harness({}, 1, 60, { dbPath: db });
  const count = h.world.structs.count;
  expect([count, h.world.statics!.kind.length]).toEqual([108, 108]);
  h.join("ada");
  h.run(2000);
  const p = h.host.persistence!;
  expect(p.commits).toBeGreaterThan(5);
  expect(saved(p.store)).toEqual({ chunks: [], bytes: 0 });
  h.host.shutdown();

  const again = new Harness({}, 1, 60, { dbPath: db });
  expect(again.host.loaded).toEqual({ fresh: false, tick: h.world.tick, structures: count, records: 1 });
  expect([changed(again.world), lent(again.world)]).toEqual([[], true]);
  again.host.shutdown();
});

test("one static destroyed is one chunk in the save, still gone after a restart, and every other chunk stands as placed; a backup and saveas hold the same", () => {
  const db = join(dir, "one.db");
  const h = new Harness({}, 1, 60, { dbPath: db });
  const structs = h.world.structs;
  const chunk = structs.held.find((c) => structs.chunks[c]!.high > 20)!;
  expect(structs.damage(chunk * 65536 + 3, 1e9)).toBe(0);
  h.run(500);
  const p = h.host.persistence!;
  // The chunk is saved whole: a byte of format and 28 a slot.
  expect(saved(p.store)).toEqual({ chunks: [chunk], bytes: 1 + 28 * structs.chunks[chunk]!.high });
  const [count, version] = [structs.count, structs.chunks[chunk]!.version];
  h.host.shutdown();

  const again = new Harness({}, 1, 60, { dbPath: db });
  const t = again.world.structs.chunks[chunk]!;
  expect([again.world.structs.count, t.kind[3], t.version, t.mapped]).toEqual([count, 0, version, structs.chunks[chunk]!.mapped]);
  expect([changed(again.world), lent(again.world)]).toEqual([[chunk], true]);
  again.run(1000);
  expect(saved(again.host.persistence!.store).chunks).toEqual([chunk]);
  // A backup, and the world saved elsewhere, hold that chunk alone too, and a server started on the backup has it gone.
  again.host.persistence!.onBackup = null;
  expect(again.host.exec("backup")).toContain("a backup was started");
  const moved = join(dir, "one-moved.db");
  expect(again.host.exec(`saveas ${moved}`)).toBe(`the world is now saved in ${moved}`);
  expect(saved(again.host.persistence!.store).chunks).toEqual([chunk]);
  again.host.shutdown();
  restoreBackup(db, listBackups(db)[0]!, new Date());
  const back = new Harness({}, 1, 60, { dbPath: db });
  expect([changed(back.world), back.world.structs.chunks[chunk]!.kind[3], saved(back.host.persistence!.store).chunks]).toEqual([[chunk], 0, [chunk]]);
  back.host.shutdown();
});

test("a base built, damaged and half pulled down, with a static hurt and one taken, comes back slot for slot", () => {
  const db = join(dir, "base.db");
  const h = new Harness({}, 1, 60, { dbPath: db });
  const structs = h.world.structs;
  const k = (id: string): number => h.reg.index.get(`core:${id}`)!;
  // Half the base stands in a chunk of the map's statics, half in one the map left empty.
  const busy = structs.held.find((c) => structs.chunks[c]!.high > 20)!;
  const other = structs.held.find((c) => c !== busy && structs.chunks[c]!.high > 1)!;
  const empty = [...Array(64).keys()].find((c) => !structs.chunks[c])!;
  const refs: number[] = [];
  for (const c of [busy, empty]) {
    const [x0, z0] = [(c % 8) * 64 + 20, Math.floor(c / 8) * 64 + 20];
    for (let i = 0; i < 6; i++) {
      refs.push(structs.add(k("foundation_wood"), x0 + i * 3, 30.19, z0, 0, 9, 100));
      refs.push(structs.add(k("wall_stone"), x0 + i * 3, 31.88, z0 + 1.5, 0, 9, 100));
    }
  }
  expect(refs.every((r) => r >= 0)).toBe(true);
  refs.forEach((r, i) => i % 3 === 0 && structs.damage(r, 40));
  refs.forEach((r, i) => i % 2 === 1 && structs.remove(r));
  // A piece built where one was pulled down takes its slot again.
  refs.push(structs.add(k("pillar"), (busy % 8) * 64 + 40, 33, Math.floor(busy / 8) * 64 + 40, 8192, 10, 70));
  structs.damage(other * 65536, 1);
  structs.remove(other * 65536 + 1);
  h.run(500);
  expect(saved(h.host.persistence!.store).chunks).toEqual([busy, empty, other].sort((a, b) => a - b));
  const before = h.world.structs;
  h.host.shutdown();

  const again = new Harness({}, 1, 60, { dbPath: db });
  const after = again.world.structs;
  expect([after.count, after.held]).toEqual([before.count, before.held]);
  for (const c of before.held) {
    const [t, u] = [before.chunks[c]!, after.chunks[c]!];
    expect([c, u.version, u.mapped, u.high, u.live, after.asPlaced(c)]).toEqual([c, t.version, t.mapped, t.high, t.live, before.asPlaced(c)]);
    for (const col of ["kind", "x", "y", "z", "yaw", "owner", "hp", "mod"] as const) expect([c, col, [...u[col].subarray(0, u.high)]]).toEqual([c, col, [...t[col].subarray(0, t.high)]]);
  }
  // The collision grid holds the same pieces over the whole map.
  const pieces = (s: typeof before): number[] => {
    const found = new Found();
    return [...found.refs.subarray(0, s.query(0, 0, 511, 511, found))].sort((a, b) => a - b);
  };
  expect(pieces(after)).toEqual(pieces(before));
  expect(lent(again.world)).toBe(true);
  again.host.shutdown();
});

const DIMS = { chunksX: 128, chunksZ: 4 };
const SAMPLES = ((DIMS.chunksX * 64) / TERRAIN_CELL + 1) * ((DIMS.chunksZ * 64) / TERRAIN_CELL + 1);
const towers: MapStatic[] = [];
for (let cx = 1; cx < 40; cx++) for (let i = 0; i < 3; i++) towers.push({ kind: "core:pillar", x: cx * 64 + 20, y: 3.3 + i * 6, z: 96, yaw: 0 });
/** A flat map 8 km long with a tower of three pillars in each chunk of its second row from 64 m to 2.5 km east. */
const CITY = writeMap({ id: "test:towers", dims: DIMS, minY: -32, stepY: 1 / 256, seaLevel: -Infinity, heights: new Uint16Array(SAMPLES).fill(32 * 256), tint: new Uint8Array(SAMPLES).fill(1), statics: towers, nodes: [], spawns: [{ name: "West", x: 100, z: 100, yaw: 0 }] });

/**
 * Each S_FAR message, in order, sent in four seconds to a session that holds the statics and to one that does not. Someone is
 * there a second and a half before they join: the map's chunks are baked again only while a session is connected.
 */
function feed(h: Harness): Uint8Array[][] {
  h.join("cy");
  h.run(1500);
  const a = h.join("ada");
  const b = h.join("bob", {}, { statics: false });
  const got: Uint8Array[][] = [[], []];
  [a, b].forEach((s: ClientSession, i) => {
    const end = h.ends[h.sessions.indexOf(s)]!;
    const read = end.onMessage!;
    end.onMessage = (channel, data) => {
      if (data[0] === S_FAR) got[i]!.push(data.slice());
      read(channel, data);
    };
  });
  h.run(4000, () => {
    a.askFar(2048);
    b.askFar(2048);
  });
  return got;
}

test("a join after a restart is sent the far feed's bytes a fresh world sends, and none for a chunk as the map placed it", () => {
  // The top of the tower 1 km off is shot away, and the tower beside it razed.
  const [shot, razed] = [DIMS.chunksX + 16, DIMS.chunksX + 17];
  const change = (world: ServerWorld): void => {
    world.structs.remove(shot * 65536 + 2);
    for (let s = 0; s < 3; s++) world.structs.remove(razed * 65536 + s);
  };
  const fresh = new Harness({}, 1, 60, { map: CITY });
  change(fresh.world);
  const want = feed(fresh);
  // Ada is sent the two chunks changed and nothing of the other 31 in reach. Bob is sent every tower standing in reach.
  expect([want[0]!.length, want[1]!.length]).toEqual([2, 32]);

  const db = join(dir, "towers.db");
  const first = new Harness({}, 1, 60, { map: CITY, dbPath: db });
  change(first.world);
  first.run(500);
  expect(saved(first.host.persistence!.store).chunks).toEqual([shot, razed]);
  first.host.shutdown();
  const again = new Harness({}, 1, 60, { map: CITY, dbPath: db });
  expect(changed(again.world)).toEqual([shot, razed]);
  expect(feed(again)).toEqual(want);
  again.host.shutdown();
});
