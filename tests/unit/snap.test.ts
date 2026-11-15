// Piece placement arithmetic, which the client's preview and the server's check share.

import { expect, test } from "bun:test";
import { DOOR_HEIGHT, FLOOR_THICK, FOUNDATION_THICK, RISE, WALL_HEIGHT } from "../../content/building.ts";
import { slopeKind } from "../../content/slopes.ts";
import { STRUCT_UNITS } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import {
  HALF_SIDE,
  MAX_ABOVE_GROUND,
  ROLE_CEILING,
  ROLE_DOOR,
  ROLE_FOUNDATION,
  ROLE_PILLAR,
  ROLE_STAIRS,
  ROLE_WALL,
  floorFace,
  floorTop,
  frameAxes,
  freePose,
  makeAim,
  makeSockets,
  obstructed,
  pickSnap,
  poseAt,
  restPose,
  socketsFor,
  socketsOf,
  tooHigh,
  turnsOf,
  units,
  type Pose,
} from "../../shared/world/snap.ts";
import { ROOF_RISE, ROOF_THICK, TRIANGLE_HALF, hullWorld } from "../fixtures/hulls.ts";
import { flatWorld, type TestWorld } from "../fixtures/world.ts";

const U = STRUCT_UNITS;
const Q = 16384;

/** Builds a piece in socket `k` of `target`, turned `turn`. Returns its ref. */
function join(w: TestWorld, target: number, piece: string, k: number, turn = 0): number {
  const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
  const kind = w.kind(`core:${piece}`);
  expect(poseAt(w.structs, w.reg, target, kind, k, turn, pose)).toBe(true);
  return w.structs.add(kind, pose.x / U, pose.y / U, pose.z / U, pose.yaw, 7, 1);
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
    const start = w.structs.add(w.kind("core:foundation_wood"), 128 + trial * 0.01, 0.1875, 128, yaw, 7, 1);
    const home = at(w, start);
    let ref = start;
    let i = 0;
    let j = 0;
    const steps = [0, 1, 2, 3];
    const made: number[] = [];
    for (let s = 0; s < 40 || i !== 0 || j !== 0; s++) {
      // Wander for a while, then head home along one axis and then the other.
      const k = s < 40 ? steps[rng.int(4)]! : i > 0 ? 3 : i < 0 ? 1 : j > 0 ? 2 : 0;
      ref = join(w, ref, "foundation_wood", k);
      made.push(ref);
      if (k === 0) j++;
      else if (k === 1) i++;
      else if (k === 2) j--;
      else i--;
    }
    expect(at(w, ref)).toEqual(home);
    for (const r of [start, ...made]) w.structs.remove(r);
  }
});

test("the places one piece offers another are the reference's: edge to edge, on edges, on tops, in doorways", () => {
  const s = makeSockets();
  const hF = units(FOUNDATION_THICK / 2);
  const hW = units(WALL_HEIGHT / 2);
  const hC = units(FLOOR_THICK / 2);
  const hS = units(RISE / 2);
  const hD = units(DOOR_HEIGHT / 2);
  const list = (target: number, piece: number, th: number, ph: number, doorway = false): number[][] => {
    socketsFor(target, piece, th, ph, doorway, s);
    return Array.from({ length: s.n }, (_, k) => [s.i[k]!, s.j[k]!, s.dy[k]!, s.dq[k]!]);
  };
  // Foundation to foundation is the four neighbours, level. A ceiling off a foundation is the same, with tops level.
  expect(list(ROLE_FOUNDATION, ROLE_FOUNDATION, hF, hF)).toEqual([[0, 2, 0, 0], [2, 0, 0, 0], [0, -2, 0, 0], [-2, 0, 0, 0]]);
  expect(list(ROLE_FOUNDATION, ROLE_CEILING, hF, hC).map((p) => p[2])).toEqual([hF - hC, hF - hC, hF - hC, hF - hC]);
  expect(list(ROLE_CEILING, ROLE_CEILING, hC, hC).length).toBe(4);
  // A foundation joins nothing but a foundation.
  for (const t of [ROLE_CEILING, ROLE_WALL, ROLE_PILLAR, ROLE_STAIRS, ROLE_DOOR]) expect(list(t, ROLE_FOUNDATION, hC, hF)).toEqual([]);
  // A wall goes on each edge of a floor, standing on it and facing out, or on a wall.
  expect(list(ROLE_FOUNDATION, ROLE_WALL, hF, hW)).toEqual([[0, 1, hF + hW, 0], [1, 0, hF + hW, 1], [0, -1, hF + hW, 2], [-1, 0, hF + hW, 3]]);
  expect(list(ROLE_CEILING, ROLE_WALL, hC, hW).map((p) => p[2])).toEqual([hC + hW, hC + hW, hC + hW, hC + hW]);
  expect(list(ROLE_WALL, ROLE_WALL, hW, hW)).toEqual([[0, 0, 2 * hW, 0]]);
  // A ceiling on a wall has an edge along the wall, to either side, with its top level with the wall's. On a pillar it is level too.
  expect(list(ROLE_WALL, ROLE_CEILING, hW, hC)).toEqual([[0, 1, hW - hC, 0], [0, -1, hW - hC, 0]]);
  expect(list(ROLE_PILLAR, ROLE_CEILING, hW, hC)).toEqual([[0, 0, hW - hC, 0]]);
  // A pillar goes on the middle of a floor or a pillar, or under it. Under a ceiling its top is level with the ceiling's, as a wall's is.
  for (const [t, th] of [[ROLE_FOUNDATION, hF], [ROLE_PILLAR, hW]] as const) expect(list(t, ROLE_PILLAR, th, hW)).toEqual([[0, 0, th + hW, 0], [0, 0, -(th + hW), 0]]);
  expect(list(ROLE_CEILING, ROLE_PILLAR, hC, hW)).toEqual([[0, 0, hC + hW, 0], [0, 0, hC - hW, 0]]);
  // Stairs go on a floor. A door goes in a doorway, standing on its sill, and nowhere else.
  expect(list(ROLE_FOUNDATION, ROLE_STAIRS, hF, hS)).toEqual([[0, 0, hF + hS, 0]]);
  expect(list(ROLE_CEILING, ROLE_STAIRS, hC, hS).length).toBe(1);
  expect(list(ROLE_WALL, ROLE_DOOR, hW, hD, true)).toEqual([[0, 0, hD - hW, 0]]);
  expect(list(ROLE_WALL, ROLE_DOOR, hW, hD, false)).toEqual([]);
  for (const t of [ROLE_FOUNDATION, ROLE_CEILING, ROLE_PILLAR]) expect(list(t, ROLE_DOOR, hF, hD, true)).toEqual([]);
  // Nothing joins stairs or a door.
  for (const p of [ROLE_FOUNDATION, ROLE_WALL, ROLE_CEILING, ROLE_PILLAR, ROLE_DOOR, ROLE_STAIRS]) expect([list(ROLE_STAIRS, p, hS, hW).length, list(ROLE_DOOR, p, hD, hW).length]).toEqual([0, 0]);
  // The number of ways each may be turned in its socket.
  expect([ROLE_FOUNDATION, ROLE_WALL, ROLE_CEILING, ROLE_PILLAR, ROLE_DOOR, ROLE_STAIRS].map(turnsOf)).toEqual([1, 2, 1, 1, 2, 4]);
});

test("a house built by joining pieces stands exactly: floors level, storeys in step, and the same place reached two ways is one place", () => {
  for (const yaw of [0, 5000, 16384, 23456, 40000, 65000]) {
    const w = flatWorld(4);
    const f00 = w.structs.add(w.kind("core:foundation_stone"), 100, FOUNDATION_THICK / 2, 100, yaw, 7, 1);
    const f01 = join(w, f00, "foundation_stone", 0);
    const f10 = join(w, f00, "foundation_stone", 1);
    const f11 = join(w, f01, "foundation_stone", 1);
    const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
    poseAt(w.structs, w.reg, f10, w.kind("core:foundation_stone"), 0, 0, pose);
    expect([pose.x, pose.y, pose.z]).toEqual(at(w, f11).slice(0, 3));
    // A wall on the first's south edge and one on its west. A ceiling from each lands in the same place over the first.
    const south = join(w, f00, "wall_stone", 2);
    const west = join(w, f00, "doorframe_stone", 3);
    const fromSouth: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
    const fromWest: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
    // Each wall faces out, so the side over the house is its own -Z, the second of its two sockets.
    poseAt(w.structs, w.reg, south, w.kind("core:ceiling_stone"), 1, 0, fromSouth);
    poseAt(w.structs, w.reg, west, w.kind("core:ceiling_stone"), 1, 0, fromWest);
    expect([fromSouth.x, fromSouth.y, fromSouth.z]).toEqual([fromWest.x, fromWest.y, fromWest.z]);
    const [fx, fy, fz] = at(w, f00);
    expect([fromSouth.x, fromSouth.z]).toEqual([fx, fz]);
    expect(fromSouth.y + units(FLOOR_THICK / 2)).toBe(fy + units(FOUNDATION_THICK / 2) + units(RISE));
    const stairs = join(w, f01, "stairs_stone", 0, 3);
    expect(at(w, stairs)[1] + units(RISE / 2)).toBe(fromSouth.y + units(FLOOR_THICK / 2));
    expect(at(w, stairs)[3]).toBe((yaw + 3 * Q) & 0xffff);
    const pillar = join(w, f10, "pillar_stone", 0);
    const onPillar: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
    poseAt(w.structs, w.reg, pillar, w.kind("core:ceiling_stone"), 0, 0, onPillar);
    expect(onPillar.y).toBe(fromSouth.y);
    expect([onPillar.x, onPillar.z]).toEqual(at(w, f10).filter((_v, i) => i === 0 || i === 2));
    const door = join(w, west, "door_stone", 0, 1);
    expect(at(w, door)[1] - units(DOOR_HEIGHT / 2)).toBe(fy + units(FOUNDATION_THICK / 2));
    expect([at(w, door)[0], at(w, door)[2]]).toEqual([at(w, west)[0], at(w, west)[2]]);
    expect(at(w, door)[3]).toBe((at(w, west)[3] + 2 * Q) & 0xffff);
    const upper = join(w, south, "wall_stone", 0);
    expect(at(w, upper)).toEqual([at(w, south)[0], at(w, south)[1] + units(WALL_HEIGHT), at(w, south)[2], at(w, south)[3]]);
    expect(poseAt(w.structs, w.reg, f00, w.kind("core:wall_stone"), 4, 0, pose)).toBe(false);
    expect(poseAt(w.structs, w.reg, f00, w.kind("core:door_stone"), 0, 0, pose)).toBe(false);
    expect(poseAt(w.structs, w.reg, south, w.kind("core:door_stone"), 0, 0, pose)).toBe(false);
    expect(poseAt(w.structs, w.reg, 123456, w.kind("core:wall_stone"), 0, 0, pose)).toBe(false);
    expect(socketsOf(w.structs, w.reg, f00, w.kind("core:block"), makeSockets())).toBe(0);
  }
});

test("what is in the way: the same place twice, a ceiling over stairs, a pillar in them; not neighbours, corners or a door in its frame", () => {
  const w = flatWorld(4);
  const f = w.structs.add(w.kind("core:foundation_wood"), 100, FOUNDATION_THICK / 2, 100, 3000, 7, 1);
  const blocked = (target: number, piece: string, k: number, turn = 0): boolean => {
    const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
    const kind = w.kind(`core:${piece}`);
    expect(poseAt(w.structs, w.reg, target, kind, k, turn, pose)).toBe(true);
    return obstructed(w.structs, w.reg.parts, kind, pose.x / U, pose.y / U, pose.z / U, pose.yaw);
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
  const base = g.structs.add(g.kind("core:foundation_wood"), 100, FOUNDATION_THICK / 2, 100, 0, 7, 1);
  g.structs.add(g.kind("core:block"), 103.6, 1, 100, 8000, 0, 1);
  const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
  poseAt(g.structs, g.reg, base, g.kind("core:foundation_wood"), 1, 0, pose);
  expect(obstructed(g.structs, g.reg.parts, g.kind("core:foundation_wood"), pose.x / U, pose.y / U, pose.z / U, pose.yaw)).toBe(true);
  poseAt(g.structs, g.reg, base, g.kind("core:foundation_wood"), 3, 0, pose);
  expect(obstructed(g.structs, g.reg.parts, g.kind("core:foundation_wood"), pose.x / U, pose.y / U, pose.z / U, pose.yaw)).toBe(false);
});

test("a look chooses the piece it lands on, else the nearest with a place; that piece's places come nearest first", () => {
  const w = flatWorld(4);
  const f = w.structs.add(w.kind("core:foundation_wood"), 100, FOUNDATION_THICK / 2, 100, 0, 7, 1);
  const far = w.structs.add(w.kind("core:foundation_wood"), 109, FOUNDATION_THICK / 2, 100, 0, 7, 1);
  const aim = makeAim();
  const wall = w.kind("core:wall_wood");
  /** A look that ends at (x, y, z), having hit `hit` (a ref, or -1). */
  const look = (kind: number, x: number, y: number, z: number, hit = -1): void => pickSnap(w.structs, w.reg, kind, x, y + 5, z, 0, -1, 0, hit, 5, hit < 0, aim);
  // Looking at the foundation near its north edge puts that edge first for a wall, then the nearer of the others.
  look(wall, 100.4, FOUNDATION_THICK, 101.2, f);
  expect([aim.target, aim.count, [...aim.order.subarray(0, 4)]]).toEqual([f, 4, [0, 1, 3, 2]]);
  look(wall, 98.7, FOUNDATION_THICK, 99.9, f);
  expect(aim.order[0]).toBe(3);
  look(wall, 102.4, 0, 100.2);
  expect([aim.target, aim.order[0], aim.ground]).toEqual([f, 1, true]);
  look(wall, 106.8, 0, 100.2);
  expect([aim.target, aim.order[0]]).toEqual([far, 3]);
  look(w.kind("core:foundation_wood"), 103, 0, 100);
  expect([aim.target, aim.order[0]]).toEqual([f, 1]);
  look(wall, 130, 0, 130);
  expect([aim.target, aim.count]).toEqual([-1, 0]);
  // Looking at a piece with no socket for the held piece picks the nearest that has one. A door has none anywhere until a doorframe is built.
  look(w.kind("core:door_wood"), 100, FOUNDATION_THICK, 100, f);
  expect(aim.target).toBe(-1);
  const frame = join(w, f, "doorframe_wood", 2);
  look(w.kind("core:door_wood"), 100, FOUNDATION_THICK, 100, f);
  expect([aim.target, aim.count]).toEqual([frame, 1]);
  // Where the look ended is reported, for setting a piece on open ground.
  look(wall, 12.5, 0, 14.25);
  expect([aim.px, aim.py, aim.pz]).toEqual([12.5, 0, 14.25]);
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
  const blocked = (kind: number, x: number, y: number, z: number, yaw = 0): boolean => obstructed(w.structs, w.reg.parts, kind, x, y, z, yaw);
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
      put("core:wall_stone", at(1, 2), FOUNDATION_THICK + 1.5, Q, [-0.5, 0, 0]),
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
  const f = w.structs.add(w.kind("core:foundation_stone"), 50, FOUNDATION_THICK / 2, 50, 0, 7, 1);
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
