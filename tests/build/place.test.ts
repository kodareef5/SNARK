// Placing by slot: what a look offers, and what the server makes of a frame and a key (shared/world/lattice/place.ts).

import { expect, test } from "bun:test";
import { FOUNDATION_THICK } from "../../content/building.ts";
import { PLANNED_FORMS, formBoxes } from "../../content/building/forms.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import type { Def } from "../../shared/content/defs.ts";
import { compileContent, type Registry } from "../../shared/content/registry.ts";
import { STRUCT_UNITS } from "../../shared/coords.ts";
import { PLACED_STRUCTURE, RESULT_FAR, RESULT_INVALID, RESULT_NOT_YOURS, RESULT_NO_SNAP, RESULT_NO_SUPPORT, RESULT_OBSTRUCTED, RESULT_OK, RESULT_TERRAIN, RESULT_TOO_HIGH } from "../../shared/net/protocol.ts";
import { Rng } from "../../shared/rng.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import { formHalf } from "../../shared/world/lattice/forms.ts";
import { poseOf, rotsOf, type LatticeKey, type LatticePose } from "../../shared/world/lattice/frames.ts";
import { CLS_EDGE, CLS_SQUARE, CLS_VERTEX, cellOf, elementCorners, facesOverlap, key0, key1, keyAnchor, keyCls, keyDir, keyLvl, keyM0, keyM3 } from "../../shared/world/lattice/module.ts";
import { OFFERS, SWITCH_MARGIN, candidates, choose, makeCandidates, makeVerdict, runKey, startBase, validate, validateFree, type Candidates, type Site } from "../../shared/world/lattice/place.ts";
import { MAX_BURIED, freePose, makeSockets, poseAt, restPose, slotAt, socketPose, socketsOf, units, type Pose } from "../../shared/world/snap.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { CHANGED, SOCKET_SLOTS } from "../fixtures/sockets.ts";
import { flatWorld, wrap, type TestWorld } from "../fixtures/world.ts";

const U = STRUCT_UNITS;
const TEAM = 7;
const key: LatticeKey = { fr: 0, k0: 0, k1: 0 };
const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
const made: LatticePose = { x: 0, y: 0, z: 0, yaw: 0, tw: 0 };
const out = makeCandidates();
const verdict = makeVerdict();

function siteOf(w: TestWorld, heightAt: (x: number, z: number) => number = (x, z) => w.hf.heightAt(x, z), turned = false): Site {
  return { structs: w.structs, tables: w.reg, heightAt, turned };
}

/** A row as whole lattice units: x, y, z, yaw. */
function rowOf(structs: StructureStore, ref: number): number[] {
  const t = structs.chunks[Math.floor(ref / 65536)]!;
  const s = ref & 0xffff;
  return [Math.round(t.x[s]! * U), Math.round(t.y[s]! * U), Math.round(t.z[s]! * U), t.yaw[s]!];
}

/** Sets `piece` down in socket `k` of `target` by its slot. */
function join(w: TestWorld, target: number, piece: string, k: number, turn = 0): number {
  const kind = w.kind(piece.includes(":") ? piece : `core:${piece}_wood`);
  if (!slotAt(w.structs, w.reg, target, kind, k, turn, key)) throw new Error(`no socket ${k} for ${piece}`);
  const ref = w.structs.place(kind, key.fr, key.k0, key.k1, TEAM, 1);
  if (ref < 0) throw new Error(`${piece} does not fit socket ${k}`);
  return ref;
}

/** The slots a look straight down onto (x, y, z) offers a piece of `kind`, into `out`. */
function lookDown(site: Site, kind: number, x: number, y: number, z: number, team = TEAM): number {
  return candidates(site, kind, team, x, y + 4, z, 0, -1, 0, 4, out);
}

/** Where a slot is among the candidates, whatever its turn, or -1. */
function indexOf(c: Candidates, fr: number, k0: number, k1: number): number {
  for (let i = 0; i < c.n; i++) if (c.fr[i] === fr && c.k0[i] === k0 && c.k1[i] === cellOf(k1)) return i;
  return -1;
}

const list = (c: Candidates): string[] => Array.from({ length: c.n }, (_, i) => `${c.fr[i]} ${c.k0[i]} ${c.k1[i]} ${c.score[i]}`);

test("every place a socket allows is offered as a slot with the socket's pose", () => {
  const sockets = makeSockets();
  let pairs = 0;
  for (const yaw of [0, 8048, 21384, 40000, 65535]) {
    const w = flatWorld(4);
    const { structs, reg } = w;
    const site = siteOf(w);
    for (const [targetName, pieceName, slots] of SOCKET_SLOTS) {
      // The target stands in a base of its own. A ceiling is off a wall's top, away from the foundation, so each of its slots is free.
      const base = structs.add(w.kind("core:foundation_wood"), 100, FOUNDATION_THICK / 2, 100, yaw, TEAM, 1);
      const scaffold = [base];
      if (targetName === "ceiling") scaffold.push(join(w, base, "wall", 0));
      if (targetName !== "foundation") scaffold.push(join(w, scaffold[scaffold.length - 1]!, targetName, 0));
      const target = scaffold[scaffold.length - 1]!;
      const [tx, ty, tz, tyaw] = rowOf(structs, target) as [number, number, number, number];
      const kind = w.kind(`core:${pieceName}_wood`);
      expect(socketsOf(structs, reg, target, kind, sockets)).toBe(slots.length);
      for (let k = 0; k < slots.length; k++) {
        for (let turn = 0; turn < reg.forms.turns[kind]!; turn++) {
          pairs++;
          socketPose(sockets, k, tx, ty, tz, tyaw, reg.role[kind]!, turn, pose);
          const today = [pose.x, pose.y, pose.z, pose.yaw];
          // A pillar under a foundation ends at its top plane, not its underside.
          if (`${targetName} ${pieceName} ${k}` === CHANGED) today[1] = today[1]! + units(FOUNDATION_THICK);
          expect(slotAt(structs, reg, target, kind, k, turn, key)).toBe(true);
          const name = `${targetName} ${pieceName} ${k} turn ${turn} yaw ${yaw}`;
          lookDown(site, kind, today[0]! / U, today[1]! / U, today[2]! / U);
          expect([name, indexOf(out, key.fr, key.k0, key.k1) >= 0]).toEqual([name, true]);
          const code = validate(site, kind, TEAM, key.fr, key.k0, key.k1, today[0]! / U, today[1]! / U + 2, today[2]! / U, verdict);
          expect([name, code, verdict.pose.x, verdict.pose.y, verdict.pose.z, verdict.pose.yaw]).toEqual([name, RESULT_OK, ...today]);
          expect(poseAt(structs, reg, target, kind, k, turn, pose)).toBe(true);
          expect([pose.x, pose.y, pose.z, pose.yaw]).toEqual(today);
        }
      }
      for (const ref of scaffold.reverse()) structs.remove(ref);
      expect(structs.count).toBe(0);
    }
  }
  expect(pairs).toBeGreaterThan(400);
});

test("what offers what is a table over layers; a lone foundation's slots", () => {
  expect(OFFERS.map((o) => `${o.from}>${o.to}`)).toEqual(["slab>slab", "slab>fill", "slab>wall", "slab>post", "slab>leaf", "wall>wall", "wall>slab", "wall>leaf", "post>post", "post>slab", "footing>wall"]);
  const w = flatWorld(4);
  const site = siteOf(w);
  w.structs.add(w.kind("core:foundation_wood"), 100, FOUNDATION_THICK / 2, 100, 3000, TEAM, 1);
  const count = (piece: string): number => lookDown(site, w.kind(`core:${piece}_wood`), 100, FOUNDATION_THICK, 100);
  // Four edges; four neighbours, a ceiling's level and a foundation's at each level the ground allows; nine points, on it and under it; itself.
  expect([count("wall"), count("ceiling"), count("foundation"), count("pillar"), count("stairs"), count("door")]).toEqual([4, 4, 16, 18, 1, 0]);
  // Level with its neighbour comes before any other level.
  lookDown(site, w.kind("core:foundation_wood"), 100, FOUNDATION_THICK, 100);
  expect(Array.from(out.k1.subarray(0, 16), keyLvl)).toEqual([0, 0, 0, 0, ...Array.from(out.k1.subarray(4, 16), keyLvl)]);
  expect(Array.from(out.k1.subarray(4, 16), keyLvl).every((l) => l !== 0)).toBe(true);
  // Another tribe is offered nothing of it, and nobody's survivor anything.
  expect([lookDown(site, w.kind("core:wall_wood"), 100, FOUNDATION_THICK, 100, 8), lookDown(site, w.kind("core:wall_wood"), 100, FOUNDATION_THICK, 100, 0)]).toEqual([0, 0]);
  // A thing has no slot.
  expect(lookDown(site, w.kind("core:storage_box"), 100, FOUNDATION_THICK, 100)).toBe(0);
});

test("two pieces offering one edge give one candidate; a taken edge is not offered", () => {
  const w = flatWorld(4);
  const { structs, reg } = w;
  const site = siteOf(w);
  const wall = w.kind("core:wall_wood");
  const a = structs.add(w.kind("core:foundation_wood"), 100, FOUNDATION_THICK / 2, 100, 0, TEAM, 1);
  const b = join(w, a, "foundation", 1);
  // The edge between them, looked at from over it: socket 1 of the first and socket 3 of the second.
  expect(slotAt(structs, reg, a, wall, 1, 0, key)).toBe(true);
  const shared = { ...key };
  expect(slotAt(structs, reg, b, wall, 3, 0, key)).toBe(true);
  expect([key.fr, key.k0, cellOf(key.k1)]).toEqual([shared.fr, shared.k0, cellOf(shared.k1)]);
  expect(lookDown(site, wall, 101.5, FOUNDATION_THICK, 100)).toBe(7);
  expect([indexOf(out, shared.fr, shared.k0, shared.k1), new Set(list(out).map((l) => l.split(" ").slice(0, 3).join(" "))).size]).toEqual([0, 7]);
  const built = structs.place(wall, shared.fr, shared.k0, shared.k1, TEAM, 1);
  expect(lookDown(site, wall, 101.5, FOUNDATION_THICK, 100)).toBe(7);
  // The edge is gone from the list and the edge over the wall has come to it.
  expect(indexOf(out, shared.fr, shared.k0, shared.k1)).toBe(-1);
  expect(Array.from(out.k1.subarray(0, out.n), keyLvl).filter((l) => l === 4).length).toBe(1);
  expect([validate(site, wall, TEAM, shared.fr, shared.k0, shared.k1, 101.5, 2, 100, verdict), verdict.detail, verdict.a]).toEqual([RESULT_OBSTRUCTED, PLACED_STRUCTURE, built]);
  // Turned the other way it is the same cell.
  expect(validate(site, wall, TEAM, shared.fr, shared.k0, (shared.k1 | (1 << 26)) >>> 0, 101.5, 2, 100, verdict)).toBe(RESULT_OBSTRUCTED);
});

const PLANNED = ["half_wall", "quarter_wall"] as const;
let wide: Registry | null = null;

/** The core content and two of the rows to come as kinds `test:<row>`. */
function plannedWorld(chunks = 4): TestWorld {
  if (!wide) {
    const defs = PLANNED.flatMap((name): Def[] => [
      { type: "shape", id: `test:shape_${name}`, role: "thing", boxes: formBoxes(PLANNED_FORMS[name]), form: PLANNED_FORMS[name] },
      { type: "structure", class: "piece", id: `test:${name}`, mesh: "shape", shape: `test:shape_${name}`, half: formHalf(PLANNED_FORMS[name]), color: 5, hp: 100, material: "core:mat_stone" },
    ]);
    const { registry, errors } = compileContent([...CORE_CONTENT, ...defs]);
    if (!registry) throw new Error(errors.join("\n"));
    wide = registry;
  }
  const flat = flatWorld(chunks);
  return wrap(flat.dims, flat.hf as Heightfield, wide);
}

test("a wall is not offered or taken where a taller piece covers that level", () => {
  const w = plannedWorld();
  const { structs, reg } = w;
  const site = siteOf(w);
  const wall = w.kind("core:wall_wood");
  const quarter = w.kind("test:quarter_wall");
  const a = structs.add(w.kind("core:foundation_wood"), 100, FOUNDATION_THICK / 2, 100, 0, TEAM, 1);
  // A whole wall on the east edge. A half wall on the west with a floor on it, half a storey up, whose east edge is the wall's.
  const tall = join(w, a, "wall", 1);
  structs.keyAt(tall, key);
  const east = { ...key };
  expect(slotAt(structs, reg, a, wall, 3, 0, key)).toBe(true);
  const half = structs.place(w.kind("test:half_wall"), key.fr, key.k0, key.k1, TEAM, 1);
  structs.keyAt(a, key);
  const floor = structs.place(w.kind("core:ceiling_wood"), key.fr, key.k0, key1(keyM3(key.k1), 2, 0, 0, 0, 0), TEAM, 1);
  expect([half >= 0, floor >= 0]).toEqual([true, true]);
  // The floor offers its edges at its own level: three are free, and the one the whole wall stands in is covered.
  const up = (k1: number, lvl: number): number => ((k1 & ~(511 << 10)) | ((lvl + 256) << 10)) >>> 0;
  lookDown(site, quarter, 100, FOUNDATION_THICK + 1.5, 100);
  const levels = Array.from(out.k1.subarray(0, out.n), keyLvl);
  expect([levels.filter((l) => l === 2).length, indexOf(out, east.fr, east.k0, up(east.k1, 2))]).toEqual([3, -1]);
  expect([validate(site, quarter, TEAM, east.fr, east.k0, up(east.k1, 2), 100, 2, 100, verdict), verdict.a]).toEqual([RESULT_OBSTRUCTED, tall]);
  // Over the whole wall there is room, and over the half wall too.
  expect(validate(site, quarter, TEAM, east.fr, east.k0, up(east.k1, 4), 100, 4, 100, verdict)).toBe(RESULT_OK);
  structs.keyAt(half, key);
  expect(validate(site, quarter, TEAM, key.fr, key.k0, up(key.k1, 2), 100, 3, 100, verdict)).toBe(RESULT_OK);
  expect(validate(site, wall, TEAM, key.fr, key.k0, up(key.k1, 1), 100, 3, 100, verdict)).not.toBe(RESULT_OK);
});

/** A house of two by two foundations with walls round it, a doorframe, stairs, a pillar and a floor over half, as slots of a frame at the origin of its first corner. */
function houseKeys(reg: Registry): [kind: number, k0: number, k1: number][] {
  const k = (name: string): number => reg.index.get(`core:${name}_wood`)!;
  const sq = (i: number, j: number, lvl: number, layer = 0, rot = 0): [number, number] => [key0(CLS_SQUARE, 2 * i, 0, 0), key1(2 * j, lvl, 0, layer, rot, 0)];
  const edge = (m0: number, m3: number, dir: number, lvl: number, rot = 0): [number, number] => [key0(CLS_EDGE, m0, 0, 0), key1(m3, lvl, dir, 2, rot, 0)];
  return [
    [k("foundation"), ...sq(0, 0, 0)], [k("foundation"), ...sq(1, 0, 0)], [k("foundation"), ...sq(0, 1, 0)], [k("foundation"), ...sq(1, 1, 0)],
    [k("doorframe"), ...edge(0, 0, 0, 0)], [k("wall"), ...edge(2, 0, 0, 0)], [k("wall"), ...edge(0, 4, 0, 0, 1)], [k("windowframe"), ...edge(2, 4, 0, 0, 1)],
    [k("wall"), ...edge(0, 0, 3, 0)], [k("wall"), ...edge(0, 2, 3, 0)], [k("wall"), ...edge(4, 0, 3, 0, 1)], [k("wall"), ...edge(4, 2, 3, 0, 1)],
    [k("stairs"), ...sq(1, 1, 0, 1, 2)], [k("pillar"), key0(CLS_VERTEX, 1, 0, 0), key1(1, 0, 0, 4, 0, 0)],
    [k("ceiling"), ...sq(0, 0, 4)], [k("ceiling"), ...sq(1, 0, 4)], [k("wall"), ...edge(0, 0, 0, 4)],
  ];
}

test("candidates and their order are the same on two stores built in different orders", () => {
  const rng = new Rng(4409);
  for (const yaw of [0, 9000, 31000]) {
    const a = flatWorld(4);
    const b = flatWorld(4);
    const rows = houseKeys(a.reg);
    for (const [w, order] of [[a, rows], [b, [rows[0]!, ...rows.slice(1).reverse()]]] as const) {
      const f = w.structs.frames.make(120 * U, units(FOUNDATION_THICK), 120 * U, yaw, TEAM);
      for (const [kind, k0, k1] of order) expect(w.structs.place(kind, f.gid, k0, k1, TEAM, 1)).toBeGreaterThanOrEqual(0);
    }
    const [sa, sb] = [siteOf(a), siteOf(b)];
    const other = makeCandidates();
    let offered = 0;
    for (let i = 0; i < 400; i++) {
      const kind = a.kind(`core:${["foundation", "wall", "ceiling", "pillar", "door", "stairs", "doorframe"][rng.int(7)]!}_wood`);
      const [ox, oy, oz] = [120 + rng.range(-6, 10), 1.6 + rng.range(0, 4), 120 + rng.range(-6, 10)];
      let [dx, dy, dz] = [rng.range(-1, 1), rng.range(-1, 0.3), rng.range(-1, 1)];
      const long = Math.sqrt(dx * dx + dy * dy + dz * dz);
      [dx, dy, dz] = [dx / long, dy / long, dz / long];
      const t = rng.range(0.5, 9);
      const n = candidates(sa, kind, TEAM, ox, oy, oz, dx, dy, dz, t, out);
      expect(candidates(sb, kind, TEAM, ox, oy, oz, dx, dy, dz, t, other)).toBe(n);
      expect(list(other)).toEqual(list(out));
      // No slot is there twice, and each is in order.
      expect(new Set(list(out).map((l) => l.split(" ").slice(0, 3).join(" "))).size).toBe(n);
      for (let k = 1; k < n; k++) expect(out.score[k]!).toBeGreaterThanOrEqual(out.score[k - 1]!);
      offered += n;
    }
    expect(offered).toBeGreaterThan(400);
  }
});

test("the slot shown is kept until another is 0.25 m better or it drops out", () => {
  const w = flatWorld(4);
  const site = siteOf(w);
  const wall = w.kind("core:wall_wood");
  w.structs.add(w.kind("core:foundation_wood"), 100, FOUNDATION_THICK / 2, 100, 0, TEAM, 1);
  // Nearer the north edge than the east one.
  lookDown(site, wall, 100.3, FOUNDATION_THICK, 100.6);
  const north = { fr: out.fr[0]!, k0: out.k0[0]!, k1: out.k1[0]! };
  expect([choose(out, 0, 0, 0), choose(out, north.fr, north.k0, north.k1)]).toEqual([0, 0]);
  // A little nearer the east edge now: the north one is second, and is still the one shown, whatever its turn.
  lookDown(site, wall, 100.5, FOUNDATION_THICK, 100.4);
  const second = indexOf(out, north.fr, north.k0, north.k1);
  expect([second, out.score[second]! - out.score[0]! < SWITCH_MARGIN, choose(out, north.fr, north.k0, (north.k1 | (1 << 26)) >>> 0)]).toEqual([1, true, 1]);
  // Well over to the east it gives way.
  lookDown(site, wall, 101.2, FOUNDATION_THICK, 100.2);
  const far = indexOf(out, north.fr, north.k0, north.k1);
  expect([far > 0, out.score[far]! - out.score[0]! > SWITCH_MARGIN, choose(out, north.fr, north.k0, north.k1)]).toEqual([true, true, 0]);
  // And when it is built on, the best takes its place.
  w.structs.place(wall, north.fr, north.k0, north.k1, TEAM, 1);
  lookDown(site, wall, 100.3, FOUNDATION_THICK, 100.6);
  expect([indexOf(out, north.fr, north.k0, north.k1), choose(out, north.fr, north.k0, north.k1), choose(makeCandidates(), 1, 2, 3)]).toEqual([-1, 0, -1]);
  expect(SWITCH_MARGIN).toBe(0.25);
});

test("a foundation beside a base is offered at each level the ground allows", () => {
  const w = flatWorld(4);
  const { structs } = w;
  const foundation = w.kind("core:foundation_wood");
  const base = structs.add(foundation, 100, 4 + FOUNDATION_THICK / 2, 100, 0, TEAM, 1);
  structs.keyAt(base, key);
  const beside = (i: number, lvl: number): [number, number] => [key0(CLS_SQUARE, 2 * i, 0, 0), key1(0, lvl, 0, 0, 0, 0)];
  const levels = (site: Site, i: number): number[] => {
    candidates(site, foundation, TEAM, 100 + 3 * i, 9, 100, 0, -1, 0, 4.6, out);
    return Array.from({ length: out.n }, (_, k) => k).filter((k) => keyM0(out.k0[k]!) === 2 * i && keyM3(out.k1[k]!) === 0).map((k) => keyLvl(out.k1[k]!));
  };
  // The base's top is 4.375 m up. The ground is level with its underside to the west, and climbs or falls away to the east.
  const flat = siteOf(w, () => 4);
  const rising = siteOf(w, (x) => 4 + Math.max(0, x - 101.5) * 0.8);
  const falling = siteOf(w, (x) => 4 - Math.max(0, x - 101.5) * 0.9);
  expect(levels(flat, 1)).toEqual([0, 1, -1, 2]);
  // Three metres on the ground is 2.4 m higher. Level with the base would be buried 2 m, and three levels up would stand 2.25 m over the low side.
  expect(levels(rising, 1)).toEqual([2]);
  expect(validate(rising, foundation, TEAM, key.fr, ...beside(1, 0), 103, 8, 100, verdict)).toBe(RESULT_TERRAIN);
  expect(validate(rising, foundation, TEAM, key.fr, ...beside(1, 1), 103, 8, 100, verdict)).toBe(RESULT_TERRAIN);
  expect(validate(rising, foundation, TEAM, key.fr, ...beside(1, 2), 103, 8, 100, verdict)).toBe(RESULT_OK);
  expect(validate(rising, foundation, TEAM, key.fr, ...beside(1, 3), 103, 8, 100, verdict)).toBe(RESULT_TOO_HIGH);
  // Where it falls 2.7 m, level with the base would stand 2.7 m over the low ground: only the level under it is offered.
  expect(levels(falling, 1)).toEqual([-1]);
  expect(validate(falling, foundation, TEAM, key.fr, ...beside(1, 0), 103, 6, 100, verdict)).toBe(RESULT_TOO_HIGH);
  expect(validate(falling, foundation, TEAM, key.fr, ...beside(1, -1), 103, 5, 100, verdict)).toBe(RESULT_OK);
  // A level is no neighbour's unless a foundation is: one two steps out is not offered.
  expect(validate(flat, foundation, TEAM, key.fr, ...beside(2, 0), 106, 6, 100, verdict)).toBe(RESULT_NO_SNAP);
  // A new base on open ground is never buried by its own rule; a pose under the ground is refused by name.
  expect(freePose(rising.heightAt, w.reg, foundation, 110, 100, 0, -4, pose)).toBe(true);
  expect(validateFree(rising, foundation, pose, 110, pose.y / U + 2, 100, verdict)).toBe(RESULT_OK);
  pose.y -= units(MAX_BURIED);
  expect(validateFree(rising, foundation, pose, 110, pose.y / U + 2, 100, verdict)).toBe(RESULT_TERRAIN);
  expect(MAX_BURIED).toBe(1);
});

test("a thing still rests on a floor, and what it overlaps is named", () => {
  const w = flatWorld(4);
  const { structs, reg } = w;
  const site = siteOf(w);
  const box = w.kind("core:storage_box");
  const f = structs.add(w.kind("core:foundation_wood"), 100, FOUNDATION_THICK / 2, 100, 0, TEAM, 1);
  expect(restPose(structs, reg, f, box, 100.4, 99.6, 0, pose)).toBe(true);
  expect(validateFree(site, box, pose, 100, 2, 100, verdict)).toBe(RESULT_OK);
  expect([verdict.pose.x, verdict.pose.y, verdict.pose.z]).toEqual([pose.x, pose.y, pose.z]);
  const first = structs.add(box, pose.x / U, pose.y / U, pose.z / U, 0, TEAM, 1);
  expect(structs.frameAt(first)).toBe(0);
  expect([validateFree(site, box, pose, 100, 2, 100, verdict), verdict.detail, verdict.a]).toEqual([RESULT_OBSTRUCTED, PLACED_STRUCTURE, first]);
  expect(restPose(structs, reg, f, box, 99.2, 100.5, 0, pose)).toBe(true);
  expect(validateFree(site, box, pose, 100, 2, 100, verdict)).toBe(RESULT_OK);
  expect(validateFree(site, box, pose, 100, 20, 100, verdict)).toBe(RESULT_FAR);
  // A wall is not set down where the box stands, and stairs are not set over it.
  expect(slotAt(structs, reg, f, w.kind("core:stairs_wood"), 0, 0, key)).toBe(true);
  expect([validate(site, w.kind("core:stairs_wood"), TEAM, key.fr, key.k0, key.k1, 100, 2, 100, verdict), verdict.a]).toEqual([RESULT_OBSTRUCTED, first]);
});

test("walls meeting at a base's corners never overlap, with no shrink", () => {
  const wall = "core:wall_wood";
  for (const yaw of [0, 4111, 12000, 29876, 50001]) {
    const w = flatWorld(4);
    const { structs, reg } = w;
    const site = siteOf(w);
    const base = structs.add(w.kind("core:foundation_wood"), 100, FOUNDATION_THICK / 2, 100, yaw, TEAM, 1);
    const cells = [base, join(w, base, "foundation", 0)];
    cells.push(join(w, cells[0]!, "foundation", 1), join(w, cells[1]!, "foundation", 1));
    // Every edge of a two by two base, the twelve of them, each offered by one cell or two.
    const lower: number[] = [];
    for (const cell of cells) {
      for (let k = 0; k < 4; k++) {
        expect(slotAt(structs, reg, cell, w.kind(wall), k, (k + lower.length) % 2, key)).toBe(true);
        const code = validate(site, w.kind(wall), TEAM, key.fr, key.k0, key.k1, 100, 3, 100, verdict);
        if (structs.refAt(key.fr, key.k0, key.k1) >= 0) expect(code).toBe(RESULT_OBSTRUCTED);
        else {
          expect([yaw, lower.length, code]).toEqual([yaw, lower.length, RESULT_OK]);
          lower.push(structs.place(w.kind(wall), key.fr, key.k0, key.k1, TEAM, 1));
        }
      }
    }
    expect(lower.length).toBe(12);
    // A wall over each, a pillar at each cell's middle and a floor over each cell.
    for (const under of lower) {
      expect(slotAt(structs, reg, under, w.kind(wall), 0, 0, key)).toBe(true);
      expect([yaw, validate(site, w.kind(wall), TEAM, key.fr, key.k0, key.k1, 100, 5, 100, verdict)]).toEqual([yaw, RESULT_OK]);
      expect(structs.place(w.kind(wall), key.fr, key.k0, key.k1, TEAM, 1)).toBeGreaterThanOrEqual(0);
    }
    for (const cell of cells) {
      for (const [piece, k] of [["pillar", 0], ["pillar", 1]] as const) {
        expect(slotAt(structs, reg, cell, w.kind(`core:${piece}_wood`), k, 0, key)).toBe(true);
        expect([yaw, piece, k, validate(site, w.kind(`core:${piece}_wood`), TEAM, key.fr, key.k0, key.k1, 100, 3, 100, verdict)]).toEqual([yaw, piece, k, RESULT_OK]);
        expect(structs.place(w.kind(`core:${piece}_wood`), key.fr, key.k0, key.k1, TEAM, 1)).toBeGreaterThanOrEqual(0);
      }
      // The floor lies on the pillar under it and on the walls round it.
      const pillar = structs.refAt(key.fr, key.k0, key1(keyM3(key.k1), 0, 0, 4, 0, 0));
      expect(slotAt(structs, reg, pillar, w.kind("core:ceiling_wood"), 0, 0, key)).toBe(true);
      expect([yaw, validate(site, w.kind("core:ceiling_wood"), TEAM, key.fr, key.k0, key.k1, 100, 5, 100, verdict)]).toEqual([yaw, RESULT_OK]);
      expect(structs.place(w.kind("core:ceiling_wood"), key.fr, key.k0, key.k1, TEAM, 1)).toBeGreaterThanOrEqual(0);
    }
    expect(structs.count).toBe(4 + 24 + 8 + 4);
    // Stairs are not set where a pillar stands in the middle of their floor.
    expect(slotAt(structs, reg, base, w.kind("core:stairs_wood"), 0, 0, key)).toBe(true);
    expect(validate(site, w.kind("core:stairs_wood"), TEAM, key.fr, key.k0, key.k1, 100, 3, 100, verdict)).toBe(RESULT_OBSTRUCTED);
  }
});

/** How far two rectangles in plan are into each other, in metres: each a middle, a yaw and half extents. Negative when apart. */
function into(ax: number, az: number, ayaw: number, ah: number, bx: number, bz: number, byaw: number, bh: number): number {
  const axes = [ayaw, byaw].flatMap((yaw) => {
    const a = (yaw / 65536) * 2 * Math.PI;
    return [[Math.cos(a), -Math.sin(a)], [Math.sin(a), Math.cos(a)]] as [number, number][];
  });
  let least = Infinity;
  for (const [nx, nz] of axes) {
    const reach = (yaw: number, h: number): number => {
      const a = (yaw / 65536) * 2 * Math.PI;
      return h * (Math.abs(Math.cos(a) * nx - Math.sin(a) * nz) + Math.abs(Math.sin(a) * nx + Math.cos(a) * nz));
    };
    least = Math.min(least, reach(ayaw, ah) + reach(byaw, bh) - Math.abs((bx - ax) * nx + (bz - az) * nz));
  }
  return least;
}

test("a second base at another yaw is refused only where the two really overlap", () => {
  const rng = new Rng(2718);
  let [refused, taken, close] = [0, 0, 0];
  for (const yaw of [0, 4111, 29876]) {
    const w = flatWorld(4);
    const { structs } = w;
    const site = siteOf(w);
    const foundation = w.kind("core:foundation_wood");
    const base = structs.add(foundation, 100, FOUNDATION_THICK / 2, 100, yaw, TEAM, 1);
    const cells = [base, join(w, base, "foundation", 0), join(w, base, "foundation", 1)];
    for (let i = 0; i < 400; i++) {
      const turned = rng.int(65536);
      const [x, z] = [100 + rng.range(-7, 8), 100 + rng.range(-7, 8)];
      [pose.x, pose.y, pose.z, pose.yaw] = [Math.round(x * U), units(FOUNDATION_THICK / 2), Math.round(z * U), turned];
      const code = validateFree(site, foundation, pose, x, 3, z, verdict);
      const deep = Math.max(...cells.map((ref) => {
        const [cx, , cz, cyaw] = rowOf(structs, ref) as [number, number, number, number];
        return into(pose.x / U, pose.z / U, turned, 1.5, cx / U, cz / U, cyaw, 1.5);
      }));
      // A built piece gives way 5 cm at each side: inside that band either answer is right.
      if (deep > 0.08) expect([yaw, i, code]).toEqual([yaw, i, RESULT_OBSTRUCTED]);
      else if (deep < 0) expect([yaw, i, code]).toEqual([yaw, i, RESULT_OK]);
      else close++;
      if (code === RESULT_OK) taken++;
      else refused++;
    }
  }
  expect([refused > 300, taken > 300, close < 40]).toEqual([true, true, true]);
});

test("far from a base's origin a real overlap is refused that the exact test passes", () => {
  // 194 sides along 30 degrees and 112 back along 120 end 0.75 cm over the edge 224 half-sides along the frame's own +X.
  const [along, back, out0] = [194, 112, 224];
  const A = new Int32Array(16);
  const B = new Int32Array(16);
  const m = new Int32Array(4);
  const judged: number[] = [];
  for (const yaw of [57600, 57988]) {
    const w = flatWorld(8);
    const { structs } = w;
    const site = siteOf(w, () => 3.9, true);
    const f = structs.frames.make(100 * U, 4 * U, 100 * U, yaw, TEAM);
    const foundation = w.kind("core:foundation_wood");
    const ceiling = w.kind("core:ceiling_wood");
    // One arm of the frame's own squares along +X, their tops' far edge on the axis.
    const first: number[] = [];
    for (let i = 0; i <= out0; i += 2) first.push(structs.place(foundation, f.gid, key0(CLS_SQUARE, i, 0, 0), key1(-2, 0, 0, 0, 0, 0), TEAM, 1));
    // The other of squares turned 30 degrees: out along that direction, then back down to the axis.
    const second: number[] = [];
    for (let j = 0; j < along; j += 2) second.push(structs.place(ceiling, f.gid, key0(CLS_SQUARE, 0, j, 0), key1(0, 0, 1, 0, 0, 0), TEAM, 1));
    for (let k = 0; k < back; k += 2) second.push(structs.place(ceiling, f.gid, key0(CLS_SQUARE, k, along, -k), key1(0, 0, 1, 0, 0, 0), TEAM, 1));
    expect([...first, ...second].every((ref) => ref >= 0)).toBe(true);
    // The last of it is offered by the one before, and its low corner is over the seam of the first arm's last two.
    const [k0, k1] = [key0(CLS_SQUARE, back, along, -back), key1(0, 0, 1, 0, 0, 0)];
    keyAnchor(k0, k1, m, 0);
    elementCorners(CLS_SQUARE, m, 0, 1, A, 0);
    const ends = first.slice(-2);
    for (const ref of ends) {
      structs.keyAt(ref, key);
      keyAnchor(key.k0, key.k1, m, 0);
      elementCorners(CLS_SQUARE, m, 0, 0, B, 0);
      // No shared area and no shared corner, as whole numbers have it.
      expect(facesOverlap(A, 0, 4, B, 0, 4)).toBe(false);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) expect(A.subarray(4 * i, 4 * i + 4).join() === B.subarray(4 * j, 4 * j + 4).join()).toBe(false);
    }
    poseOf(f, k0, k1, w.reg.forms, ceiling, made);
    const eye = [made.x / U, 6, made.z / U] as const;
    const code = validate(site, ceiling, TEAM, f.gid, k0, k1, ...eye, verdict);
    judged.push(code);
    // Where the two really are: the turned square's own +X is a twelfth of a turn on from its yaw.
    const deep = Math.max(...ends.map((ref) => {
      const [cx, , cz, cyaw] = rowOf(structs, ref) as [number, number, number, number];
      return into(made.x / U, made.z / U, made.yaw - 65536 / 12, 1.5, cx / U, cz / U, cyaw, 1.5);
    }));
    if (yaw === 57600) {
      // At this yaw the corner has drifted centimetres into the first arm.
      expect(deep).toBeGreaterThan(0.03);
      expect([code, verdict.detail, ends.includes(verdict.a)]).toEqual([RESULT_OBSTRUCTED, PLACED_STRUCTURE, true]);
      // Without turned slots it is not a place at all, and with the first arm's end gone it is a free one.
      expect(validate({ ...site, turned: false }, ceiling, TEAM, f.gid, k0, k1, ...eye, verdict)).toBe(RESULT_NO_SNAP);
      for (const ref of ends) structs.remove(ref);
      expect(validate(site, ceiling, TEAM, f.gid, k0, k1, ...eye, verdict)).toBe(RESULT_OK);
    } else {
      // At this one it has drifted the other way, and the piece is taken.
      expect(deep).toBeLessThan(0.02);
      expect(code).toBe(RESULT_OK);
    }
  }
  expect(judged).toEqual([RESULT_OBSTRUCTED, RESULT_OK]);
});

test("2,400 looks: a slot offered is taken or refused for what is built, never its key", () => {
  const rng = new Rng(8086);
  const w = flatWorld(4);
  const { structs, reg } = w;
  const site = siteOf(w);
  const names = ["foundation", "wall", "doorframe", "windowframe", "ceiling", "pillar", "door", "stairs"];
  structs.add(w.kind("core:foundation_wood"), 128, FOUNDATION_THICK / 2, 128, 7777, TEAM, 1);
  const codes = new Map<number, number>();
  const placed = new Map<string, number>();
  let offered = 0;
  for (let i = 0; i < 2400; i++) {
    const name = names[rng.int(names.length)]!;
    const kind = w.kind(`core:${name}_wood`);
    // A look from a survivor's eye height near the base, at something within reach.
    const [ox, oz] = [128 + rng.range(-9, 9), 128 + rng.range(-9, 9)];
    const oy = 1.6 + rng.int(3) * 3;
    const [tx, ty, tz] = [128 + rng.range(-9, 9), rng.range(0, 7), 128 + rng.range(-9, 9)];
    const long = Math.sqrt((tx - ox) ** 2 + (ty - oy) ** 2 + (tz - oz) ** 2);
    const n = candidates(site, kind, TEAM, ox, oy, oz, (tx - ox) / long, (ty - oy) / long, (tz - oz) / long, Math.min(long, 9), out);
    offered += n;
    if (n === 0) continue;
    const pick = rng.int(3) === 0 ? rng.int(n) : 0;
    const k1 = (out.k1[pick]! | (rng.int(rotsOf(reg.forms, kind)) << 26)) >>> 0;
    const code = validate(site, kind, TEAM, out.fr[pick]!, out.k0[pick]!, k1, ox, oy, oz, verdict);
    codes.set(code, (codes.get(code) ?? 0) + 1);
    expect([RESULT_OK, RESULT_OBSTRUCTED]).toContain(code);
    if (code !== RESULT_OK) continue;
    // What validate passes the store takes, where validate said it would stand.
    const ref = structs.place(kind, out.fr[pick]!, out.k0[pick]!, k1, TEAM, 1);
    expect(ref).toBeGreaterThanOrEqual(0);
    expect(rowOf(structs, ref)).toEqual([verdict.pose.x, verdict.pose.y, verdict.pose.z, verdict.pose.yaw]);
    placed.set(name, (placed.get(name) ?? 0) + 1);
    // And it is not offered again.
    expect(validate(site, kind, TEAM, out.fr[pick]!, out.k0[pick]!, k1, ox, oy, oz, verdict)).toBe(RESULT_OBSTRUCTED);
  }
  expect(offered).toBeGreaterThan(20000);
  expect(structs.frames.count).toBe(1);
  for (const name of names) expect([name, (placed.get(name) ?? 0) > 3]).toEqual([name, true]);
  expect(structs.count).toBeGreaterThan(300);
});

test("what the server refuses of a key before it looks at the world", () => {
  const w = flatWorld(4);
  const { structs, reg } = w;
  const site = siteOf(w);
  const wall = w.kind("core:wall_wood");
  const base = structs.add(w.kind("core:foundation_wood"), 100, FOUNDATION_THICK / 2, 100, 0, TEAM, 1);
  expect(slotAt(structs, reg, base, wall, 0, 0, key)).toBe(true);
  const judge = (kind: number, team: number, fr: number, k0: number, k1: number, ey = 2): number => validate(site, kind, team, fr, k0, k1, 100, ey, 100, verdict);
  expect(judge(wall, TEAM, key.fr, key.k0, key.k1)).toBe(RESULT_OK);
  // No such frame; another tribe's; nobody's.
  expect([judge(wall, TEAM, key.fr + 1, key.k0, key.k1), judge(wall, 8, key.fr, key.k0, key.k1), judge(wall, 0, key.fr, key.k0, key.k1)]).toEqual([RESULT_NO_SNAP, RESULT_NOT_YOURS, RESULT_NOT_YOURS]);
  // A key of another class or layer, a turn the form has not, a flip, a spare bit, a thing, no kind at all.
  const square = key0(CLS_SQUARE, 0, 0, 0);
  expect([
    judge(wall, TEAM, key.fr, square, key.k1), judge(wall, TEAM, key.fr, key.k0, (key.k1 | (1 << 23)) >>> 0), judge(wall, TEAM, key.fr, key.k0, (key.k1 | (2 << 26)) >>> 0),
    judge(wall, TEAM, key.fr, key.k0, (key.k1 | (1 << 28)) >>> 0), judge(wall, TEAM, key.fr, key.k0, (key.k1 | (1 << 29)) >>> 0), judge(w.kind("core:storage_box"), TEAM, key.fr, key.k0, key.k1), judge(0, TEAM, key.fr, key.k0, key.k1), judge(1e9, TEAM, key.fr, key.k0, key.k1),
  ]).toEqual([RESULT_INVALID, RESULT_INVALID, RESULT_INVALID, RESULT_INVALID, RESULT_INVALID, RESULT_INVALID, RESULT_INVALID, RESULT_INVALID]);
  // A sound key that nothing built offers: an edge two cells off, one half a side along, one turned 30 degrees, a level in the air.
  const edge = (m0: number, m3: number, dir: number, lvl: number): number => judge(wall, TEAM, key.fr, key0(CLS_EDGE, m0, 0, 0), key1(m3, lvl, dir, 2, 0, 0));
  expect([edge(0, 0, 0, 0), edge(6, 0, 0, 0), edge(1, 0, 0, 0), edge(0, 0, 1, 0), edge(0, 0, 0, 4), edge(0, 0, 0, 1)]).toEqual([RESULT_OK, RESULT_NO_SNAP, RESULT_NO_SNAP, RESULT_NO_SNAP, RESULT_NO_SNAP, RESULT_NO_SNAP]);
  // Off the end of the lattice and off the map are not places.
  expect(judge(wall, TEAM, key.fr, key0(CLS_EDGE, 510, 0, 0), key1(0, 0, 0, 2, 0, 0))).toBe(RESULT_INVALID);
  // Out of the eye's reach.
  expect(judge(wall, TEAM, key.fr, key.k0, key.k1, 40)).toBe(RESULT_FAR);
  // The site's own answers come last, in order: a body, the ground, another tribe, the cap, support.
  const asked: string[] = [];
  const all: Site = { ...site, body: () => (asked.push("body"), -1), enemy: () => (asked.push("enemy"), false), full: () => (asked.push("full"), false), stands: () => (asked.push("stands"), false) };
  expect(validate(all, wall, TEAM, key.fr, key.k0, key.k1, 100, 2, 100, verdict)).toBe(RESULT_NO_SUPPORT);
  expect(asked).toEqual(["body", "enemy", "full", "stands"]);
});

test("a row of pieces is its first key stepped whole sides along a direction", () => {
  const w = flatWorld(4);
  const { structs } = w;
  const site = siteOf(w);
  const base = structs.add(w.kind("core:foundation_wood"), 60, FOUNDATION_THICK / 2, 100, 0, TEAM, 1);
  structs.keyAt(base, key);
  const ceiling = w.kind("core:foundation_wood");
  const first = { fr: key.fr, k0: key0(CLS_SQUARE, 2, 0, 0), k1: key.k1 };
  // Each piece is offered by the one before it, so a row of 32 goes down in order and not out of it.
  expect(runKey(first.k0, first.k1, 0, 5, key)).toBe(true);
  expect(validate(site, ceiling, TEAM, first.fr, key.k0, key.k1, 78, 2, 100, verdict)).toBe(RESULT_NO_SNAP);
  for (let i = 0; i < 32; i++) {
    expect(runKey(first.k0, first.k1, 0, i, key)).toBe(true);
    expect([i, validate(site, ceiling, TEAM, first.fr, key.k0, key.k1, 63 + 3 * i, 2, 100, verdict)]).toEqual([i, RESULT_OK]);
    const ref = structs.place(ceiling, first.fr, key.k0, key.k1, TEAM, 1);
    expect(rowOf(structs, ref)).toEqual([(63 + 3 * i) * U, units(FOUNDATION_THICK / 2), 100 * U, 0]);
  }
  expect([keyM0(key.k0), keyDir(key.k1), keyCls(key.k0)]).toEqual([64, 0, CLS_SQUARE]);
  // Along another direction, and off the lattice's end.
  expect(runKey(first.k0, first.k1, 3, 2, key)).toBe(true);
  expect([keyM0(key.k0), keyM3(key.k1)]).toEqual([2, 4]);
  expect([runKey(first.k0, first.k1, 0, 254, key), runKey(first.k0, first.k1, 0, 255, key)]).toEqual([true, false]);
});

test("a new base is a frame of its own, with its first piece in its first slot", () => {
  const w = flatWorld(4);
  const { structs, reg } = w;
  const foundation = w.kind("core:foundation_wood");
  expect(freePose((x, z) => w.hf.heightAt(x, z), reg, foundation, 90.2, 70.4, 12345, 0, pose)).toBe(true);
  const a = startBase(structs, foundation, pose, TEAM, 1);
  expect(rowOf(structs, a)).toEqual([pose.x, pose.y, pose.z, pose.yaw]);
  // A second beside it at the same yaw is a second base: bases do not merge.
  pose.x += 3 * U;
  const b = startBase(structs, foundation, pose, TEAM, 1);
  expect([structs.frames.count, structs.frameAt(a) !== structs.frameAt(b), structs.frameAt(b) > 0]).toEqual([2, true, true]);
  structs.keyAt(b, key);
  expect([key.k0, key.k1]).toEqual([key0(CLS_SQUARE, 0, 0, 0), key1(0, 0, 0, 0, 0, 0)]);
  poseOf(structs.frames.get(key.fr)!, key.k0, key.k1, reg.forms, foundation, made);
  expect([made.x, made.y, made.z, made.yaw]).toEqual([pose.x, pose.y, pose.z, pose.yaw]);
});
