// The room flood and the renderer's finder answer as they did before they were made faster: each is walked beside a copy
// of itself from before (tests/fixtures/rooms-before), through the same random pieces coming and going, and every answer
// either gives is held equal to the other's.

import { expect, test } from "bun:test";
import { RoomFinder, Rooms } from "../../client/core/render/rooms.ts";
import { ALL_FORMS } from "../../content/building/forms.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { CHUNK_SIZE, STRUCT_UNITS, chunkCx, chunkCz } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import { makeFormTable, setForm, type FormDef } from "../../shared/world/lattice/forms.ts";
import { CLS_EDGE, CLS_SQUARE, CLS_TRIANGLE, CLS_VERTEX, DIRS, canon, canonical, dirTurn, key0, key1 } from "../../shared/world/lattice/module.ts";
import { Cells, Occupancy, formCells } from "../../shared/world/lattice/occupancy.ts";
import { Enclosure, SENSE_BODY, SENSE_SIGHT } from "../../shared/world/lattice/rooms.ts";
import type { StructureStore } from "../../shared/world/structures.ts";
import { Enclosure as EnclosureBefore } from "../fixtures/rooms-before/enclosure.ts";
import { RoomFinder as FinderBefore, Rooms as RoomsBefore } from "../fixtures/rooms-before/finder.ts";
import { coreRegistry, flatWorld } from "../fixtures/world.ts";

const ROWS: [string, FormDef][] = Object.entries(ALL_FORMS);
const forms = makeFormTable(ROWS.length + 1);
ROWS.forEach(([, f], i) => setForm(forms, i + 1, f));

type At = readonly [number, number, number, number];
const t = new Int32Array(16);
const cells = new Cells();

function keyOf(table: typeof forms, kind: number, cls: number, at: At, d: number, lvl: number, rot = 0): [number, number] {
  t.set(at);
  canonical(cls, t, 0, dirTurn(d, 0), t, 4);
  return [key0(cls, t[4]!, t[5]!, t[6]!), key1(t[7]!, lvl, canon.dir, table.layer[kind]!, rot, 0)];
}

const sq = (i: number, j: number): At => [2 * i, 0, 0, 2 * j];
const CLASS: Record<string, number> = { vertex: CLS_VERTEX, edge: CLS_EDGE, square: CLS_SQUARE, triangle: CLS_TRIANGLE };

/** What both floods hold that a caller can read: the flood found, what it says changed, and every ask of every face, edge and vertex. */
function answers(enc: Enclosure | EnclosureBefore, pieces: ReadonlyMap<number, [number, number, number]>): unknown {
  const w = enc.found;
  const counts = enc as unknown as { faces: number; edges: number; vertices: number };
  const asks: number[] = [];
  // Before, which air moved was said only of a flood that kept its cells.
  const kept = !enc.rebuilt;
  for (let g = 0; g < counts.faces; g++) for (const [lo, hi] of [[0, 4], [4, 8], [2, 6], [-1, 0], [8, 9], [0, 12]] as const) asks.push(enc.filled(g, lo, hi), enc.cornersFilled(g, lo, hi) ? 1 : 0, kept && enc.faceMoved(g) ? 1 : 0);
  for (let e = 0; e < counts.edges; e++) for (const [lo, hi] of [[0, 4], [4, 8], [2, 6], [7, 9]] as const) asks.push(enc.sideFilled(e, 0, lo, hi) ? 1 : 0, enc.sideFilled(e, 1, lo, hi) ? 1 : 0, enc.edgeFilled(e, lo, hi) ? 1 : 0, enc.edgeFilled(e, lo, hi, true) ? 1 : 0, kept && enc.edgeMoved(e) ? 1 : 0);
  for (let v = 0; v < counts.vertices; v++) asks.push(enc.roundFilled(v, 0, 4) ? 1 : 0, enc.roundFilled(v, 4, 8) ? 1 : 0);
  return {
    counts: [counts.faces, counts.edges, counts.vertices, w.cells, w.faces, w.rooms, w.inside, w.doors],
    said: [enc.stale, enc.changed, enc.rebuilt],
    face: Array.from(w.face.subarray(0, w.cells)),
    lo: Array.from(w.lo.subarray(0, w.cells)),
    hi: Array.from(w.hi.subarray(0, w.cells)),
    room: Array.from(w.room.subarray(0, w.cells)),
    rise: Array.from(w.rise.subarray(0, w.cells)),
    pass: Array.from(w.pass.subarray(0, w.cells)),
    first: Array.from(w.first.subarray(0, w.faces)),
    count: Array.from(w.count.subarray(0, w.faces)),
    doors: [Array.from(w.doorCell.subarray(0, w.doors)), Array.from(w.doorRef.subarray(0, w.doors)), Array.from(w.doorLeaf.subarray(0, w.doors)), Array.from(w.doorShut.subarray(0, w.doors))],
    rooms: enc.rooms(),
    borders: [...pieces].map(([, piece]) => enc.borders(...piece)),
    asks,
  };
}

test("the flood finds what it found before it was made faster, piece by piece", () => {
  // Every form on every place it fits of a house four squares by three with triangles along its south side, at the
  // levels of two storeys and between them.
  type Piece = [kind: number, cls: number, at: At, d: number, lvl: number, rot: number];
  const all: Piece[] = [];
  const offer = (cls: number, at: At, d: number, levels: readonly number[]): void => {
    ROWS.forEach(([, f], i) => {
      if (CLASS[f.cls] !== cls) return;
      for (const lvl of levels) for (let rot = 0; rot < (f.layer === "slab" && f.corner ? 4 : f.cls === "edge" && f.edges ? 2 : 1); rot++) all.push([i + 1, cls, at, d, lvl, rot]);
    });
  };
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) offer(CLS_SQUARE, sq(i, j), 0, [0, 2, 4, 6, 8]);
  for (let line = 0; line <= 4; line++) for (let c = 0; c < 4; c++) for (const [at, d] of [[sq(c, line), 0], [sq(line, c), 3]] as const) if ((d === 0 ? line <= 3 : c < 3)) offer(CLS_EDGE, at, d, [0, 2, 4, 8]);
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 3; j++) offer(CLS_VERTEX, sq(i, j), 0, [0, 4]);
  for (let i = 0; i < 4; i++) {
    const tip = [0, 1, 2, 3].map((k) => sq(i, 0)[k]! + 2 * DIRS[10 * 4 + k]!) as unknown as At;
    offer(CLS_TRIANGLE, sq(i, 0), 10, [0, 4, 8]);
    offer(CLS_EDGE, sq(i, 0), 10, [0, 4]);
    offer(CLS_EDGE, tip, 2, [0, 4]);
  }
  let steps = 0, rooms = 0, moved = 0, cut = 0;
  for (const sense of [SENSE_SIGHT, SENSE_BODY]) {
    const rng = new Rng(20261124 + sense);
    const taken = new Occupancy();
    const now = new Enclosure(forms, sense), before = new EnclosureBefore(forms, sense);
    const pieces = new Map<number, [number, number, number]>();
    const toggle = (index: number): void => {
      const [kind, cls, at, d, lvl, rot] = all[index]!;
      const [k0, k1] = keyOf(forms, kind, cls, at, d, lvl, rot);
      if (!formCells(forms, kind, k0, k1, cells)) return;
      if (pieces.has(index)) {
        for (let i = 0; i < cells.n; i++) taken.take(1, cells.k0[i]!, cells.k1[i]!);
        pieces.delete(index);
        now.remove(kind, k0, k1, index);
        before.remove(kind, k0, k1, index);
        return;
      }
      for (let i = 0; i < cells.n; i++) if (!taken.free(1, cells.k0[i]!, cells.k1[i]!, cells.reach[i]!)) return;
      for (let i = 0; i < cells.n; i++) taken.put(1, cells.k0[i]!, cells.k1[i]!, index, cells.reach[i]!);
      pieces.set(index, [kind, k0, k1]);
      expect(now.add(kind, k0, k1, index)).toBe(before.add(kind, k0, k1, index));
    };
    // The plain house first, so the walk is among rooms: floors, outer walls and ceilings. `inner` are what parts it into rooms.
    const plain = (name: string): number => ROWS.findIndex((r) => r[0] === name) + 1;
    const house: number[] = [], inner: number[] = [];
    all.forEach(([kind, cls, at, d, lvl], index) => {
      const straight = cls === CLS_EDGE && at[1] === 0 && at[2] === 0 && (d === 0 || d === 3) && (lvl === 0 || lvl === 4);
      const outer = straight && (d === 0 ? at[3] === 0 || at[3] === 6 : at[0] === 0 || at[0] === 8);
      if ((kind === plain("foundation") && lvl === 0) || (kind === plain("ceiling") && (lvl === 4 || lvl === 8)) || (kind === plain("wall") && outer)) house.push(index);
      else if (straight && [plain("wall"), plain("doorframe"), plain("door"), plain("windowframe")].includes(kind)) inner.push(index);
    });
    for (const index of house) toggle(index);
    for (let step = 0; step < 1500; step++, steps++) {
      // Mostly walls inside the plain house: a walk over every offer alone soon opens every room for good.
      // A floor or a ceiling of the plain house goes now and then too, which makes a cell two storeys high.
      for (let n = 1 + rng.int(3); step > 0 && n > 0; n--) {
        const pick = rng.int(8);
        toggle(pick === 0 ? house[rng.int(house.length)]! : pick < 6 ? inner[rng.int(inner.length)]! : rng.int(all.length));
      }
      if (step % 4 === 1) {
        // Cut into slices, both stop and go on alike.
        for (;;) {
          const a = now.flood(7), b = before.flood(7);
          expect(a).toBe(b);
          if (a) break;
          cut++;
        }
      } else {
        now.flood();
        before.flood();
      }
      expect(answers(now, pieces)).toEqual(answers(before, pieces));
      rooms = Math.max(rooms, now.found.rooms);
      if (now.changed && !now.rebuilt) moved++;
      // Now and then the plain house is mended and most else goes, so rooms close again.
      if (step % 40 !== 39) continue;
      for (const index of [...pieces.keys()]) if (rng.int(3) > 0 && !house.includes(index)) toggle(index);
      for (const index of house) if (!pieces.has(index)) toggle(index);
    }
  }
  expect([steps, rooms >= 3, moved > 50, cut > 100], `${rooms} rooms, ${moved} moved, ${cut} cut`).toEqual([3000, true, true, true]);
});

const U = STRUCT_UNITS;

/** A finder that takes each kind's own box for its mesh, of either making. */
function finders(reg: Registry): [RoomFinder, FinderBefore] {
  const n = reg.defs.length;
  const meshes = Array.from({ length: n }, (_, k) => ({ center: [0, 0, 0], half: [reg.halfX[k]!, reg.halfY[k]!, reg.halfZ[k]!] }));
  const meshOf = Uint16Array.from({ length: n }, (_, k) => k);
  return [new RoomFinder(reg, meshOf, meshes, []), new FinderBefore(reg, meshOf, meshes, [])];
}

/** All a finder left of a chunk that a caller reads. */
function left(table: { high: number }, rooms: Rooms | RoomsBefore, inside: boolean): unknown {
  return { inside, sorted: rooms.sorted, version: rooms.version, flag: rooms.inside, box: inside ? Array.from(rooms.box) : null, shell: inside ? Array.from(rooms.shell.subarray(0, table.high)) : null, doors: inside ? [...rooms.doors] : null, bases: rooms.bases.map((b) => [b.gid, b.moved, b.faces, b.enc.found.cells, b.enc.found.inside]) };
}

test("the renderer's finder leaves out what it left out before it was made faster", () => {
  const reg = coreRegistry();
  const k = (id: string): number => reg.index.get(`core:${id}`)!;
  const [now, before] = finders(reg);
  let steps = 0, hidden = 0, kept = 0, doors = 0;
  // A base along the lattice across a chunk's edge at x = 128, and one at an odd turn: each of rooms on two storeys.
  for (const [seed, x, z, yaw, tier] of [[5, 112, 100, 0, "wood"], [6, 150, 150, 5461, "stone"], [7, 40, 40, 0, "wood"]] as const) {
    const w = flatWorld(4);
    const structs: StructureStore = w.structs;
    const rng = new Rng(seed);
    const f = structs.frames.make(x * U, 192, z * U, yaw, 1);
    const [F, W, C, DF, D, WF, P, S, BOX] = [k(`foundation_${tier}`), k(`wall_${tier}`), k(`ceiling_${tier}`), k(`doorframe_${tier}`), k(`door_${tier}`), k(`windowframe_${tier}`), k(`pillar_${tier}`), k(`stairs_${tier}`), k("storage_box")];
    const [nx, nz] = seed === 7 ? [3, 3] : [6, 4];
    type Row = [kind: number, k0: number, k1: number];
    const offers: Row[] = [];
    const first: number[] = [];
    const standing = new Map<number, number>();
    const put = (index: number): void => {
      const ref = structs.place(offers[index]![0], f.gid, offers[index]![1], offers[index]![2], 1, 1000);
      if (ref >= 0) standing.set(index, ref);
    };
    const offer = (stands: boolean, kind: number, cls: number, at: At, d: number, lvl: number): void => {
      offers.push([kind, ...keyOf(reg.forms, kind, cls, at, d, lvl)]);
      if (stands) first.push(offers.length - 1);
      if (stands) put(offers.length - 1);
    };
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) offer(true, F, CLS_SQUARE, sq(i, j), 0, 0);
    for (const lvl of [0, 4]) {
      for (let line = 0; line <= Math.max(nx, nz); line++) {
        for (let c = 0; c < Math.max(nx, nz); c++) {
          for (const [at, d, outer, fits] of [[sq(c, line), 0, line === 0 || line === nz, c < nx && line <= nz], [sq(line, c), 3, line === 0 || line === nx, c < nz && line <= nx]] as const) {
            if (!fits) continue;
            // A window is open to sight, so the outer walls have none.
            const pick = rng.int(12);
            const kind = pick === 0 ? DF : pick === 1 && !outer ? WF : W;
            offer(outer || rng.int(3) === 0, kind, CLS_EDGE, at, d, lvl);
            if (kind === DF) offer(outer || rng.int(2) === 0, D, CLS_EDGE, at, d, lvl);
          }
        }
      }
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) offer(true, C, CLS_SQUARE, sq(i, j), 0, lvl + 4);
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) if (rng.int(8) === 0) offer(false, S, CLS_SQUARE, sq(i, j), 0, lvl);
      for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) if (rng.int(6) === 0) offer(rng.int(2) === 0, P, CLS_VERTEX, sq(i, j), 0, lvl);
    }
    // Boxes with no key, in the rooms and outside them.
    const boxes: number[] = [];
    const box = (): void => {
      const c = Math.cos((yaw / 65536) * 2 * Math.PI), s = Math.sin((yaw / 65536) * 2 * Math.PI);
      const u = rng.range(-2, 3 * nx + 2), v = rng.range(-2, 3 * nz + 2);
      boxes.push(structs.add(BOX, x + c * u + s * v, 0.375 + 3 * rng.int(2) + reg.halfY[BOX]!, z - s * u + c * v, yaw, 1, 100));
    };
    for (let i = 0; i < 12; i++) box();
    const keptNow = new Map<number, Rooms>(), keptBefore = new Map<number, RoomsBefore>();
    for (let step = 0; step < 400; step++, steps++) {
      // One piece or a few goes, comes or turns; now and then so many that the chunk is laid out afresh.
      for (let n = step % 50 === 49 ? 200 : 1 + rng.int(3); step > 0 && n > 0; n--) {
        const pick = rng.int(10);
        if (pick === 0 && boxes.length > 0) structs.remove(boxes.splice(rng.int(boxes.length), 1)[0]!);
        else if (pick === 1) box();
        else {
          const index = rng.int(offers.length), ref = standing.get(index);
          if (ref === undefined) put(index);
          else if (reg.opens[offers[index]![0]] !== 0 && rng.int(2) === 0) {
            const table = structs.chunks[Math.floor(ref / 65536)]!;
            structs.swap(ref, reg.opens[table.kind[ref & 0xffff]!]!);
            doors++;
          } else {
            structs.remove(ref);
            standing.delete(index);
          }
        }
      }
      // Now and then the base is mended, so its rooms close again.
      if (step % 20 === 19) for (const index of first) if (!standing.has(index)) put(index);
      for (const chunk of structs.held) {
        const table = structs.chunks[chunk]!;
        const x0 = chunkCx(structs.dims, chunk) * CHUNK_SIZE, z0 = chunkCz(structs.dims, chunk) * CHUNK_SIZE;
        // Every seventh step from nothing, as a chunk first seen.
        const fresh = step % 7 === 3;
        const a = fresh ? new Rooms() : (keptNow.get(chunk) ?? new Rooms()), b = fresh ? new RoomsBefore() : (keptBefore.get(chunk) ?? new RoomsBefore());
        keptNow.set(chunk, a);
        keptBefore.set(chunk, b);
        const insideNow = now.find(table, x0, z0, a, structs.frames), insideBefore = before.find(table, x0, z0, b, structs.frames);
        expect(left(table, a, insideNow)).toEqual(left(table, b, insideBefore));
        if (insideNow) {
          kept++;
          for (let s = 0; s < table.high; s++) if (table.kind[s] !== 0 && a.shell[s] === 0) hidden++;
        }
      }
    }
  }
  expect([steps, hidden > 1000, kept > 300, doors > 20], `${hidden} hidden, ${kept} kept, ${doors} doors`).toEqual([1200, true, true, true]);
});
