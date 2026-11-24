// Frames and keys in a save: a base comes back as the frame it was, by its rows' keys, in a few bytes a piece.

import { afterAll, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CORE_CONTENT } from "../../content/core.ts";
import { createHost } from "../../server/host.ts";
import { WorldStore } from "../../server/persist/store.ts";
import type { Def } from "../../shared/content/defs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import type { LatticeKey } from "../../shared/world/lattice/frames.ts";
import { CLS_SQUARE, key0, key1 } from "../../shared/world/lattice/module.ts";
import { Cells, formCells } from "../../shared/world/lattice/occupancy.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { Found, type StructureStore } from "../../shared/world/structures.ts";
import { boxBase, layBase } from "../../tools/bench/base.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";
import { start } from "../fixtures/slots.ts";
import { Base, dodecagon, mixedHouse, turnedWorld } from "../fixtures/turned.ts";
import { coreRegistry, flatWorld } from "../fixtures/world.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-savekeyed-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const MAP = writeMap(flatMap(12));
const cells = new Cells();
const key: LatticeKey = { fr: 0, k0: 0, k1: 0 };

/**
 * All a store holds of what was built: each live slot's row with its frame, key and turn class, each frame with its
 * counts and chunks, the cells taken, and how many keyed rows a cell of theirs does not name.
 */
function held(structs: StructureStore) {
  const rows: Record<number, number[][]> = {};
  let astray = 0;
  for (const c of structs.held) {
    const t = structs.chunks[c]!;
    for (let s = t.mapped; s < t.high; s++) {
      if (t.kind[s] === 0) continue;
      (rows[c] ??= []).push([s, t.kind[s]!, t.x[s]!, t.y[s]!, t.z[s]!, t.yaw[s]!, t.owner[s]!, t.hp[s]!, t.fr?.[s] ?? 0, t.k0?.[s] ?? 0, t.k1?.[s] ?? 0, t.tw?.[s] ?? 0]);
      if (!structs.keyAt(c * 65536 + s, key)) continue;
      formCells(structs.forms!, t.kind[s]!, key.k0, key.k1, cells);
      for (let i = 0; i < cells.n; i++) if (structs.refAt(key.fr, cells.k0[i]!, cells.k1[i]!) !== c * 65536 + s) astray++;
    }
  }
  const frames = [...structs.frames.all()].map((f) => [f.gid, f.ox, f.oy, f.oz, f.yaw, f.team, f.live, f.roots, ...[...f.chunks].sort((a, b) => a - b)]).sort((a, b) => a[0]! - b[0]!);
  return { rows, frames, cells: structs.occupied.size, astray };
}

/** The save's own table of frames: each gid and its team. */
function table(db: string): number[][] {
  const raw = new Database(db, { readonly: true });
  const rows = raw.query("SELECT gid, team FROM frames ORDER BY gid").all() as { gid: number; team: number }[];
  raw.close();
  return rows.map((r) => [r.gid, r.team]);
}

test("a save and a load leave every row, key, frame and cell as it was, and a base over chunks one frame", () => {
  const db = join(dir, "round.db");
  const h = new Harness({}, 1, 30, { map: MAP, dbPath: db });
  const structs = h.world.structs;
  const reg = h.reg;
  const [x0, z0] = [3 * CHUNK_SIZE, 6 * CHUNK_SIZE];
  const add = (pieces: ReturnType<typeof boxBase>, owner: number): number[] => layBase(structs, pieces, owner, (kind) => reg.maxHp[kind]!);
  // A base across a chunk border with a piece of it 300 m off, another team's, lone foundations, and things with no key.
  const a = add(boxBase(reg, "wood", x0 + 47.5, 120, z0 + 0.5, 10, 1, 1200), 7);
  const b = add(boxBase(reg, "stone", x0 + 2, 140, z0 + 40, 5, 2, 300), 8);
  const foundation = reg.index.get("core:foundation_wood")!;
  const gid = structs.frameAt(a[0]!);
  const far = structs.place(foundation, gid, key0(CLS_SQUARE, -140, 0, 0), key1(0, 0, 0, reg.forms.layer[foundation]!, 0, 0), 7, 50);
  expect([far >= 0, structs.frames.get(gid)!.chunks.length]).toEqual([true, 3]);
  const lone = [1, 2, 3].map((i) => start(h.world, foundation, x0 + 10 * i, 100 + i, z0 + 20, 1000 * i + 1, 7, reg.maxHp[foundation]!));
  const crate = reg.index.get("core:crate")!;
  structs.add(crate, x0 + 5, 100, z0 + 5, 777, 7, 3);
  structs.add(crate, x0 + 9, 100, z0 + 5, 778, 0, reg.maxHp[crate]!);
  // Pieces taken up leave holes in the slots, the first foundation of the second base among them; some are harmed, a
  // little and a lot; a door stands open; and the second base changes hands.
  for (const ref of [b[0]!, a[150]!, a[151]!, a[700]!, lone[1]!]) structs.remove(ref);
  for (const [i, part] of [[200, 0.001], [201, 0.4], [900, 0.77]] as const) structs.damage(a[i]!, reg.maxHp[structs.chunks[Math.floor(a[i]! / 65536)]!.kind[a[i]! & 0xffff]!]! * part);
  const door = a.find((ref) => structs.chunks[Math.floor(ref / 65536)]!.kind[ref & 0xffff] === reg.index.get("core:door_wood"))!;
  expect(structs.swap(door, reg.index.get("core:door_open_wood")!)).toBe(true);
  expect(structs.reown(8, 9)).toBeGreaterThan(200);
  // A frame made and gone before any commit still takes its number for good.
  structs.remove(start(h.world, foundation, x0 + 50, 100, z0 + 50, 4321, 7));
  h.run(2500);
  const before = held(structs);
  const next = structs.frames.next;
  expect([before.astray, before.frames.length, before.frames.find((f) => f[0] === gid)!.length - 8]).toEqual([0, 4, 3]);
  h.host.shutdown();
  expect(table(db)).toEqual(before.frames.map((f) => [f[0]!, f[5]!]));

  const again = new Harness({}, 1, 30, { map: MAP, dbPath: db });
  expect(held(again.world.structs)).toEqual(before);
  expect([again.world.structs.frames.next, again.world.structs.keyAt(far, key), key.fr]).toEqual([next, true, gid]);
  // The second base taken up whole: its frame leaves the save with its last row, and the rest load as they are.
  for (const ref of b) again.world.structs.remove(ref);
  again.run(500);
  const after = held(again.world.structs);
  expect(after.frames.map((f) => f[0])).toEqual(before.frames.map((f) => f[0]!).filter((g) => g !== structs.frameAt(b[1]!)));
  again.host.shutdown();
  expect(table(db)).toEqual(after.frames.map((f) => [f[0]!, f[5]!]));
  const third = new Harness({}, 1, 30, { map: MAP, dbPath: db });
  expect(held(third.world.structs)).toEqual(after);
  third.host.shutdown();
});

test("a keyed piece is 5 bytes or less on disk, a free row stays free, and a failed commit's frames are written by the next", () => {
  const w = flatWorld(4);
  const { structs, reg } = w;
  const pieces = boxBase(reg, "wood", 64.5, 20, 64.5, 21, 1, 5000);
  layBase(structs, pieces, 7, (kind) => reg.maxHp[kind]!);
  // A foundation with no key, as one set down by its pose is: where a slot of the base would be, and off it.
  const foundation = w.kind("core:foundation_wood");
  const chunk = structs.held[0]!;
  const t = structs.chunks[chunk]!;
  structs.put(chunk, t.high, foundation, t.x[0]!, t.y[0]! + 60, t.z[0]!, 0, 7, 9, t.version, 0);
  structs.put(chunk, t.high, foundation, 70, 5, 70.25, 99, 7, 9, t.version, 0);
  const db = join(dir, "bare.db");
  let store = new WorldStore(db, reg);
  const count = (name: string): number => (store.db.query(`SELECT count(*) AS n FROM ${name}`).get() as { n: number }).n;
  expect(() =>
    store.transaction(() => {
      store.saveChunk(chunk, structs);
      throw new Error("the disk is full");
    }),
  ).toThrow("the disk is full");
  expect([count("chunk_structs"), count("frames")]).toEqual([0, 0]);
  store.transaction(() => {
    store.saveChunk(chunk, structs);
    store.setMeta("tick", 1);
  });
  expect([count("chunk_structs"), count("frames")]).toEqual([1, 1]);
  // 1.57 bytes a piece where its pose, owner and health were 25.
  const bytes = (store.db.query("SELECT length(data) AS n FROM chunk_structs").get() as { n: number }).n;
  expect(bytes / 5000).toBeLessThanOrEqual(5);
  expect(bytes / 5000).toBeLessThanOrEqual(1.7);
  store.close();

  store = new WorldStore(db, reg);
  const loaded = flatWorld(4).structs;
  expect(store.loadChunks(loaded)).toBe(5002);
  expect(held(loaded)).toEqual(held(structs));
  expect([loaded.frames.count, loaded.frameAt(chunk * 65536 + t.high - 2), loaded.frameAt(chunk * 65536 + t.high - 1)]).toEqual([1, 0, 0]);
  // What was loaded is saved again as the same bytes, and nothing of its frame is written twice.
  const blob = (): Uint8Array => (store.db.query("SELECT data FROM chunk_structs").get() as { data: Uint8Array }).data;
  const first = blob();
  let wrote = 0;
  const frames = store as unknown as { putFrame: { run: (...a: unknown[]) => unknown } };
  const run = frames.putFrame.run.bind(frames.putFrame);
  frames.putFrame.run = (...a) => (wrote++, run(...a));
  store.transaction(() => store.saveChunk(chunk, loaded));
  expect([blob(), wrote]).toEqual([first, 0]);
  store.close();
});

test("pieces 30 and 60 degrees round in their base load turned so, in the grid cells they cover", () => {
  const w = turnedWorld(4);
  const { structs, reg } = w;
  const refs = [...mixedHouse(new Base(w, 60, 60, 5000)).refs, ...dodecagon(new Base(w, 130, 70, 61234), 1).refs];
  const classes = (of: StructureStore): number[] => refs.map((ref) => of.chunks[Math.floor(ref / 65536)]!.twAt(ref & 0xffff));
  expect([0, 1, 2].map((tw) => classes(structs).filter((c) => c === tw).length > 4)).toEqual([true, true, true]);
  const db = join(dir, "turned.db");
  let store = new WorldStore(db, reg);
  store.transaction(() => {
    for (const chunk of structs.held) store.saveChunk(chunk, structs);
    store.setMeta("tick", 1);
  });
  store.close();
  store = new WorldStore(db, reg);
  const loaded = turnedWorld(4).structs;
  expect(store.loadChunks(loaded)).toBe(refs.length);
  store.close();
  expect([held(loaded), classes(loaded)]).toEqual([held(structs), classes(structs)]);
  // What a body or a ray is tested against in each 2 m square round the two bases.
  const found = new Found();
  const listed = (of: StructureStore): string[] => {
    const out: string[] = [];
    for (let x = 40; x < 160; x += 2) {
      for (let z = 40; z < 100; z += 2) {
        const n = of.query(x, z, x + 2, z + 2, found);
        out.push([...found.refs.subarray(0, n)].sort((a, b) => a - b).join());
      }
    }
    return out;
  };
  expect(listed(loaded)).toEqual(listed(structs));
  expect(listed(structs).filter((cell) => cell !== "").length).toBeGreaterThan(40);
});

test("keyed pieces of content a build lacks are refused, or dropped with their frame when told to go on", () => {
  const core = coreRegistry();
  const ceiling = core.index.get("core:ceiling_stone")!;
  // A second kind of the ceiling's form, which a build may lack.
  const slab: Def = { type: "structure", class: "piece", id: "test:slab", mesh: "shape", shape: "core:shape_ceiling", half: [core.halfX[ceiling]!, core.halfY[ceiling]!, core.halfZ[ceiling]!], color: 5, hp: 100, material: "core:mat_stone" };
  const full = compileContent([...CORE_CONTENT, slab]).registry!;
  const db = join(dir, "lacking.db");
  const host = createHost(full, { dbPath: db });
  const structs = host.world.structs;
  const whole = structs.count;
  const kind = full.index.get("test:slab")!;
  const layer = full.forms.layer[kind]!;
  // A base that is all slabs, and one slab in a base of core pieces.
  const own = structs.frames.make(200 * 512, 30 * 512, 200 * 512, 0, 7);
  for (let i = 0; i < 4; i++) expect(structs.place(kind, own.gid, key0(CLS_SQUARE, 2 * i, 0, 0), key1(0, 0, 0, layer, 0, 0), 7, 100)).toBeGreaterThanOrEqual(0);
  const foundation = full.index.get("core:foundation_wood")!;
  const base = structs.frameAt(start(host.world, foundation, 300, 30, 300, 0, 7, 50));
  expect(structs.place(kind, base, key0(CLS_SQUARE, 0, 0, 0), key1(0, 8, 0, layer, 0, 0), 7, 100)).toBeGreaterThanOrEqual(0);
  host.shutdown();
  expect(table(db)).toEqual([[own.gid, 7], [base, 7]]);

  expect(() => createHost(core, { dbPath: db })).toThrow(/test:slab/);
  const forced = createHost(core, { dbPath: db, store: { allowMissingContent: true }, log: () => {} });
  const left = forced.world.structs;
  expect([left.count, left.frames.count, left.frames.get(base)!.live, left.occupied.size]).toEqual([whole + 1, 1, 1, 1]);
  // Its next commit takes the slabs and the frame that was all slabs out of the save for good.
  forced.shutdown();
  expect(table(db)).toEqual([[base, 7]]);
  const back = createHost(full, { dbPath: db });
  expect([back.world.structs.count, back.world.structs.frames.count, back.world.structs.frames.next > own.gid]).toEqual([whole + 1, 1, true]);
  back.shutdown();
});
