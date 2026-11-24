// A save holds what differs from the map: the map's statics are set down from the map at every start, and the save's chunks
// are laid over them.
import { Database } from "bun:sqlite";
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClientSession } from "../../client/core/session.ts";
import { listBackups, restoreBackup } from "../../server/persist/backup.ts";
import { SCHEMA_VERSION, WorldStore } from "../../server/persist/store.ts";
import type { ServerWorld } from "../../server/world.ts";
import { S_FAR, S_GONE } from "../../shared/net/protocol.ts";
import { TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { writeMap, type MapStatic } from "../../shared/world/mapfile.ts";
import { Found, GONE_DESTROYED, toldHealth, type StructureStore } from "../../shared/world/structures.ts";
import { flatMap } from "../fixtures/map.ts";
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

/** Whether every chunk with nothing built in it lends its places from the map's own columns and is exactly as large as its statics. */
function lent(world: ServerWorld): boolean {
  const s = world.statics!;
  return world.structs.held.every((c) => world.structs.chunks[c]!.high > world.structs.chunks[c]!.mapped || (world.structs.chunks[c]!.x.buffer === s.x.buffer && world.structs.chunks[c]!.cap === s.first[c + 1]! - s.first[c]!));
}

/** Each slot of each chunk as a save keeps it: its kind, and for a piece its place, turn, owner and health. */
function tables(structs: StructureStore, told = false): Record<number, number[][]> {
  const out: Record<number, number[][]> = {};
  for (const c of structs.held) {
    const t = structs.chunks[c]!;
    const rows: number[][] = [];
    // With `told`, an owned piece's health as a client holds it.
    const hp = (s: number): number => (told && t.owner[s] !== 0 ? toldHealth(t.hp[s]!, structs.fullHp![t.kind[s]!]!) : t.hp[s]!);
    for (let s = 0; s < t.high; s++) if (t.kind[s] !== 0) rows.push([s, t.kind[s]!, t.x[s]!, t.y[s]!, t.z[s]!, t.yaw[s]!, t.owner[s]!, hp(s)]);
    if (rows.length > 0) out[c] = rows;
  }
  return out;
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
  // The save holds the one slot that differs: the head, its place in the chunk and that it is empty.
  expect(saved(p.store)).toEqual({ chunks: [chunk], bytes: 7 });
  const [count, version] = [structs.count, structs.chunks[chunk]!.version];
  h.host.shutdown();

  const again = new Harness({}, 1, 60, { dbPath: db });
  const t = again.world.structs.chunks[chunk]!;
  expect([again.world.structs.count, t.kind[3], t.version, t.mapped, t.changed, t.differs]).toEqual([count, 0, version, structs.chunks[chunk]!.mapped, 1, 1]);
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
  expect([after.count, after.held, tables(after)]).toEqual([before.count, before.held, tables(before)]);
  for (const c of before.held) {
    const [t, u] = [before.chunks[c]!, after.chunks[c]!];
    expect([c, u.version, u.mapped, u.live, u.changed, u.differs, after.asPlaced(c)]).toEqual([c, t.version, t.mapped, t.live, t.changed, t.differs, before.asPlaced(c)]);
    // A slot's mod is not saved: a loaded slot takes its chunk's version, and no slot is ahead of it.
    expect([c, u.mod.subarray(0, u.high).every((m) => m <= u.version)]).toEqual([c, true]);
  }
  // The collision grid holds the same pieces over the whole map.
  const pieces = (s: typeof before): number[] => {
    const found = new Found();
    return [...found.refs.subarray(0, s.query(0, 0, 511, 511, found))].sort((a, b) => a - b);
  };
  expect(pieces(after)).toEqual(pieces(before));
  expect(lent(again.world)).toBe(true);
  // The map slot taken stays the map's after the load: a piece built in its chunk takes a slot past the map's.
  const t = after.chunks[other]!;
  expect([t.kind[1], t.x.buffer === again.world.statics!.x.buffer]).toEqual([0, true]);
  expect(after.add(k("pillar"), (other % 8) * 64 + 40, 33, Math.floor(other / 8) * 64 + 40, 0, 10, 70)).toBe(other * 65536 + t.mapped);
  again.host.shutdown();
});

const DIMS = { chunksX: 128, chunksZ: 4 };
const SAMPLES = ((DIMS.chunksX * 64) / TERRAIN_CELL + 1) * ((DIMS.chunksZ * 64) / TERRAIN_CELL + 1);
const towers: MapStatic[] = [];
for (let cx = 1; cx < 40; cx++) for (let i = 0; i < 3; i++) towers.push({ kind: "core:pillar", x: cx * 64 + 20, y: 3.3 + i * 6, z: 96, yaw: 0 });
/** A flat map 8 km long with a tower of three pillars in each chunk of its second row from 64 m to 2.5 km east. */
const CITY = writeMap({ id: "test:towers", dims: DIMS, minY: -32, stepY: 1 / 256, seaLevel: -Infinity, heights: new Uint16Array(SAMPLES).fill(32 * 256), tint: new Uint8Array(SAMPLES).fill(1), statics: towers, nodes: [], spawns: [{ name: "West", x: 100, z: 100, yaw: 0 }] });

/**
 * Each message of the far feed, cells and lists of pieces gone, in order, sent in four seconds to a session that holds the
 * statics and to one that does not. Someone is there a second and a half before they join: the map's chunks are baked again
 * only while a session is connected.
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
      if (data[0] === S_FAR || data[0] === S_GONE) got[i]!.push(data.slice());
      read(channel, data);
    };
  });
  h.run(4000, () => {
    a.askFar(2048, 2048);
    b.askFar(2048, 2048);
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
  // Ada is sent the lists of the two chunks changed, no cells, and nothing of the other 31 in reach. Bob is sent the cells of every tower standing in reach.
  expect([want[0]!.map((m) => m[0]), want[0]!.reduce((n, m) => n + m.length, 0), want[1]!.length, want[1]!.every((m) => m[0] === S_FAR)]).toEqual([[S_GONE, S_GONE], 12, 32, true]);

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

/** A flat map 9 chunks wide whose `chunks` each hold `n` pieces, a wall, a pillar and two crates in turn. */
function blocks(chunks: number[], n: number) {
  const statics: MapStatic[] = [];
  for (const c of chunks) for (let k = 0; k < n; k++) statics.push({ kind: k % 4 === 0 ? "core:wall" : k % 4 === 1 ? "core:pillar" : "core:crate", x: (c % 9) * 64 + 2 + (k % 10) * 6, y: 40 + Math.floor(k / 100) * 4, z: Math.floor(c / 9) * 64 + 2 + (Math.floor(k / 10) % 10) * 6, yaw: (k * 8192) & 0xffff });
  return writeMap(flatMap(9, { statics }));
}

test("a chunk mended back to the map stands as placed again and leaves the save", () => {
  const db = join(dir, "mended.db");
  const h = new Harness({}, 1, 60, { dbPath: db });
  const structs = h.world.structs;
  const p = h.host.persistence!;
  const chunk = structs.held.find((c) => structs.chunks[c]!.high > 20)!;
  const empty = [...Array(64).keys()].find((c) => !structs.chunks[c])!;
  const [crate, wall] = [h.reg.index.get("core:crate")!, h.reg.index.get("core:wall")!];
  // A static hurt and another swapped for a crate, and a wall built where the map set nothing down.
  const [hurt, swapped] = [chunk * 65536 + 2, chunk * 65536 + 5];
  const was = structs.chunks[chunk]!.kind[5]!;
  structs.damage(hurt, 1);
  structs.swap(swapped, was === crate ? wall : crate);
  const built = structs.add(wall, (empty % 8) * 64 + 20, 30, Math.floor(empty / 8) * 64 + 20, 0, 9, 100);
  h.run(500);
  expect([saved(p.store).chunks, changed(h.world)]).toEqual([[chunk, empty].sort((a, b) => a - b), [chunk, empty].sort((a, b) => a - b)]);
  // One mended: the chunk still differs. Then the other swapped back and the wall taken down.
  structs.mend(hurt, h.reg.maxHp[structs.mapKind(chunk, 2)]!);
  h.run(500);
  expect(saved(p.store).chunks).toEqual([chunk, empty].sort((a, b) => a - b));
  structs.swap(swapped, was);
  structs.remove(built);
  expect(changed(h.world)).toEqual([]);
  h.run(500);
  expect(saved(p.store)).toEqual({ chunks: [], bytes: 0 });
  h.host.shutdown();
  const again = new Harness({}, 1, 60, { dbPath: db });
  expect([changed(again.world), lent(again.world), again.world.structs.count]).toEqual([[], true, structs.count]);
  again.host.shutdown();
});

test("a felled lamp saves in under 16 bytes of chunk data", () => {
  const block = [...Array(16).keys()].map((i) => (2 + Math.floor(i / 4)) * 9 + 2 + (i % 4));
  const map = blocks(block, 800);
  const bytes: Record<string, number> = {};
  const cases: [string, (structs: StructureStore) => void][] = [
    ["one lamp felled", (structs) => structs.damage(block[5]! * 65536 + 401, 1e9)],
    ["a block of 16 chunks levelled", (structs) => block.forEach((c) => structs.removeMany(Uint32Array.from({ length: 800 }, (_, s) => c * 65536 + s), 800, GONE_DESTROYED, 0, 0, 0, 0))],
    ["every piece of that block hurt", (structs) => block.forEach((c) => [...Array(800).keys()].forEach((s) => structs.damage(c * 65536 + s, 1 + (s % 9))))],
  ];
  cases.forEach(([name, change], i) => {
    const h = new Harness({}, 1, 60, { map, dbPath: join(dir, `bytes-${i}.db`) });
    change(h.world.structs);
    h.run(1500);
    bytes[name] = saved(h.host.persistence!.store).bytes;
    h.host.shutdown();
  });
  // Saved whole, each chunk of 800 slots was 22,401 bytes: 22,401, 358,416 and 358,416.
  console.log(`save bytes of chunk data: ${Object.entries(bytes).map(([name, n]) => `${name} ${n}`).join(", ")}`);
  expect(bytes["one lamp felled"]).toBeLessThan(16);
  expect(bytes["a block of 16 chunks levelled"]).toBeLessThan(16 * 16);
  expect(bytes["every piece of that block hurt"]).toBeLessThan(16 * 800 * 6 + 16 * 16);
});

test("changed slots and player pieces load to the same tables as were saved", () => {
  const db = join(dir, "tables.db");
  const [a, b, bare] = [3 * 9 + 3, 3 * 9 + 4, 5 * 9 + 5];
  const map = blocks([a, b], 300);
  const h = new Harness({}, 1, 60, { map, dbPath: db });
  const structs = h.world.structs;
  const kinds = ["wall", "pillar", "crate", "wall_stone"].map((id) => h.reg.index.get(`core:${id}`)!);
  // Every piece nobody owns in the map is given to an owner, so each chunk's slots differ as one run but where more differs.
  expect(structs.reown(0, 12)).toBe(600);
  // In one chunk: runs of slots emptied, hurt alike and swapped alike, and a scatter of each with an owner of its own.
  for (let s = 20; s < 60; s++) structs.remove(a * 65536 + s);
  for (let s = 80; s < 120; s += 4) structs.damage(a * 65536 + s, 3);
  for (let s = 130; s < 150; s++) structs.swap(a * 65536 + s, kinds[3]!);
  for (let s = 200; s < 300; s += 7) [() => structs.remove(a * 65536 + s), () => structs.damage(a * 65536 + s, s), () => structs.swap(a * 65536 + s, kinds[s % 3]!)][s % 3]!();
  structs.reown(12, 0);
  for (let s = 250; s < 260; s++) structs.damage(a * 65536 + s, 1);
  // Pieces built over the map's in that chunk and in one the map left bare, some pulled down again, the last ones too.
  const built: number[] = [];
  for (const c of [a, bare]) for (let i = 0; i < 30; i++) built.push(structs.add(kinds[i % 4]!, (c % 9) * 64 + 3 + i * 2, 80 + (i % 5), Math.floor(c / 9) * 64 + 50, (i * 4096) & 0xffff, 5 + (i % 3), 100));
  built.forEach((ref, i) => (i % 4 === 1 || i % 30 > 26) && structs.remove(ref));
  built.forEach((ref, i) => i % 5 === 0 && structs.damage(ref, 10 + i));
  expect([structs.chunks[b]!.differs, structs.chunks[a]!.changed > 80, structs.chunks[bare]!.live]).toEqual([0, true, 21]);
  h.run(500);
  expect(saved(h.host.persistence!.store).chunks).toEqual([a, bare]);
  const before = tables(structs);
  h.host.shutdown();

  const again = new Harness({}, 1, 60, { map, dbPath: db });
  const after = again.world.structs;
  expect(tables(after)).toEqual(before);
  for (const c of [a, b, bare]) {
    const [t, u] = [structs.chunks[c]!, after.chunks[c]!];
    // A chunk that stood as placed was not saved, so it comes back at the version the map set it down with.
    expect([c, u.version, u.live, u.changed, u.differs, [...after.changedSlots(c)]]).toEqual([c, c === b ? t.mapped : t.version, t.live, t.changed, t.differs, [...structs.changedSlots(c)]]);
  }
  // The chunk of the map's with pieces built in it has its own columns, the other the map's still.
  expect([after.chunks[a]!.x.buffer === again.world.statics!.x.buffer, after.chunks[b]!.x.buffer === again.world.statics!.x.buffer]).toEqual([false, true]);
  // What was loaded is saved again as the same bytes.
  const blob = (hh: Harness): Uint8Array[] => (hh.host.persistence!.store.db.query("SELECT data FROM chunk_structs ORDER BY chunk").all() as { data: Uint8Array }[]).map((r) => r.data);
  const first = blob(again);
  for (const c of [a, bare]) again.host.persistence!.store.transaction(() => again.host.persistence!.store.saveChunk(c, after));
  expect(blob(again)).toEqual(first);
  again.host.shutdown();
});

test("a save of format 1 is refused with a plain message", () => {
  const db = join(dir, "old.db");
  const h = new Harness({}, 1, 60, { dbPath: db });
  const chunk = h.world.structs.held.find((c) => h.world.structs.chunks[c]!.high > 20)!;
  h.world.structs.damage(chunk * 65536 + 3, 1e9);
  const mapped = h.world.structs.chunks[chunk]!.mapped;
  h.run(500);
  h.host.shutdown();
  // A save an older build wrote says so in its schema, and is refused when it is opened.
  const raw = new Database(db);
  raw.exec(`UPDATE meta SET value = ${SCHEMA_VERSION - 1} WHERE key = 'schema_version'`);
  raw.close();
  expect(() => new WorldStore(db, h.reg)).toThrow(`save has schema ${SCHEMA_VERSION - 1}, and this build reads ${SCHEMA_VERSION}: old saves are not read, so start a new save`);
  // A chunk in the old format under this build's schema, every slot whole, is refused when the chunks are laid down.
  const forged = new Database(db);
  forged.exec(`UPDATE meta SET value = ${SCHEMA_VERSION} WHERE key = 'schema_version'`);
  forged.query("UPDATE chunk_structs SET data = ?").run(new Uint8Array(1 + 28 * 30).fill(1, 0, 1));
  forged.close();
  expect(() => new Harness({}, 1, 60, { dbPath: db })).toThrow(`chunk ${chunk}: its structures were saved in format 1, and this build reads 3: old saves are not read, so start a new save`);
  // Bytes cut short are refused too, by the chunk's number.
  const cut = new Database(db);
  cut.query("UPDATE chunk_structs SET data = ?").run(Uint8Array.of(3, mapped, 0, 1, 3));
  cut.close();
  expect(() => new Harness({}, 1, 60, { dbPath: db })).toThrow(`chunk ${chunk}: unreadable structure data`);
});

test("a client joining after a restart sees what a client that never left sees", () => {
  const db = join(dir, "rejoin.db");
  const [near, beside] = [4 * 9 + 4, 4 * 9 + 5];
  const map = blocks([near, beside], 300);
  const h = new Harness({}, 1, 30, { map, dbPath: db });
  const structs = h.world.structs;
  const watchers = [h.join("ada"), h.join("bob", {}, { statics: false })];
  h.run(1500);
  // While they watch: map pieces taken, hurt, swapped and one mended back, and pieces built, some pulled down.
  const [wall, crate] = [h.reg.index.get("core:wall")!, h.reg.index.get("core:crate")!];
  for (const c of [near, beside]) {
    for (let s = 10; s < 40; s++) structs.remove(c * 65536 + s);
    for (let s = 50; s < 120; s += 3) structs.damage(c * 65536 + s, 1 + (s % 4));
    for (let s = 150; s < 170; s++) structs.swap(c * 65536 + s, s % 4 === 0 ? crate : wall);
    structs.mend(c * 65536 + 50, h.reg.maxHp[structs.mapKind(c, 50)]!);
  }
  const built = [...Array(24).keys()].map((i) => structs.add(wall, 4 * 64 + 5 + i * 2, 90, 4 * 64 + 30, 0, 7, 100));
  built.forEach((ref, i) => i % 3 === 0 && structs.remove(ref));
  h.run(2500);
  const seen = (s: ClientSession): unknown => [near, beside].map((c) => tables(s.world!.structs)[c]);
  const server = [near, beside].map((c) => tables(structs, true)[c]);
  expect(watchers.map(seen)).toEqual([server, server]);
  h.host.shutdown();

  const again = new Harness({}, 1, 30, { map, dbPath: db });
  const late = [again.join("cy"), again.join("dee", {}, { statics: false })];
  again.run(2500);
  expect(late.map((s) => [near, beside].map((c) => again.client(s)!.known[c]))).toEqual([[structs.chunks[near]!.version, structs.chunks[beside]!.version], [structs.chunks[near]!.version, structs.chunks[beside]!.version]]);
  expect(late.map(seen)).toEqual([server, server]);
  // A change after the restart reaches them as it reaches anyone.
  again.world.structs.damage(near * 65536 + 5, 2);
  again.world.structs.remove(beside * 65536 + 200);
  again.run(500);
  const now = [near, beside].map((c) => tables(again.world.structs, true)[c]);
  expect([late.map(seen), now[1]!.length]).toEqual([[now, now], server[1]!.length - 1]);
  again.host.shutdown();
});
