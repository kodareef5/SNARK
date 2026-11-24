// Piece placement arithmetic, which the client's preview and the server's check share.

import { expect, test } from "bun:test";
import { DOOR_HEIGHT, FLOOR_THICK, FOUNDATION_THICK, RISE, WALL_HEIGHT, WALL_THICK } from "../../content/building.ts";
import { slopeKind } from "../../content/slopes.ts";
import { STRUCT_UNITS } from "../../shared/coords.ts";
import { RESULT_OBSTRUCTED } from "../../shared/net/protocol.ts";
import { Rng } from "../../shared/rng.ts";
import { poseOf, type LatticeKey, type LatticePose } from "../../shared/world/lattice/frames.ts";
import { cellOf, keyLvl } from "../../shared/world/lattice/module.ts";
import { candidates, makeCandidates, makeVerdict, validateFree, type Site } from "../../shared/world/lattice/place.ts";
import { HALF_SIDE, MAX_ABOVE_GROUND, floorFace, floorTop, frameAxes, freePose, obstructed, restPose, tooHigh, units, type Pose } from "../../shared/world/snap.ts";
import { ROOF_RISE, ROOF_THICK, TRIANGLE_HALF, hullWorld } from "../fixtures/hulls.ts";
import { EAST, NORTH, SOUTH, WEST, count, join as joinTo, judge, poseIn, slot, start } from "../fixtures/slots.ts";
import { flatWorld, type TestWorld } from "../fixtures/world.ts";

const U = STRUCT_UNITS;
const Q = 16384;
const offered = makeCandidates();
const key: LatticeKey = { fr: 0, k0: 0, k1: 0 };

/** Builds a piece in place `k` of `target`, turned `turn`. Returns its ref. */
function join(w: TestWorld, target: number, piece: string, k: number, turn = 0): number {
  const ref = joinTo(w, target, w.kind(`core:${piece}`), k, turn);
  expect(ref).toBeGreaterThanOrEqual(0);
  return ref;
}

function siteOf(w: TestWorld): Site {
  return { structs: w.structs, tables: w.reg, heightAt: (x, z) => w.hf.heightAt(x, z) };
}

/** A structure's position in lattice units, and its yaw. */
function at(w: TestWorld, ref: number): [number, number, number, number] {
  const t = w.structs.chunks[Math.floor(ref / 65536)]!;
  const s = ref & 0xffff;
  return [units(t.x[s]!), units(t.y[s]!), units(t.z[s]!), t.yaw[s]!];
}

test("a frame's two axes are whole-number vectors, a quarter turn swaps them exactly, and any loop of pieces closes", () => {
  const a = new Int32Array(4);
  const b = new Int32Array(4);
  frameAxes(0, a);
  expect([...a]).toEqual([HALF_SIDE, 0, 0, HALF_SIDE]);
  const rng = new Rng(5);
  for (let i = 0; i < 2000; i++) {
    const yaw = rng.int(65536);
    frameAxes(yaw, a);
    expect(a[0]! * a[2]! + a[1]! * a[3]!).toBe(0);
    expect(Math.abs(Math.hypot(a[0]!, a[1]!) - HALF_SIDE)).toBeLessThan(1);
    frameAxes((yaw + Q) & 0xffff, b);
    expect([b[0], b[1], b[2], b[3]]).toEqual([-a[2]!, -a[3]!, a[0]!, a[1]!].map((v) => v + 0));
  }

  const w = flatWorld(4);
  for (let trial = 0; trial < 60; trial++) {
    const yaw = rng.int(65536);
    const first = start(w, w.kind("core:foundation_wood"), 128 + trial * 0.01, 0.1875, 128, yaw, 7);
    const home = at(w, first);
    let ref = first;
    let i = 0;
    let j = 0;
    const steps = [0, 1, 2, 3];
    const made: number[] = [];
    for (let s = 0; s < 40 || i !== 0 || j !== 0; s++) {
      // Wander for a while, then head home along one axis and then the other.
      const k = s < 40 ? steps[rng.int(4)]! : i > 0 ? 3 : i < 0 ? 1 : j > 0 ? 2 : 0;
      // A cell walked over before is the piece that is there: a slot holds one.
      expect(slot(w, ref, w.kind("core:foundation_wood"), k, 0, key)).toBe(true);
      const there = w.structs.refAt(key.fr, key.k0, cellOf(key.k1));
      ref = there >= 0 ? there : join(w, ref, "foundation_wood", k);
      if (there < 0) made.push(ref);
      if (k === 0) j++;
      else if (k === 1) i++;
      else if (k === 2) j--;
      else i--;
    }
    expect([ref, at(w, ref)]).toEqual([first, home]);
    for (const r of [first, ...made]) w.structs.remove(r);
  }
});

test("the places one piece offers another are the reference's: edge to edge, on edges, on tops, in doorways", () => {
  const w = flatWorld(4);
  const kind = (piece: string): number => w.kind(`core:${piece}_wood`);
  const half = (piece: string): number => w.reg.halfY[kind(piece)]!;
  const made: LatticePose = { x: 0, y: 0, z: 0, yaw: 0, tw: 0 };
  const axes = new Int32Array(4);
  /**
   * The slots a piece of `on`, alone in a base of its own, offers a piece of `held`: each as half-sides along the
   * piece's own X and Z from its middle to the slot's, and levels up from its own, sorted. `ground` lays it on the ground.
   */
  const offers = (on: string, held: string, ground = false): string[] => {
    const yaw = 7000;
    const target = start(w, kind(on), 100, ground ? half(on) : 6, 100, yaw, 7);
    const [tx, ty, tz] = at(w, target);
    w.structs.keyAt(target, key);
    const frame = w.structs.frames.get(key.fr)!;
    const level = keyLvl(key.k1);
    frameAxes(yaw, axes);
    const long = axes[0]! * axes[0]! + axes[1]! * axes[1]!;
    // A look straight down at its middle.
    const n = candidates(siteOf(w), kind(held), 7, 100, ty / U + 4, 100, 0, -1, 0, 4, offered);
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      poseOf(frame, offered.k0[i]!, offered.k1[i]!, w.reg.forms, kind(held), made);
      out.push(`${((made.x - tx) * axes[0]! + (made.z - tz) * axes[1]!) / long},${((made.x - tx) * axes[2]! + (made.z - tz) * axes[3]!) / long},${keyLvl(offered.k1[i]!) - level}`);
    }
    w.structs.remove(target);
    return out.sort();
  };
  const BESIDE = ["-2,0,0", "0,-2,0", "0,2,0", "2,0,0"];
  const SIDES = ["-1,0,0", "0,-1,0", "0,1,0", "1,0,0"];
  // Foundation to foundation is the four neighbours, at its own level and four either side of it. A ceiling off a floor is the four, tops level.
  const beside = offers("foundation", "foundation", true);
  expect([beside.filter((p) => p.endsWith(",0")), beside.length]).toEqual([BESIDE, 16]);
  expect([offers("foundation", "ceiling"), offers("ceiling", "ceiling")]).toEqual([BESIDE, BESIDE]);
  // A foundation joins nothing but a foundation.
  for (const on of ["ceiling", "wall", "pillar", "stairs", "door"]) expect([on, offers(on, "foundation", true)]).toEqual([on, []]);
  // A wall goes on each side of a floor, standing on it, or on a wall.
  expect([offers("foundation", "wall"), offers("ceiling", "wall"), offers("wall", "wall")]).toEqual([SIDES, SIDES, ["0,0,4"]]);
  // A ceiling on a wall has a side along the wall, to either hand, its top level with the wall's.
  expect(offers("wall", "ceiling")).toEqual(["0,-1,4", "0,1,4"]);
  // A pillar that begins a base stands on a corner of its squares: the four ceilings round its top are offered, and not one centred on it.
  expect(offers("pillar", "ceiling")).toEqual(["-1,-1,4", "-1,1,4", "1,-1,4", "1,1,4"]);
  // A pillar goes on a floor's middle, its corners and the middles of its sides, or under them; and on a pillar, or under it.
  const points = [-1, 0, 1].flatMap((i) => [-1, 0, 1].map((j) => `${i},${j}`));
  for (const on of ["foundation", "ceiling"]) expect([on, offers(on, "pillar")]).toEqual([on, [...points.map((p) => `${p},-4`), ...points.map((p) => `${p},0`)].sort()]);
  expect(offers("pillar", "pillar")).toEqual(["0,0,-4", "0,0,4"]);
  // Stairs go on a floor. A door goes in a doorway and nowhere else.
  expect([offers("foundation", "stairs"), offers("ceiling", "stairs"), offers("doorframe", "door"), offers("wall", "door")]).toEqual([["0,0,0"], ["0,0,0"], ["0,0,0"], []]);
  for (const on of ["foundation", "ceiling", "pillar"]) expect([on, offers(on, "door")]).toEqual([on, []]);
  // Nothing joins stairs or a door.
  for (const held of ["foundation", "wall", "ceiling", "pillar", "door", "stairs"]) expect([held, offers("stairs", held, true), offers("door", held, true)]).toEqual([held, [], []]);
  // The number of ways each may be turned in its slot.
  expect(["foundation", "wall", "ceiling", "pillar", "door", "stairs"].map((piece) => w.reg.forms.turns[kind(piece)])).toEqual([1, 2, 1, 1, 2, 4]);
});

test("a house built by joining pieces stands exactly: floors level, storeys in step, and the same place reached two ways is one place", () => {
  for (const yaw of [0, 5000, 16384, 23456, 40000, 65000]) {
    const w = flatWorld(4);
    const f00 = start(w, w.kind("core:foundation_stone"), 100, FOUNDATION_THICK / 2, 100, yaw, 7);
    const f01 = join(w, f00, "foundation_stone", 0);
    const f10 = join(w, f00, "foundation_stone", 1);
    const f11 = join(w, f01, "foundation_stone", 1);
    const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
    poseIn(w, f10, w.kind("core:foundation_stone"), 0, 0, pose);
    expect([pose.x, pose.y, pose.z]).toEqual(at(w, f11).slice(0, 3));
    // A wall on the first's south edge and one on its west. A ceiling from each lands in the same place over the first.
    const south = join(w, f00, "wall_stone", 2);
    const west = join(w, f00, "doorframe_stone", 3);
    const fromSouth: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
    const fromWest: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
    // Each wall faces out, so the side over the house is its own -Z, the second of its two places.
    poseIn(w, south, w.kind("core:ceiling_stone"), 1, 0, fromSouth);
    poseIn(w, west, w.kind("core:ceiling_stone"), 1, 0, fromWest);
    expect([fromSouth.x, fromSouth.y, fromSouth.z]).toEqual([fromWest.x, fromWest.y, fromWest.z]);
    const [fx, fy, fz] = at(w, f00);
    expect([fromSouth.x, fromSouth.z]).toEqual([fx, fz]);
    expect(fromSouth.y + units(FLOOR_THICK / 2)).toBe(fy + units(FOUNDATION_THICK / 2) + units(RISE));
    const stairs = join(w, f01, "stairs_stone", 0, 3);
    expect(at(w, stairs)[1] + units(RISE / 2)).toBe(fromSouth.y + units(FLOOR_THICK / 2));
    expect(at(w, stairs)[3]).toBe((yaw + 3 * Q) & 0xffff);
    const pillar = join(w, f10, "pillar_stone", 0);
    const onPillar: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
    poseIn(w, pillar, w.kind("core:ceiling_stone"), 0, 0, onPillar);
    expect(onPillar.y).toBe(fromSouth.y);
    expect([onPillar.x, onPillar.z]).toEqual(at(w, f10).filter((_v, i) => i === 0 || i === 2));
    const door = join(w, west, "door_stone", 0, 1);
    expect(at(w, door)[1] - units(DOOR_HEIGHT / 2)).toBe(fy + units(FOUNDATION_THICK / 2));
    expect([at(w, door)[0], at(w, door)[2]]).toEqual([at(w, west)[0], at(w, west)[2]]);
    expect(at(w, door)[3]).toBe((at(w, west)[3] + 2 * Q) & 0xffff);
    const upper = join(w, south, "wall_stone", 0);
    expect(at(w, upper)).toEqual([at(w, south)[0], at(w, south)[1] + units(WALL_HEIGHT), at(w, south)[2], at(w, south)[3]]);
    expect(poseIn(w, f00, w.kind("core:wall_stone"), 4, 0, pose)).toBe(false);
    expect(poseIn(w, f00, w.kind("core:door_stone"), 0, 0, pose)).toBe(false);
    expect(poseIn(w, south, w.kind("core:door_stone"), 0, 0, pose)).toBe(false);
    expect(poseIn(w, 123456, w.kind("core:wall_stone"), 0, 0, pose)).toBe(false);
    expect(count(w, f00, w.kind("core:block"))).toBe(0);
  }
});

test("what is in the way: the same place twice, a ceiling over stairs, a pillar in them; not neighbours, corners or a door in its frame", () => {
  const w = flatWorld(4);
  const f = start(w, w.kind("core:foundation_wood"), 100, FOUNDATION_THICK / 2, 100, 3000, 7);
  const site = siteOf(w);
  /** Whether the server would refuse the piece for what is built in its way. */
  const blocked = (target: number, piece: string, k: number, turn = 0): boolean => {
    const code = judge(site, w.reg, target, w.kind(`core:${piece}`), k, turn);
    expect(code).toBeGreaterThanOrEqual(0);
    return code === RESULT_OBSTRUCTED;
  };
  expect(blocked(f, "foundation_wood", 0)).toBe(false);
  const n = join(w, f, "foundation_wood", 0);
  expect(blocked(f, "foundation_wood", 0)).toBe(true);
  expect(blocked(n, "foundation_wood", 2)).toBe(true);
  const walls = [0, 1, 2, 3].map((k) => {
    expect(blocked(f, k === 1 ? "doorframe_wood" : "wall_wood", k)).toBe(false);
    return join(w, f, k === 1 ? "doorframe_wood" : "wall_wood", k);
  });
  expect(blocked(f, "wall_wood", 0)).toBe(true);
  expect(blocked(f, "windowframe_wood", 2, 1)).toBe(true);
  expect(blocked(walls[1]!, "door_wood", 0)).toBe(false);
  join(w, walls[1]!, "door_wood", 0);
  expect(blocked(walls[1]!, "door_wood", 0, 1)).toBe(true);
  expect(blocked(f, "stairs_wood", 0)).toBe(false);
  expect(blocked(f, "pillar_wood", 0)).toBe(false);
  join(w, f, "stairs_wood", 0);
  expect(blocked(f, "pillar_wood", 0)).toBe(true);
  expect(blocked(walls[0]!, "ceiling_wood", 1)).toBe(true);
  // Over the neighbour, where there are no stairs, a ceiling fits, and so does a ceiling off its edge.
  const wallN = join(w, n, "wall_wood", 0);
  expect(blocked(wallN, "ceiling_wood", 1)).toBe(false);
  const c = join(w, wallN, "ceiling_wood", 1);
  expect(blocked(c, "ceiling_wood", 0)).toBe(false);
  expect(blocked(wallN, "ceiling_wood", 1)).toBe(true);
  // A structure built at another angle obstructs where it crosses a place, and not elsewhere.
  const g = flatWorld(4);
  const base = start(g, g.kind("core:foundation_wood"), 100, FOUNDATION_THICK / 2, 100, 0, 7);
  g.structs.add(g.kind("core:block"), 103.6, 1, 100, 8000, 0, 1);
  expect(judge(siteOf(g), g.reg, base, g.kind("core:foundation_wood"), EAST) === RESULT_OBSTRUCTED).toBe(true);
  expect(judge(siteOf(g), g.reg, base, g.kind("core:foundation_wood"), WEST) === RESULT_OBSTRUCTED).toBe(false);
});

test("a look is offered the places near where it ends, the nearest first, of whatever piece offers them", () => {
  const w = flatWorld(4);
  const f = start(w, w.kind("core:foundation_wood"), 100, FOUNDATION_THICK / 2, 100, 0, 7);
  const far = start(w, w.kind("core:foundation_wood"), 109, FOUNDATION_THICK / 2, 100, 0, 7);
  const site = siteOf(w);
  const wall = w.kind("core:wall_wood");
  /** A look straight down that ends at (x, y, z). Returns how many places it is offered. */
  const look = (kind: number, x: number, y: number, z: number): number => candidates(site, kind, 7, x, y + 5, z, 0, -1, 0, 5, offered);
  /** Which place of `target` the look's `i`th slot is, or -1. */
  const place = (target: number, kind: number, i: number): number => {
    for (let k = 0; k < count(w, target, kind); k++) if (slot(w, target, kind, k, 0, key) && key.fr === offered.fr[i] && key.k0 === offered.k0[i] && cellOf(key.k1) === offered.k1[i]) return k;
    return -1;
  };
  // Looking at the foundation near its north side puts that side first for a wall, then the nearer of the others.
  expect(look(wall, 100.4, FOUNDATION_THICK, 101.2)).toBe(4);
  expect([0, 1, 2, 3].map((i) => place(f, wall, i))).toEqual([NORTH, EAST, WEST, SOUTH]);
  look(wall, 98.7, FOUNDATION_THICK, 99.9);
  expect(place(f, wall, 0)).toBe(WEST);
  // A look that ends on the ground beside a base is offered its nearest side, and between two bases the nearer one's.
  look(wall, 102.4, 0, 100.2);
  expect(place(f, wall, 0)).toBe(EAST);
  look(wall, 106.8, 0, 100.2);
  expect(place(far, wall, 0)).toBe(WEST);
  look(w.kind("core:foundation_wood"), 103, 0, 100);
  expect(place(f, w.kind("core:foundation_wood"), 0)).toBe(EAST);
  expect(look(wall, 130, 0, 130)).toBe(0);
  // A door has no place anywhere until a doorframe is built, and then its one place in it.
  expect(look(w.kind("core:door_wood"), 100, FOUNDATION_THICK, 100)).toBe(0);
  const frame = join(w, f, "doorframe_wood", SOUTH);
  expect(look(w.kind("core:door_wood"), 100, FOUNDATION_THICK, 100)).toBe(1);
  expect(place(frame, w.kind("core:door_wood"), 0)).toBe(0);
});

test("on open ground: a foundation's top a little above the highest ground under it, raised or lowered by steps, a pillar's foot in the ground, and nothing else", () => {
  const w = flatWorld(4);
  const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
  const flat = (): number => 0;
  const foundation = w.kind("core:foundation_stone");
  expect(freePose(flat, w.reg, foundation, 50.2501, 60.5, 12345, 0, pose)).toBe(true);
  expect([pose.x, pose.z, pose.yaw]).toEqual([Math.round(50.2501 * U), 60.5 * U, 12345]);
  expect((pose.y + units(FOUNDATION_THICK / 2)) / U).toBe(0.125);
  freePose(flat, w.reg, foundation, 50, 60, 0, 3, pose);
  expect((pose.y + units(FOUNDATION_THICK / 2)) / U).toBe(0.5);
  freePose(flat, w.reg, foundation, 50, 60, 0, -100, pose);
  expect((pose.y + units(FOUNDATION_THICK / 2)) / U).toBe(0.125 - 4 / 8);
  freePose(flat, w.reg, foundation, 50, 60, 0, 100, pose);
  expect((pose.y + units(FOUNDATION_THICK / 2)) / U).toBe(0.125 + 8 / 8);
  // On a slope rising east by one in four it is level, and clear of the ground at its highest corner.
  const slope = (x: number): number => x / 4;
  freePose(slope, w.reg, foundation, 40, 60, 0, 0, pose);
  expect((pose.y + units(FOUNDATION_THICK / 2)) / U).toBeCloseTo(41.5 / 4 + 0.125, 2);
  expect(tooHigh(slope, w.reg, foundation, pose)).toBe(false);
  // Turned an eighth, its corners reach farther east, so it stands higher.
  const square = pose.y;
  freePose(slope, w.reg, foundation, 40, 60, 8192, 0, pose);
  expect(pose.y).toBeGreaterThan(square);
  // Joined on down a steeper slope, a foundation is soon left in the air, which is refused.
  const steep = (x: number): number => -x / 2;
  const high: Pose = { x: 40 * U, y: units(-19.25 + 0.125) - units(FOUNDATION_THICK / 2), z: 60 * U, yaw: 0 };
  expect(tooHigh(steep, w.reg, foundation, high)).toBe(false);
  high.x += 2 * HALF_SIDE;
  expect(tooHigh(steep, w.reg, foundation, high)).toBe(true);
  expect(MAX_ABOVE_GROUND).toBe(2);
  // Only a foundation has that rule.
  expect(tooHigh(steep, w.reg, w.kind("core:ceiling_stone"), high)).toBe(false);
  expect(freePose(flat, w.reg, w.kind("core:pillar_stone"), 50, 60, 0, 0, pose)).toBe(true);
  expect((pose.y - units(WALL_HEIGHT / 2)) / U).toBe(-0.125);
  for (const piece of ["wall_stone", "ceiling_stone", "stairs_stone", "door_stone", "doorframe_stone"]) expect(freePose(flat, w.reg, w.kind(`core:${piece}`), 50, 60, 0, 0, pose)).toBe(false);
});

test("a sloped piece is in the way where its parts are and not where its box holds air, and is not in the way of what only touches it, at any facing", () => {
  const w = hullWorld();
  const ramp = w.kind("test:ramp");
  const box = w.kind("core:storage_box");
  const wall = w.kind("core:wall_stone");
  const site = siteOf(w);
  const verdict = makeVerdict();
  /** Whether the server would refuse the piece, set down by this pose and joined to nothing, for what is built in its way. */
  const blocked = (kind: number, x: number, y: number, z: number, yaw = 0): boolean => validateFree(site, kind, { x: units(x), y: units(y), z: units(z), yaw }, x, y, z, verdict) === RESULT_OBSTRUCTED;
  // A ramp a storey high on flat ground, rising toward +Z: its slope is y = z - 98.5 between z = 98.5 and 101.5.
  const r = w.structs.add(ramp, 100, 1.5, 100, 0, 7, 1);
  expect(blocked(box, 100, 0.5, 101)).toBe(true);
  // Over its low end, in the air its box holds.
  expect(blocked(box, 100, 2, 99)).toBe(false);
  // Before its foot, beside it, beyond its high end.
  expect(blocked(box, 100, 0.3125, 98.1)).toBe(false);
  expect(blocked(box, 102.05, 0.3125, 100)).toBe(false);
  expect(blocked(box, 100, 0.3125, 101.9)).toBe(false);
  // A wall across it, either way round, and a second ramp half on it; not one beside it or one going on from its top.
  expect(blocked(wall, 100, 1.5, 100, Q)).toBe(true);
  const across = w.structs.add(wall, 100, 1.5, 100, Q, 7, 1);
  w.structs.remove(r);
  expect(blocked(ramp, 100, 1.5, 100)).toBe(true);
  w.structs.remove(across);
  w.structs.add(ramp, 100, 1.5, 100, 0, 7, 1);
  expect(blocked(ramp, 100, 1.5, 101.5)).toBe(true);
  expect(blocked(ramp, 103, 1.5, 100)).toBe(false);
  expect(blocked(ramp, 100, 4.5, 103)).toBe(false);

  // A ramp on a foundation, rising from the edge of a second to a ceiling a storey up, a wall along its side: each fits among
  // the others wherever the first was turned, and moved a little into one of them, it does not.
  const axes = new Int32Array(4);
  for (let yaw = 0; yaw < 4 * Q; yaw += 1531) {
    frameAxes(yaw, axes);
    const at = (i: number, j: number): [number, number] => [(150 * U + i * axes[0]! + j * axes[2]!) / U, (150 * U + i * axes[1]! + j * axes[3]!) / U];
    // Each piece, and how far it is moved across the ramp, up, and up the ramp to go into a neighbour.
    const put = (id: string, [x, z]: [number, number], y: number, turn: number, by: [number, number, number]) => ({ k: w.kind(id), x, y, z, a: (yaw + turn) & 0xffff, by });
    const set = [
      put("core:foundation_stone", at(0, 0), FOUNDATION_THICK / 2, 0, [0, 0, 0.5]),
      put("core:foundation_stone", at(0, 2), FOUNDATION_THICK / 2, 0, [0, 0.2, 0]),
      put("test:ramp", at(0, 2), FOUNDATION_THICK + 1.5, 0, [0, -0.2, 0]),
      put("core:ceiling_stone", at(0, 4), FOUNDATION_THICK + 3 - FLOOR_THICK / 2, 0, [0, -0.25, -0.5]),
      // Beside the ramp and touching it: a wall on the foundation's own side would stand half its thickness into the ramp's.
      put("core:wall_stone", at(1 + WALL_THICK / 2 / 1.5, 2), FOUNDATION_THICK + 1.5, Q, [-0.5, 0, 0]),
    ];
    for (let left = 0; left < set.length; left++) {
      const refs = set.flatMap((p, i) => (i === left ? [] : [w.structs.add(p.k, p.x, p.y, p.z, p.a, 7, 1)]));
      const { k, x, y, z, a, by } = set[left]!;
      const mx = (by[0] * axes[0]! + by[2] * axes[2]!) / HALF_SIDE;
      const mz = (by[0] * axes[1]! + by[2] * axes[3]!) / HALF_SIDE;
      expect([yaw, left, blocked(k, x, y, z, a), blocked(k, x + mx, y + by[1], z + mz, a)]).toEqual([yaw, left, false, true]);
      for (const ref of refs) w.structs.remove(ref);
    }
  }
});

test("a large new piece is asked against what stands under its far end, past the 3 m a building piece reaches", () => {
  const w = flatWorld(4);
  const roof = w.kind(slopeKind("roof"));
  const box = w.kind("core:storage_box");
  // An 8 m pitched roof whose middle is at (96.9, 96.9); a box in its ridge 3.6 m east of that, in the next 4 m cell.
  w.structs.add(box, 100.5, 6.25, 96.9, Q, 7, 1);
  expect(obstructed(w.structs, w.reg.parts, roof, 96.9, 5, 96.9, 0)).toBe(true);
  expect(obstructed(w.structs, w.reg.parts, roof, 96.9, 7, 96.9, 0)).toBe(false);
});

test("a thing is set on a floor's top under its middle: a box's within a side square, a part's where the part is and only where it is level", () => {
  const w = hullWorld();
  const box = w.kind("core:storage_box");
  const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
  const lift = units(0.3125);
  // A foundation of boxes, as before.
  const f = start(w, w.kind("core:foundation_stone"), 50, FOUNDATION_THICK / 2, 50, 0, 7);
  expect(restPose(w.structs, w.reg, f, box, 50.4, 49.2, 0, pose)).toBe(true);
  expect([pose.x, pose.y, pose.z]).toEqual([units(50.4), units(FOUNDATION_THICK) + lift, units(49.2)]);
  expect(restPose(w.structs, w.reg, f, box, 52, 50, 0, pose)).toBe(false);
  // A triangle, its corner at its origin and its top level: on it, and not on the rest of the square about that corner.
  const tri = w.structs.add(w.kind("test:triangle"), 100, TRIANGLE_HALF, 100, 0, 7, 1);
  expect(restPose(w.structs, w.reg, tri, box, 101.5, 100.8, 0, pose)).toBe(true);
  expect(pose.y).toBe(units(2 * TRIANGLE_HALF) + lift);
  expect([floorTop(w.structs, w.reg, tri, units(101.5), units(100.8)), floorFace.level]).toEqual([units(2 * TRIANGLE_HALF), true]);
  for (const [x, z] of [[99, 99], [102.8, 102.4], [100.2, 101.4]]) expect([x, z, restPose(w.structs, w.reg, tri, box, x!, z!, 0, pose)]).toEqual([x, z, false]);
  // A sloped roof slab: its top is found where the thing would be, rising with the slope, but nothing is set on it.
  const roof = w.structs.add(w.kind("test:roof"), 150, 6, 150, 0, 7, 1);
  for (const z of [-1, 0, 1.2]) {
    const top = floorTop(w.structs, w.reg, roof, units(150.3), units(150 + z));
    expect(top / U).toBeCloseTo(6 + (z * ROOF_RISE) / 3 + ROOF_THICK / 2, 2);
    expect(floorFace.level).toBe(false);
    expect(restPose(w.structs, w.reg, roof, box, 150.3, 150 + z, 0, pose)).toBe(false);
  }
  expect(floorTop(w.structs, w.reg, roof, units(152), units(150))).toBeNaN();
  // Nor on what is no floor.
  const r = w.structs.add(w.kind("test:ramp"), 200, 1.5, 200, 0, 7, 1);
  expect(floorTop(w.structs, w.reg, r, units(200), units(200))).toBeNaN();
});
