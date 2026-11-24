// A body on foot steps onto what stands at most its step above its feet, and anything higher stops it: from any angle, at
// corners and seams between boxes, at any speed and in any stance, off a slope or onto one, for every species that walks.
// What content means to be walked onto still is, and what it means to stop a body still does.

import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import type { Def, ShapeBox } from "../../shared/content/defs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { STRUCT_UNITS, TICK_DT, chunkAt } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import { BTN_CROUCH, BTN_PRONE, BTN_SPRINT, Body, stanceHeight, stepBody, type MoveParams } from "../../shared/sim/character.ts";
import { SKIN, capsuleFree, groundUnder } from "../../shared/world/collide.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { nodeForms } from "../../shared/world/nodes.ts";
import { ROLE_CEILING, ROLE_DOOR, ROLE_FOUNDATION, ROLE_PILLAR, ROLE_STAIRS, ROLE_WALL, freePose, type Pose } from "../../shared/world/snap.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { hullRegistry } from "../fixtures/hulls.ts";
import { join as joinTo, start } from "../fixtures/slots.ts";
import { flatWorld, type TestWorld } from "../fixtures/world.ts";

const reg = hullRegistry();
const kind = (id: string): number => reg.index.get(id)!;
const survivor = reg.move[kind("core:survivor")]!;
const STEP = survivor.stepUp;
const U = STRUCT_UNITS;
/** Every species that walks. */
const WALKERS = reg.defs.flatMap((d) => (d?.type === "species" && !d.still ? [d.id] : []));

/** Level ground, or ground rising `slope` metres a metre toward +Z from 0 at z = 64. */
function world(slope = 0): TestWorld {
  const dims = { chunksX: 2, chunksZ: 2 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -32, 1 / 256);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, (j * hf.cell - 64) * slope);
  return { dims, hf, structs: new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts), reg, kind };
}

/** A 2 m block over (x, z) sunk to its top at `top`, turned `yaw`. Returns its top as the lattice put it. */
function block(w: TestWorld, x: number, z: number, top: number, yaw = 0): number {
  const ref = w.structs.add(kind("core:block"), x, top - 1, z, yaw, 0, 1);
  return w.structs.chunks[Math.floor(ref / 65536)]!.y[ref & 0xffff]! + 1;
}

/** The lowest a body may stand over (x, z): on the ground, or on what is built there. */
function rest(w: TestWorld, p: MoveParams, x: number, z: number): number {
  let lo = groundUnder(w.hf, x, z, p.radius);
  if (capsuleFree(w, x, lo, z, p.radius, p.height)) return lo;
  let hi = lo + 5;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (capsuleFree(w, x, mid, z, p.radius, p.height)) hi = mid;
    else lo = mid;
  }
  return hi;
}

interface Way {
  move?: number;
  buttons?: number;
  ticks?: number;
  /** Metres short of the target it starts, beyond its radius. */
  from?: number;
}

const WAYS: Way[] = [{ move: 20 }, { move: 60 }, {}, { buttons: BTN_SPRINT }, { buttons: BTN_CROUCH }, { buttons: BTN_PRONE }];
const said = (way: Way): string => (way.buttons === BTN_SPRINT ? "sprinting" : way.buttons === BTN_CROUCH ? "crouched" : way.buttons === BTN_PRONE ? "prone" : `at ${way.move ?? 127}/127`);

/**
 * Walks a body of `p` from rest toward (x, z), facing `deg` degrees from +Z toward +X. Returns the highest it stood, whether it
 * ever stood where it could not have stood on the ground, and the body where it ended.
 */
function walk(w: TestWorld, p: MoveParams, x: number, z: number, deg: number, { move = 127, buttons = 0, ticks = 240, from = 1.5 }: Way = {}): { high: number; upon: boolean; b: Body } {
  const a = (deg * Math.PI) / 180;
  const yaw = Math.round((deg / 360) * 65536) & 0xffff;
  const b = new Body();
  b.x = x - Math.sin(a) * (from + p.radius);
  b.z = z - Math.cos(a) * (from + p.radius);
  b.y = rest(w, p, b.x, b.z);
  b.grounded = true;
  b.yaw = yaw;
  let high = -Infinity;
  let upon = false;
  for (let t = 0; t < ticks; t++) {
    stepBody(w, b, 0, move, yaw, 0, buttons, p, TICK_DT);
    const h = stanceHeight(p, b.stance);
    if (!capsuleFree(w, b.x, b.y, b.z, p.radius, h)) throw new Error(`in solid at ${b.x}, ${b.y}, ${b.z}`);
    if (b.grounded && b.y > high) high = b.y;
    upon ||= !capsuleFree(w, b.x, groundUnder(w.hf, b.x, b.z, p.radius), b.z, p.radius, h);
  }
  return { high, upon, b };
}

test("a survivor steps onto a block 0.5 m high or lower and not onto one of 0.55, 0.6, 0.7 or 0.75 m, head on and at 30 and 60 degrees, at any speed and in any stance", () => {
  const wrong: string[] = [];
  for (const h of [0.3, 0.45, 0.5, 0.55, 0.6, 0.7, 0.75]) {
    const w = world();
    const top = block(w, 64, 64, h);
    for (const deg of [0, 30, 60]) {
      for (const way of WAYS) {
        // At the middle of its south face.
        const { high, upon } = walk(w, survivor, 64, 63, deg, way);
        if (top <= STEP ? high < top - 0.01 : upon) wrong.push(`${h} m at ${deg} degrees ${said(way)}: stood ${high.toFixed(3)} m up`);
      }
    }
  }
  expect(wrong).toEqual([]);
});

test("at the inside corner of two blocks and at the seam between two of different heights, a survivor steps up a step and no more", () => {
  const wrong: string[] = [];
  for (const [a, b] of [[0.3, 0.5], [0.45, 0.5], [0.55, 0.6], [0.6, 0.75], [0.7, 0.86]] as const) {
    // One block's west face and the other's south face meet at (63, 65), walked into from the south-west.
    const corner = world();
    const lowest = Math.min(block(corner, 64, 64, a), block(corner, 62, 66, b));
    // Side by side, their south faces in line, walked at where they meet.
    const seam = world();
    block(seam, 63, 64, a);
    block(seam, 65, 64, b);
    for (const [w, x, z, degs, what] of [[corner, 63, 65, [20, 45, 70], "corner"], [seam, 64, 63, [-30, 0, 30], "seam"]] as const) {
      for (const deg of degs) {
        for (const way of WAYS) {
          const { high, upon } = walk(w, survivor, x, z, deg, way);
          if (b <= STEP ? high < lowest - 0.01 : upon) wrong.push(`${what} of ${a} and ${b} m at ${deg} degrees ${said(way)}: stood ${high.toFixed(3)} m up`);
        }
      }
    }
  }
  expect(wrong).toEqual([]);
});

test("every species that walks steps onto a block a step high and is stopped by one higher, up to well past its own radius", () => {
  const wrong: string[] = [];
  expect(WALKERS.length).toBeGreaterThan(4);
  for (const id of WALKERS) {
    const p = reg.move[kind(id)]!;
    for (const h of [STEP, STEP + 0.05, 0.75, 1, 1.25, 1.5]) {
      const w = world();
      const top = block(w, 64, 64, h);
      for (const deg of [0, 30, 60]) {
        for (const way of [{ move: 30 }, {}, { buttons: BTN_SPRINT }]) {
          const stride = p.walkSpeed * (way.move ?? 127) / 127 * TICK_DT;
          const ticks = Math.max(300, Math.ceil((2 * p.radius + 2) / stride));
          const { high, upon } = walk(w, p, 64, 63, deg, { ...way, from: 0.5 + p.radius, ticks });
          if (top <= STEP ? high < top - 0.01 : upon) wrong.push(`${id}: ${h} m at ${deg} degrees ${said(way)}: stood ${high.toFixed(3)} m up`);
        }
      }
    }
  }
  expect(wrong).toEqual([]);
});

test("off a slope a survivor steps up to a step above its feet, uphill and downhill, and onto sloped pieces where they rise no more than a step", () => {
  const wrong: string[] = [];
  // Ground of 25 degrees. Where the body stands at a block's face, walking up to its south face and down to its north face.
  const slope = Math.tan((25 * Math.PI) / 180);
  for (const [deg, z] of [[0, 63], [180, 65]]) {
    const tall = world(slope);
    block(tall, 64, 64, 1.5);
    const feet = walk(tall, survivor, 64, z, deg).b.y;
    for (const [rise, climbs] of [[STEP - 0.05, true], [STEP + 0.05, false]] as const) {
      for (const along of [-30, 0, 30]) {
        const w = world(slope);
        block(w, 64, 64, feet + rise);
        if (walk(w, survivor, 64, z, deg + along).upon !== climbs) wrong.push(`${deg === 0 ? "up" : "down"} the slope at ${along} degrees, a block ${rise} m above the feet: ${climbs ? "stopped" : "climbed"}`);
      }
    }
  }
  // A ramp is walked up from its foot. A triangle as thick as a foundation is stepped onto. A sloped roof's low edge, 0.75 m up, is not.
  const ramp = world();
  ramp.structs.add(kind("test:ramp"), 64, 1.5, 64, 0, 0, 1);
  if (walk(ramp, survivor, 64, 62.5, 0, { ticks: 120 }).high < 2.9) wrong.push("the ramp was not walked up");
  const triangle = world();
  triangle.structs.add(kind("test:triangle"), 64, 0.1875, 64, 0, 0, 1);
  for (const deg of [30, 45, 60]) if (walk(triangle, survivor, 65.5, 64.9, deg).high < 0.37) wrong.push(`the triangle at ${deg} degrees was not stepped onto`);
  const roof = world();
  roof.structs.add(kind("test:roof"), 64, 1.4, 64, 0, 0, 1);
  for (const deg of [-30, 0, 30]) for (const way of WAYS) if (walk(roof, survivor, 64, 62.5, deg, way).upon) wrong.push(`the roof's low edge was climbed at ${deg} degrees ${said(way)}`);
  expect(wrong).toEqual([]);
});

test("every piece content means to be walked onto still is, and every piece meant to stop a survivor still does", () => {
  const wrong: string[] = [];
  const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
  const foundation = reg.role.indexOf(ROLE_FOUNDATION);
  const doorframe = reg.doorway.indexOf(1);
  /** A piece in place `place` of `target` as the game joins it, or on open ground as it begins a base. Returns its ref. */
  const put = (w: TestWorld, k: number, target = -1, place = 0): number => {
    if (target >= 0) {
      const ref = joinTo(w, target, k, place);
      if (ref < 0) throw new Error(`no place for ${reg.defs[k]!.id}`);
      return ref;
    }
    freePose(() => 0, reg, k, 64, 64, 0, 0, pose);
    // A road is laid as a foundation is and is in no base: it has no form.
    return reg.forms.cls[k]! >= 0 ? start(w, k, pose.x / U, pose.y / U, pose.z / U, pose.yaw, 7) : w.structs.add(k, pose.x / U, pose.y / U, pose.z / U, pose.yaw, 7, 1);
  };
  const topOf = (w: TestWorld, ref: number, k: number): number => w.structs.chunks[Math.floor(ref / 65536)]!.y[ref & 0xffff]! + w.structs.halfYOf(k);
  const joined = [ROLE_CEILING, ROLE_STAIRS, ROLE_WALL, ROLE_PILLAR, ROLE_DOOR];
  for (let k = 1; k < reg.defs.length; k++) {
    const d = reg.defs[k];
    // Sloped pieces are walked by tests/build/slopes.test.ts. A city piece's broken form is neither kind: it has a way
    // through it and remnants a survivor steps onto, which tests/world/breaks*.test.ts hold.
    const hulls = reg.parts.hulls;
    if (d?.type !== "structure" || d.id.startsWith("test:") || reg.breakForm[k] !== 0 || (hulls && hulls.start[k + 1]! > hulls.start[k]!)) continue;
    const role = reg.role[k]!;
    const w = world();
    if (!joined.includes(role)) {
      // On open ground: a foundation as it is set down, anything else on its base. From eight sides, a step reaches it if it
      // is a foundation or low enough.
      const ref = role === ROLE_FOUNDATION ? put(w, k) : w.structs.add(k, 64, w.structs.halfYOf(k), 64, 0, 0, 1);
      // Its top is its highest box's, which is its half's but where its boxes are not about its origin: a crosswalk's one
      // box lies wholly under it.
      let peak = -Infinity;
      for (let b = reg.parts.start[k]! * 6; b < reg.parts.start[k + 1]! * 6; b += 6) peak = Math.max(peak, reg.parts.box[b + 1]! + reg.parts.box[b + 4]!);
      const top = topOf(w, ref, k) - w.structs.halfYOf(k) + peak;
      const onto = role === ROLE_FOUNDATION || top <= STEP + SKIN;
      for (let side = 0; side < 8; side++) {
        const { high, upon } = walk(w, survivor, 64, 64, side * 45, { from: Math.hypot(reg.halfX[k]!, reg.halfZ[k]!) + 0.5 });
        if (onto ? high < top - 0.01 : upon) wrong.push(`${d.id}, ${top.toFixed(3)} m up, from side ${side}: stood ${high.toFixed(3)} m up`);
      }
      continue;
    }
    // The rest stand on a foundation at (64, 64).
    const f = put(w, foundation);
    const floor = topOf(w, f, foundation);
    if (role === ROLE_CEILING) {
      // Laid as a floor, edge to edge north of the foundation, and walked onto from it and from the ground beyond.
      const top = topOf(w, put(w, k, f, 0), k);
      const across = walk(w, survivor, 64, 67, 0, { from: 2.5, ticks: 30 });
      const back = walk(w, survivor, 64, 67, 180, { from: 2.5, ticks: 30 });
      if (across.b.z < 67 || across.high > top + 0.01 || back.high < top - 0.01) wrong.push(`${d.id} laid as a floor was not walked onto`);
    } else if (role === ROLE_STAIRS) {
      // Up from the ground at their foot, the foundation's edge, to the top step.
      put(w, k, f, 0);
      const top = floor + 3;
      if (walk(w, survivor, 64, 62.5, 0, { ticks: 150 }).high < top - 0.01) wrong.push(`${d.id} were not walked up to ${top} m`);
    } else {
      // On the north edge, atop the foundation for a pillar, or in a doorframe there for a door: never climbed, and gone
      // through head on only where a survivor fits in the doorway.
      if (role === ROLE_DOOR) put(w, k, put(w, doorframe, f, 0), 0);
      else put(w, k, f, 0);
      const z = role === ROLE_PILLAR ? 64 : 65.5;
      const open = capsuleFree(w, 64, floor, z, survivor.radius, survivor.height);
      for (const x of [62.9, 64, 65.1]) {
        for (const deg of [-30, 0, 30]) {
          const { high, b } = walk(w, survivor, x, z, deg, { from: 1, ticks: 60 });
          if (high > floor + 0.01) wrong.push(`${d.id} at ${x}, ${deg} degrees: stood ${high.toFixed(3)} m up`);
          if (x === 64 && deg === 0 && b.z > z + 0.5 !== open) wrong.push(`${d.id} head on: ${open ? "stopped" : "went through"}`);
        }
      }
      // A doorway's threshold, the foundation's edge, is stepped over from the ground outside.
      if (reg.doorway[k] === 1 && walk(w, survivor, 64, 64, 180, { from: 3, ticks: 60 }).b.z > 64) wrong.push(`${d.id}: not walked in from outside`);
    }
  }
  expect(wrong).toEqual([]);
});

test("rubble, stumps and broken stones no higher than a step are walked over from every side", () => {
  const forms = nodeForms(reg);
  const box = forms.parts.box;
  let low = 0;
  const wrong: string[] = [];
  for (let k = 1; k < reg.defs.length; k++) {
    if (reg.defs[k]?.type !== "node") continue;
    const steps = forms.steps[k]!;
    for (let v = 0; v < forms.sums[k]!.length; v++) {
      for (const step of [0, steps - 1]) {
        const grown = forms.first[k]! + v * steps + step;
        for (const f of [grown, forms.left[grown]!]) {
          if (f === 0 || forms.soft[f] === 1 || forms.parts.start[f + 1] === forms.parts.start[f]) continue;
          let top = 0;
          for (let b = forms.parts.start[f]! * 6; b < forms.parts.start[f + 1]! * 6; b += 6) top = Math.max(top, box[b + 1]! + box[b + 4]!);
          if (top > STEP) continue;
          low++;
          const w = world();
          const nodes = new StructureStore(w.dims, forms.halfX, forms.halfY, forms.halfZ, forms.soft, forms.parts);
          nodes.put(0, 0, f, 32, 0, 32, 0, 0, 1, 1);
          const reach = Math.hypot(forms.halfX[f]!, forms.halfZ[f]!);
          // Long enough to walk across the widest, a banyan's stump and those of the trunks it let down.
          const ticks = Math.max(90, Math.ceil(((2 * reach + 2) / survivor.walkSpeed) * (1 / TICK_DT)));
          for (let side = 0; side < 8; side++) {
            const a = (side * Math.PI) / 4;
            const { b } = walk({ ...w, nodes }, survivor, 32, 32, side * 45, { from: reach + 0.5, ticks });
            if ((b.x - 32) * Math.sin(a) + (b.z - 32) * Math.cos(a) < reach + survivor.radius) wrong.push(`${forms.mesh[f] || reg.defs[k]!.id} from side ${side}`);
          }
        }
      }
    }
  }
  expect(low).toBeGreaterThan(10);
  expect(wrong).toEqual([]);
});

test("a survivor walks onto a stone of one box 0.5 m high and onto none from 0.55 to 0.9 m, head on, at 30 and 60 degrees and at its corner", () => {
  const heights = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9];
  // One box 2 m across, buried 0.3 m.
  const stone = (h: number): Def => {
    const id = `test:stone_${Math.round(h * 100)}`;
    const box: ShapeBox = { at: [0, (h - 0.3) / 2, 0], half: [1, (h + 0.3) / 2, 1] };
    return { type: "node", id, mesh: "box", color: 15, half: box.half, hits: 5, respawnHours: 1, material: "stone", yields: [{ item: "core:stone", min: 1, max: 1 }], xp: 1, variants: [{ mesh: id, boxes: [box] }] };
  };
  const { registry, errors } = compileContent([...CORE_CONTENT, ...heights.map(stone)]);
  if (!registry) throw new Error(errors.join("\n"));
  const forms = nodeForms(registry);
  const w = flatWorld(2);
  const wrong: string[] = [];
  for (const h of heights) {
    const nodes = new StructureStore(w.dims, forms.halfX, forms.halfY, forms.halfZ, forms.soft, forms.parts);
    nodes.put(chunkAt(w.dims, 32, 32), 0, forms.first[registry.index.get(`test:stone_${Math.round(h * 100)}`)!]!, 32, 0, 32, 0, 0, 1, 1);
    for (const [x, z, deg] of [[32, 26, 0], [29, 26, 30], [27, 29, 60], [27, 27, 45]] as const) {
      const yaw = Math.round((deg / 360) * 65536);
      const b = new Body();
      [b.x, b.z, b.yaw, b.grounded] = [x, z, yaw, true];
      let stood = false;
      for (let t = 0; t < 150; t++) {
        stepBody({ hf: w.hf, structs: w.structs, nodes }, b, 0, 127, yaw, 0, 0, survivor, TICK_DT);
        stood ||= b.grounded && b.y > 0.05;
      }
      if (stood !== h <= STEP) wrong.push(`${h} m at ${deg} degrees: ${stood ? "stood on it" : "stopped"}`);
    }
  }
  expect(wrong).toEqual([]);
});

test("a raptor turning as it walks round an elder's trunk is not stepped up onto nothing at its corner, into the trunk (D360)", () => {
  // Facing +Z and looking at the trunk from side 44 of 64, 7 m off, it turns as it comes and grazes the corner. A step up
  // onto nothing there once lifted it 3.9 mm and set it where the step was going, 2 mm and a rounding into the trunk.
  const forms = nodeForms(reg);
  const form = forms.mesh.indexOf("core:oak_3");
  const w = flatWorld(2);
  const nodes = new StructureStore(w.dims, forms.halfX, forms.halfY, forms.halfZ, forms.soft, forms.parts);
  nodes.put(0, 0, form, 32, 0, 32, 0, 0, 1, 1);
  const world = { hf: w.hf, structs: w.structs, nodes };
  const p = reg.move[kind("core:raptor")]!;
  const box = forms.parts.box;
  const first = forms.parts.start[form]! * 6;
  const yaw = 44 * 1024;
  const a = (yaw / 65536) * 2 * Math.PI;
  const b = new Body();
  [b.x, b.z, b.grounded] = [32 + box[first]! - Math.sin(a) * 7, 32 + box[first + 2]! - Math.cos(a) * 7, true];
  for (let t = 0; t < 150; t++) {
    stepBody(world, b, 0, 127, yaw, 0, 0, p, TICK_DT);
    if (!capsuleFree(world, b.x, b.y, b.z, p.radius, p.height)) throw new Error(`in the trunk at tick ${t}: ${b.x}, ${b.y}, ${b.z}`);
    expect(b.y).toBe(0);
  }
});

test("fuzz: among blocks higher than a step, turned and overlapping, no body of any species gets onto one without jumping, and none enters one", () => {
  const w = world();
  const rng = new Rng(51);
  for (let n = 0; n < 50; n++) block(w, rng.range(44, 84), rng.range(44, 84), rng.range(STEP + 0.02, 1.4), rng.int(65536));
  for (const seed of [1, 2, 3, 4]) {
    const r = new Rng(seed);
    for (const id of WALKERS) {
      const p = reg.move[kind(id)]!;
      const b = new Body();
      do {
        b.x = r.range(40, 88);
        b.z = r.range(40, 88);
      } while (!capsuleFree(w, b.x, 0, b.z, p.radius, p.height));
      b.grounded = true;
      let [moveX, moveZ, yaw, buttons] = [0, 127, r.int(65536), 0];
      for (let i = 0; i < 2000; i++) {
        if (r.int(20) === 0) [moveX, moveZ, yaw, buttons] = [r.int(255) - 127, r.int(255) - 127, r.int(65536), (r.int(2) * BTN_SPRINT) | (r.int(6) === 0 ? BTN_CROUCH : 0) | (r.int(9) === 0 ? BTN_PRONE : 0)];
        stepBody(w, b, moveX, moveZ, yaw, 0, buttons, p, TICK_DT);
        if (!capsuleFree(w, b.x, b.y, b.z, p.radius, stanceHeight(p, b.stance))) throw new Error(`${id} in solid at tick ${i}, seed ${seed}: ${b.x}, ${b.y}, ${b.z}`);
        if (b.y > 0.01) throw new Error(`${id} up ${b.y} m at tick ${i}, seed ${seed}: ${b.x}, ${b.z}`);
      }
    }
  }
});
