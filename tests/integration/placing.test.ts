// Bodies are never put inside a node, though nodes load only round players, and one found inside a node or a piece is set at
// the nearest free place, never through another tribe's wall.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CORE_CONTENT } from "../../content/core.ts";
import { createHost } from "../../server/host.ts";
import type { EntityRecord } from "../../server/records.ts";
import type { Def } from "../../shared/content/defs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { CHUNK_SIZE, chunkAt } from "../../shared/coords.ts";
import { BitWriter } from "../../shared/net/codec.ts";
import { capsuleFree, groundUnder } from "../../shared/world/collide.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import type { NodeSpot } from "../../shared/world/nodes.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-placing-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Flat ground of 8 by 8 chunks with an elder oak at A (420, 420), where the map's spawn point is, and one at B (36, 36), 540 m off. */
const A = 420;
const B = 36;
const at = (m: number): number => ((m % CHUNK_SIZE) / CHUNK_SIZE) * 65536;
const oaks = writeMap(
  flatMap(8, {
    nodes: [{ kinds: ["core:oak"], first: Uint32Array.from({ length: 65 }, (_, c) => (c > 0 ? 1 : 0) + (c > 54 ? 1 : 0)), kind: Uint8Array.of(0, 0), x: Uint16Array.of(at(B), at(A)), z: Uint16Array.of(at(B), at(A)), yaw: Uint16Array.of(0, 9000) }],
    spawns: [{ name: "Rock", x: A, z: A, yaw: 0 }],
  }),
);

function world(): Harness {
  const h = new Harness({}, 1, 60, { dev: true, map: oaks });
  const field = h.world.nodeField!;
  expect([field.isLoaded(chunkAt(h.world.dims, A, A)), field.isLoaded(chunkAt(h.world.dims, B, B))]).toEqual([false, false]);
  return h;
}

/** Runs `f` with the nodes of the chunks round (x, z) loaded, as they are for a body there. */
function loaded<T>(h: Harness, x: number, z: number, f: () => T): T {
  const field = h.world.nodeField!;
  const chunk = chunkAt(h.world.dims, x, z);
  field.retain(chunk, 1, 1, () => false);
  const out = f();
  field.retain(chunk, 1, -1, () => false);
  return out;
}

/** Whether entity `e` stands clear of everything there, every node loaded. */
function clear(h: Harness, e: number): boolean {
  const { ents, reg } = h.world;
  const [x, y, z, k] = [ents.x[e]!, ents.y[e]!, ents.z[e]!, ents.kind[e]!];
  return loaded(h, x, z, () => capsuleFree(h.world, x, y, z, reg.bodyRadius[k]!, reg.bodyHeight[k]!));
}

test("a survivor's spawn, an admin's teleport and creature, and an egg are never put inside a tree nobody has loaded", () => {
  const h = world();
  const { ents, hf, reg, dims } = h.world;
  const field = h.world.nodeField!;
  // The spawn point is inside oak A, which loads only once the survivor is in.
  const ada = h.join("ada");
  h.run(500);
  const me = h.ent(ada);
  const p = reg.move[ents.kind[me]!]!;
  expect(field.isLoaded(chunkAt(dims, A, A))).toBe(true);
  expect(capsuleFree(h.world, A, groundUnder(hf, A, A, p.radius), A, p.radius, p.height)).toBe(false);
  expect(clear(h, me)).toBe(true);

  // Oak B is not loaded. An admin's creature is not put there, and a teleport into it is refused.
  expect(field.isLoaded(chunkAt(dims, B, B))).toBe(false);
  expect(h.host.spawnCreature("core:dodo", B, B, 1)).toBe(-1);
  h.say(ada, "enablecheats");
  expect(h.say(ada, `tp ${B} ${B}`)).toEqual(["that spot is inside something"]);

  // A dodo mother stands just far enough from B for an egg, facing away, so the egg she lays behind her would be inside it.
  const egg = reg.breedEgg[reg.index.get("core:dodo")!]!;
  const [er, eh] = [reg.bodyRadius[egg]!, reg.bodyHeight[egg]!];
  const d = loaded(h, B, B, () => {
    let d = 0;
    while (!capsuleFree(h.world, B, groundUnder(hf, B, B + d, er), B + d, er, eh)) d += 0.05;
    return d;
  });
  const mother = h.host.spawnCreature("core:dodo", B, B + d + 0.05, 5);
  const father = h.host.spawnCreature("core:dodo", B + 3, B + d + 1, 5);
  expect([mother >= 0, father >= 0]).toEqual([true, true]);
  ents.yaw[mother] = 0;
  const rec = (e: number): EntityRecord => h.host.records.byPid.get(ents.pid[e]!)!;
  rec(mother).genome!.female = true;
  const before = new Set(h.host.records.byPid.keys());
  (h.host.breeding as unknown as { lay(mother: EntityRecord, father: EntityRecord, e: number): void }).lay(rec(mother), rec(father), mother);
  const eggs = [...h.host.records.byPid.values()].filter((r) => !before.has(r.pid) && r.egg !== null);
  expect(eggs.length).toBeGreaterThan(0);
  for (const r of eggs) expect(clear(h, h.host.records.entOf.get(r.pid)!)).toBe(true);
  expect(field.isLoaded(chunkAt(dims, B, B))).toBe(false);

  // A survivor last seen inside B is not put there.
  const saved = h.host.game.savedPosition!;
  h.host.game.savedPosition = (name) => (name === "bo" ? { x: B, y: hf.heightAt(B, B), z: B, yaw: 0 } : saved(name));
  const bo = h.join("bo");
  h.run(500);
  expect(clear(h, h.ent(bo))).toBe(true);
});

/** One elder oak at A, square to the axes, and a spawn point 170 m off, near enough that a survivor there has A loaded. */
const grove = writeMap(
  flatMap(8, {
    nodes: [{ kinds: ["core:oak"], first: Uint32Array.from({ length: 65 }, (_, c) => (c > 54 ? 1 : 0)), kind: Uint8Array.of(0), x: Uint16Array.of(at(A)), z: Uint16Array.of(at(A)), yaw: Uint16Array.of(0) }],
    spawns: [{ name: "Glade", x: 300, z: 300, yaw: 0 }],
  }),
);

/** The oak at A: its trunk's half width, and the top of the stump it leaves. */
function oakAt(h: Harness): { half: number; stump: number } {
  const field = h.world.nodeField!;
  const spot: NodeSpot = { kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 };
  field.source.at(chunkAt(h.world.dims, A, A), 0, spot);
  const { parts, left } = field.forms;
  const box = (form: number): Float32Array => parts.box.subarray(parts.start[form]! * 6, parts.start[form]! * 6 + 6);
  const stump = box(left[spot.form]!);
  return { half: box(spot.form)[3]!, stump: spot.y + stump[1]! + stump[4]! };
}

/** `name` was last seen at (x, z), in `team`. */
function lastSeen(h: Harness, name: string, x: number, z: number, team: number): void {
  const saved = h.host.game.savedPosition!;
  h.host.game.savedPosition = (n) => (n === name ? { x, y: h.world.hf.heightAt(x, z), z, yaw: 0, team } : saved(n));
}

test("a survivor last seen inside a tree is set at the nearest free place beside it, the same place every time", () => {
  const places = [0, 1].map(() => {
    const h = new Harness({}, 1, 60, { dev: true, map: grove });
    lastSeen(h, "bo", A + 0.3, A, 0);
    const bo = h.join("bo");
    h.run(500);
    const e = h.ent(bo);
    expect(clear(h, e)).toBe(true);
    const { half } = oakAt(h);
    const [x, z] = [h.world.ents.x[e]!, h.world.ents.z[e]!];
    // Out of the near side, within a ring's step of the least it must move.
    expect([x > A + half, Math.hypot(x - A - 0.3, z - A) < half - 0.3 + 0.4 + 0.25]).toEqual([true, true]);
    return [x, h.world.ents.y[e]!, z];
  });
  expect(places[0]).toEqual(places[1]!);
});

test("a body a wider trunk now holds, as a save may after the art changes, is set beside it on its own side as its chunk loads", () => {
  const db = join(dir, "grown.db");
  const first = createHost(coreRegistry(), { dbPath: db, map: grove });
  const field = first.world.nodeField!;
  const spot: NodeSpot = { kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 };
  field.source.at(chunkAt(first.world.dims, A, A), 0, spot);
  // A dummy against the oak's east side.
  const x = A + field.forms.parts.box[field.forms.parts.start[spot.form]! * 6 + 3]! + 0.4 + 0.02;
  expect(first.spawnCreature("core:dummy", x, A, 1)).toBeGreaterThanOrEqual(0);
  first.shutdown();
  // Every elder oak's trunk half a metre wider each way, before its size.
  const wide = (d: Def): Def => (d.id === "core:oak" && d.type === "node" ? { ...d, variants: d.variants!.map((v) => ({ ...v, boxes: v.boxes!.map((b) => ({ at: b.at, half: [b.half[0] + 0.5, b.half[1], b.half[2] + 0.5] as [number, number, number] })) })) } : d);
  const wider = compileContent(CORE_CONTENT.map(wide)).registry!;
  const h = new Harness({}, 1, 60, { dev: true, dbPath: db, map: grove }, wider);
  const rec = [...h.host.records.byPid.values()].find((r) => r.kind === wider.index.get("core:dummy"))!;
  const e = h.host.records.entOf.get(rec.pid)!;
  expect(clear(h, e)).toBe(false);
  h.join("ada");
  h.run(300);
  const need = A + oakAt(h).half + 0.4 - x;
  const ents = h.world.ents;
  expect([h.host.settled.bodies, clear(h, e)]).toEqual([1, true]);
  expect([ents.x[e]! - x >= need, ents.x[e]! - x < need + 0.25, ents.z[e]]).toEqual([true, true, A]);
  h.host.shutdown();
});

test("a survivor inside a tree that another tribe's wall passes through is set on its own side of the wall, though through it is nearer", () => {
  for (const [team, through] of [[5, false], [77, true]] as const) {
    const h = new Harness({}, 1, 60, { dev: true, map: grove });
    const { half } = oakAt(h);
    expect(half).toBeGreaterThan(0.8);
    const reg = h.world.reg;
    const wall = reg.index.get("core:wall")!;
    const wz = reg.halfZ[wall]!;
    // Tribe 77's wall runs east to west through the trunk, its north face 0.1 m inside the trunk's north side. The survivor
    // stands in the trunk just south of the wall, so the nearest way out is north, through the wall.
    const zc = A + half - 0.1 - wz;
    expect(h.world.structs.add(wall, A, reg.halfY[wall]!, zc, 0, 77, 1000)).toBeGreaterThanOrEqual(0);
    const z = zc - wz - 0.4 - 0.05;
    lastSeen(h, "bo", A, z, team);
    const bo = h.join("bo");
    h.run(500);
    const e = h.ent(bo);
    expect(clear(h, e)).toBe(true);
    const [ex, ez] = [h.world.ents.x[e]!, h.world.ents.z[e]!];
    expect([ez > zc, Math.hypot(ex - A, ez - z) < half + 1]).toEqual([through, true]);
  }
});

test("a creature on a stump when its tree grows back is set beside the trunk", () => {
  const h = new Harness({}, 1, 60, { dev: true, map: grove });
  // The oak was used up, and grows back two seconds from now.
  const w = new BitWriter(16);
  w.varint(1);
  w.u8(0);
  w.varint(0);
  w.uint53(h.world.tick + 60);
  h.host.harvest!.decode(chunkAt(h.world.dims, A, A), w.bytes().slice());
  const e = h.host.spawnCreature("core:dummy", A + 5, A, 1);
  h.world.ents.setPosition(e, A, oakAt(h).stump, A);
  h.join("ada");
  h.run(300);
  expect([h.host.settled.bodies, clear(h, e)]).toEqual([0, true]);
  h.run(3000);
  const near = Math.hypot(h.world.ents.x[e]! - A, h.world.ents.z[e]! - A) < oakAt(h).half + 1;
  expect([h.host.settled.bodies, clear(h, e), near]).toEqual([1, true, true]);
});
