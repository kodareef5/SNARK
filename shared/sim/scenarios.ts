// Fixed, seeded scenarios and their hashes. Equal hashes on two JavaScript engines mean the simulation is bit-identical
// on both, which client prediction relies on. tools/simhash.ts runs them under Bun and Node, and the device probe in a
// browser. Reading files stays in the tools: these are given the content, the human clips and the creature rigs.

import { Pose } from "../anim/clip.ts";
import { HUMAN, HUMAN_BONES } from "../anim/human.ts";
import { AnimState, HumanAnim, humanPose } from "../anim/pose.ts";
import { ACT_COOL, ACT_DRAW, ACT_HOLD, ACT_NONE, ACT_RELOAD, ACT_SWING, HOLD_BOW, HOLD_HANDS, HOLD_PISTOL, HOLD_RIFLE, HOLD_TOOL } from "./weapon.ts";
import { Solved, rayZones, solve, zoneHit } from "../anim/skeleton.ts";
import { creaturePose, rayCreature } from "../anim/creature.ts";
import type { Rig } from "../anim/rigs.ts";
import { shapeHalf, type Def, type ShapeDef } from "../content/defs.ts";
import { compileContent, type Registry } from "../content/registry.ts";
import { deriveRegistry, type Tuning } from "../content/tuning.ts";
import { TICK_DT } from "../coords.ts";
import { Rng } from "../rng.ts";
import { BTN_CROUCH, BTN_PRONE, Body, MODE_GHOST, stepBody } from "./character.ts";
import type { Heightfield } from "../world/heightfield.ts";
import { buildProvingHeightfield, populateProving, PROVING_DIMS } from "../world/proving.ts";
import { castWorld, lookDirection, rayHit } from "../world/ray.ts";
import { StructureStore } from "../world/structures.ts";
import { frameAxes, makeAim, makeSockets, obstructed, pickSnap, poseAt, socketsOf, type Pose as SnapPose } from "../world/snap.ts";

/** A tuning with an entry of every kind and numbers that do not come out even, as a server's settings might produce. */
export const FIXED_TUNING: Tuning = {
  stack: 2.5,
  stacks: { "core:thatch": { n: 543, plain: true }, "core:wood": { n: 70 } },
  costs: { "core:hatchet": [{ item: "core:thatch", count: 2.4 }, { item: "core:wood", count: 3 }] },
  engrams: { "core:engram-hatchet": { level: 3, cost: 2, auto: 0 }, "core:engram-pick": { hidden: true } },
  xp: [0, 7, 19.5, 44, 81],
  most: 100,
  points: [1, 2, 3],
  tameXp: [0, 12, 30],
  stamina: 1.7,
  staminaOf: { "core:survivor": 0.37 },
  spoil: 3.3,
  fuel: 0.45,
  nodeHits: 1.6,
};

/**
 * Hashes the registry `base` tuned by FIXED_TUNING: its own hash, the tables the tuning changes, and the movement
 * scenario on the tuned survivor. Equal on both engines means a client derives exactly what its server did.
 */
export function tunedHash(base: Registry): string {
  const reg = deriveRegistry(base, FIXED_TUNING);
  const f = new Float64Array(1);
  const bytes = new Uint8Array(f.buffer);
  let h = reg.hash;
  const add = (v: number): void => {
    f[0] = v;
    for (let k = 0; k < 8; k++) h = Math.imul(h ^ bytes[k]!, 0x01000193);
  };
  for (let i = 0; i < reg.defs.length; i++) {
    add(reg.stack[i]!);
    add(reg.spoilTicks[i]!);
    add(reg.fuelTicks[i]!);
    add(reg.nodeHits[i]!);
    add(reg.recipeMakes[i]!);
    for (const v of reg.recipeOf[i] ?? []) add(v);
    const m = reg.move[i];
    if (m) {
      add(m.staminaSprint);
      add(m.staminaJump);
      add(m.staminaRegen);
    }
  }
  return (h >>> 0).toString(16).padStart(8, "0") + simHash(reg, 600);
}

/** `ground` is the proving ground from elsewhere, such as its map file. Without it the proving ground is built here. */
export function simHash(reg: Registry, ticks = 3000, ground: { hf: Heightfield; structs: StructureStore } | null = null): string {
  const hf = ground ? ground.hf : buildProvingHeightfield();
  const structs = ground ? ground.structs : new StructureStore(PROVING_DIMS, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  if (!ground) populateProving(structs, hf, reg);
  const world = { hf, structs };
  const p = reg.move[reg.index.get("core:survivor")!]!;
  const rng = new Rng(20261112);
  // On the plaza, on the slopes, in and around the pool.
  const spawns = [[256, 240], [239, 268], [285, 280], [263, 274], [252, 305], [248, 260], [220, 286], [300, 258], [172, 256], [180, 262], [160, 250], [196, 256]];
  const bodies = spawns.map(([x, z], i) => {
    const b = new Body();
    b.x = x!;
    b.z = z!;
    b.y = hf.heightAt(b.x, b.z);
    b.grounded = true;
    // Each body has different modifiers. One tires quickly and one is a ghost.
    b.speedQ = 700 + i * 90;
    b.swimQ = 1600 - i * 70;
    if (i === 3) b.staminaMax = 12;
    if (i === 5) b.mode = MODE_GHOST;
    return b;
  });
  const input = bodies.map(() => [0, 0, 0, 0, 0]);
  const f = new Float32Array(6);
  const bytes = new Uint8Array(f.buffer);
  let h1 = 0x811c9dc5;
  let h2 = 0x9747b28c;
  for (let t = 0; t < ticks; t++) {
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i]!;
      const inp = input[i]!;
      if (rng.int(15) === 0) {
        inp[0] = rng.int(255) - 127;
        inp[1] = rng.int(255) - 127;
        inp[2] = rng.int(65536);
        // Jump and sprint, and now and then crouch or prone.
        inp[3] = rng.int(4) | (rng.int(6) === 0 ? BTN_CROUCH : 0) | (rng.int(11) === 0 ? BTN_PRONE : 0);
        inp[4] = rng.int(32769) - 16384;
      }
      stepBody(world, b, inp[0]!, inp[1]!, inp[2]!, inp[4]!, inp[3]!, p, TICK_DT);
      f[0] = b.x;
      f[1] = b.y;
      f[2] = b.z;
      f[3] = b.vx;
      f[4] = b.vy;
      f[5] = b.vz;
      for (let k = 0; k < 24; k++) {
        h1 = Math.imul(h1 ^ bytes[k]!, 0x01000193);
        h2 = Math.imul(h2 + bytes[k]!, 0x85ebca6b) ^ (h2 >>> 13);
      }
      h1 = Math.imul(h1 ^ ((b.grounded ? 1 : 0) | (b.mode << 1) | (b.mflags << 4) | (b.stance << 8)), 0x01000193);
      h2 = Math.imul(h2 + b.stamina, 0x85ebca6b) ^ (h2 >>> 13);
    }
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

/** Poses of the human clips in `anim` over every state a body can be in, and what three rays hit. */
export function poseHash(anim: HumanAnim): string {
  const st = new AnimState();
  const pose = new Pose(HUMAN_BONES);
  const solved = new Solved(HUMAN_BONES);
  const rot = new Uint8Array(solved.rot.buffer);
  const pos = new Uint8Array(solved.pos.buffer);
  const f = new Float32Array(1);
  const fb = new Uint8Array(f.buffer);
  let h1 = 0x811c9dc5;
  let h2 = 0x9747b28c;
  const mix = (bytes: Uint8Array): void => {
    for (let k = 0; k < bytes.length; k++) {
      h1 = Math.imul(h1 ^ bytes[k]!, 0x01000193);
      h2 = Math.imul(h2 + bytes[k]!, 0x85ebca6b) ^ (h2 >>> 13);
    }
  };
  let n = 0;
  // Standing, crouched, prone, in the air and in water, over a spread of speeds, directions and pitches.
  for (const [mode, grounded, stance] of [[1, 1, 0], [1, 1, 1], [1, 1, 2], [1, 0, 0], [2, 0, 0]] as const) {
    for (let speed = 0; speed <= 15; speed += 3) {
      for (let dir = 0; dir < 16; dir += 3) {
        for (let pitch = -31; pitch <= 31; pitch += 13) {
          st.mode = mode;
          st.grounded = grounded === 1;
          st.stance = stance;
          st.speed = speed;
          st.dir = dir;
          st.pitch = pitch;
          st.seed = (n * 37) % 1024;
          const tick = n * 7.25;
          // Every third pose is partway through a swing of a hand or a tool. Some of the rest hold a bow or a gun mid-action.
          if (n % 3 === 0) st.setAction(ACT_SWING, n % 2 === 0 ? HOLD_HANDS : HOLD_TOOL, Math.floor(tick) - (n % 17));
          else if (n % 5 === 1) st.setAction([ACT_DRAW, ACT_HOLD, ACT_RELOAD, ACT_COOL, ACT_NONE][n % 7 % 5]!, [HOLD_BOW, HOLD_RIFLE, HOLD_PISTOL][n % 3]!, Math.floor(tick) - (n % 11));
          else st.setAction(ACT_NONE, HOLD_HANDS, 0);
          n++;
          humanPose(anim, st, tick, pose);
          solve(HUMAN, pose, solved);
          mix(rot);
          mix(pos);
          // Rays from the front at chest height, down through the head, and from the side at 0.4 m.
          for (const [ox, oy, oz, dx, dy, dz] of [[0.05, 1.3, 3, 0, 0, -1], [0.02, 3, 0.03, 0, -1, 0], [2, 0.4, 0.1, -1, 0, 0]] as const) {
            h1 = Math.imul(h1 ^ rayZones(HUMAN, solved, ox, oy, oz, dx, dy, dz, 10), 0x01000193);
            f[0] = zoneHit.t;
            mix(fb);
          }
        }
      }
    }
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

/** The triangle piece's half thickness, a foundation's. The roof slab rises this much over its run of 3 m, and is this thick, upright. */
export const TRIANGLE_HALF = 0.1875;
export const ROOF_RISE = 1.5;
export const ROOF_THICK = 0.2;

const H = 1.5;
const pieceShapes: readonly ShapeDef[] = [
  // Rises a storey over a side, toward +Z: 45 degrees.
  { type: "shape", id: "test:shape_ramp", role: "stairs", boxes: [], hulls: [{ corners: [[-H, -H, -H], [H, -H, -H], [-H, -H, H], [H, -H, H], [-H, H, H], [H, H, H]] }] },
  // Its origin is a corner, and its sides run 3 m along the first axis and 3 m along the second, 60 degrees on.
  {
    type: "shape",
    id: "test:shape_triangle",
    role: "foundation",
    boxes: [],
    hulls: [{ sixty: true, corners: [0, 3].flatMap((a) => [-TRIANGLE_HALF, TRIANGLE_HALF].map((y) => [a, y, 0] as [number, number, number])).concat([-TRIANGLE_HALF, TRIANGLE_HALF].map((y) => [0, y, 3] as [number, number, number])) }],
  },
  {
    type: "shape",
    id: "test:shape_roof",
    role: "ceiling",
    boxes: [],
    hulls: [{ corners: [-H, H].flatMap((x) => [[x, -ROOF_RISE / 2 - ROOF_THICK / 2, -H], [x, -ROOF_RISE / 2 + ROOF_THICK / 2, -H], [x, ROOF_RISE / 2 - ROOF_THICK / 2, H], [x, ROOF_RISE / 2 + ROOF_THICK / 2, H]] as [number, number, number][]) }],
  },
];

/**
 * Sloped and three-sided pieces made of convex parts, for this scenario and the tests only: a ramp wedge, a triangle on 60
 * degree axes and a sloped roof slab. The game's content has none yet.
 */
export const HULL_PIECES: readonly Def[] = [
  ...pieceShapes,
  ...pieceShapes.map((s): Def => ({ type: "structure", class: "piece", id: s.id.replace("shape_", ""), mesh: "shape", shape: s.id, half: shapeHalf(s.boxes, s.hulls), color: 5, hp: 10000, material: "core:mat_stone" })),
];

/**
 * With the definitions of `base` and HULL_PIECES: ramps, triangles and roof slabs at random turns on the proving ground, and
 * bodies of three sizes walking among them and over its slopes, each casting a ray from its eye every tick. Hashes where the
 * bodies are and what the rays meet.
 */
export function hullHash(base: Registry): string {
  const { registry: reg, errors } = compileContent([...base.defs.filter((d): d is Def => d !== null), ...HULL_PIECES]);
  if (!reg) throw new Error(errors.join("\n"));
  const hf = buildProvingHeightfield();
  const structs = new StructureStore(PROVING_DIMS, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const world = { hf, structs };
  const rng = new Rng(9091);
  for (let n = 0; n < 60; n++) {
    const kind = ["test:ramp", "test:triangle", "test:roof"][n % 3]!;
    structs.add(reg.index.get(kind)!, 225 + rng.range(0, 60), [1.5, 0.1875, 1.4][n % 3]!, 225 + rng.range(0, 60), rng.int(65536), 1, 1);
  }
  const moves = ["core:survivor", "core:raptor", "core:parasaur"].map((id) => reg.move[reg.index.get(id)!]!);
  // Among the pieces, and on the slope strips.
  const bodies = Array.from({ length: 24 }, (_, i) => {
    const b = new Body();
    b.x = i < 18 ? 225 + rng.range(0, 60) : 200 + (i - 18) * 8;
    b.z = i < 18 ? 225 + rng.range(0, 60) : 292;
    b.y = hf.heightAt(b.x, b.z) + 4;
    return b;
  });
  const input = bodies.map(() => [0, 127, 0, 0]);
  const f = new Float64Array(10);
  const bytes = new Uint8Array(f.buffer);
  const d = [0, 0, 0];
  let h1 = 0x811c9dc5;
  let h2 = 0x9747b28c;
  for (let t = 0; t < 600; t++) {
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i]!;
      const inp = input[i]!;
      if (rng.int(20) === 0) {
        inp[0] = rng.int(255) - 127;
        inp[1] = rng.int(255) - 127;
        inp[2] = rng.int(65536);
        inp[3] = rng.int(4);
      }
      stepBody(world, b, inp[0]!, inp[1]!, inp[2]!, 0, inp[3]!, moves[i % moves.length]!, TICK_DT);
      lookDirection(inp[2]!, (i * 911 + t * 37) % 12000 - 6000, d);
      f[0] = castWorld(world, b.x, b.y + 1.5, b.z, d[0]!, d[1]!, d[2]!, 60);
      f[1] = rayHit.t;
      f[2] = rayHit.ref;
      f[3] = rayHit.nx;
      f[4] = rayHit.ny;
      f[5] = rayHit.nz;
      f[6] = b.x;
      f[7] = b.y;
      f[8] = b.z;
      f[9] = b.grounded ? 1 : 0;
      for (let k = 0; k < bytes.length; k++) {
        h1 = Math.imul(h1 ^ bytes[k]!, 0x01000193);
        h2 = Math.imul(h2 + bytes[k]!, 0x85ebca6b) ^ (h2 >>> 13);
      }
    }
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

/**
 * Joins random building pieces onto a first piece at many facings, and hashes each pose, whether its place is free, and
 * what a look from above picks. Equal hashes mean the client's preview and the server's check agree on both engines.
 */
export function snapHash(reg: Registry): string {
  const kinds = ["foundation", "wall", "doorframe", "windowframe", "ceiling", "pillar", "door", "stairs"].map((p) => reg.index.get(`core:${p}_stone`)!);
  const rng = new Rng(7106);
  const axes = new Int32Array(4);
  const pose: SnapPose = { x: 0, y: 0, z: 0, yaw: 0 };
  const sockets = makeSockets();
  const aim = makeAim();
  let h1 = 0x811c9dc5;
  let h2 = 0x9747b28c;
  const mix = (v: number): void => {
    h1 = Math.imul(h1 ^ (v | 0), 0x01000193);
    h2 = Math.imul(h2 + (v | 0), 0x85ebca6b) ^ (h2 >>> 13);
  };
  for (let trial = 0; trial < 120; trial++) {
    const structs = new StructureStore(PROVING_DIMS, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
    const yaw = rng.int(65536);
    frameAxes(yaw, axes);
    for (const v of axes) mix(v);
    const built = [structs.add(kinds[0]!, 200 + rng.range(-20, 20), 4 + rng.int(64) / 512, 200 + rng.range(-20, 20), yaw, 1, 1)];
    for (let i = 0; i < 60; i++) {
      const target = built[rng.int(built.length)]!;
      const kind = kinds[rng.int(kinds.length)]!;
      const n = socketsOf(structs, reg, target, kind, sockets);
      mix(n);
      if (n === 0 || !poseAt(structs, reg, target, kind, rng.int(n), rng.int(4), pose)) continue;
      mix(pose.x);
      mix(pose.y);
      mix(pose.z);
      mix(pose.yaw);
      const taken = obstructed(structs, reg.parts, kind, pose.x / 512, pose.y / 512, pose.z / 512, pose.yaw);
      mix(taken ? 1 : 0);
      if (!taken) built.push(structs.add(kind, pose.x / 512, pose.y / 512, pose.z / 512, pose.yaw, 1, 1));
      // A look straight down onto somewhere near it.
      pickSnap(structs, reg, kinds[rng.int(kinds.length)]!, pose.x / 512 + rng.range(-3, 3), pose.y / 512 + 6, pose.z / 512 + rng.range(-3, 3), 0, -1, 0, -1, 6, false, aim);
      mix(aim.target);
      for (let k = 0; k < aim.count; k++) mix(aim.order[k]!);
    }
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

/** Every creature at every third speed, striking and not, at whole and fractional ticks. Hashes its bone transforms and what two rays hit. */
export function creatureHash(rigs: Iterable<Rig>): string {
  const st = new AnimState();
  let h1 = 0x811c9dc5;
  let h2 = 0x9747b28c;
  const mix = (bytes: Uint8Array): void => {
    for (let k = 0; k < bytes.length; k++) {
      h1 = Math.imul(h1 ^ bytes[k]!, 0x01000193);
      h2 = Math.imul(h2 + bytes[k]!, 0x85ebca6b) ^ (h2 >>> 13);
    }
  };
  const f = new Float32Array(2);
  const fb = new Uint8Array(f.buffer);
  let n = 0;
  for (const rig of rigs) {
    const rot = new Uint8Array(rig.solved.rot.buffer);
    const pos = new Uint8Array(rig.solved.pos.buffer);
    for (let speed = 0; speed <= 15; speed += 3) {
      for (const strike of [false, true]) {
        for (let k = 0; k < 6; k++) {
          const tick = 100 + n * 5.25;
          st.speed = speed;
          st.seed = (n * 37) % 1024;
          st.setAction(strike ? ACT_SWING : ACT_NONE, HOLD_HANDS, Math.floor(tick) - k * 4);
          creaturePose(rig, st, tick, 4, rig.a);
          solve(rig, rig.a, rig.solved);
          mix(rot);
          mix(pos);
          // One ray from the side at mid height, and one along its length from the front.
          for (const [ox, oy, oz, dx, dz] of [[-20, rig.mid, 0.3, 1, 0], [0.05, rig.mid * 1.2, 30, 0, -1]] as const) {
            f[0] = rayCreature(rig, st, tick, 4, 0, 0, 0, (n * 4099) & 0xffff, ox, oy, oz, dx, 0, dz, 60);
            f[1] = zoneHit.t;
            mix(fb);
          }
          n++;
        }
      }
    }
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}
