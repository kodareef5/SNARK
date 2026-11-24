// Fixed, seeded scenarios and their hashes. Equal hashes on two JavaScript engines mean the simulation is bit-identical
// on both, which client prediction relies on. tools/simhash.ts runs them under Bun and Node, and the device probe in a
// browser. Reading files stays in the tools: these are given the content, the human clips and the creature rigs.

import { Pose } from "../anim/clip.ts";
import { HUMAN, HUMAN_BONES } from "../anim/human.ts";
import { AnimState, CUE_LAND, CUE_NONE, CUE_ROLL, CUE_STARTLE, CUE_TAKEOFF, CUE_TORPOR, DIR_STEPS, HumanAnim, LAYER_EAT, LAYER_FLINCH, LAYER_NONE, humanPose } from "../anim/pose.ts";
import { ACT_COOL, ACT_DRAW, ACT_HOLD, ACT_NONE, ACT_RELOAD, ACT_SWING, HOLD_BOW, HOLD_HANDS, HOLD_PISTOL, HOLD_RIFLE, HOLD_TOOL } from "./weapon.ts";
import { Solved, rayZones, solve, zoneHit } from "../anim/skeleton.ts";
import { creaturePose, rayCreature, type CreatureAnim } from "../anim/creature.ts";
import { shapeHalf, type Def, type ShapeDef } from "../content/defs.ts";
import { compileContent, type Registry } from "../content/registry.ts";
import { deriveRegistry, type Tuning } from "../content/tuning.ts";
import { TICK_DT } from "../coords.ts";
import { Rng } from "../rng.ts";
import { BTN_BRAKE, BTN_CROUCH, BTN_JUMP, BTN_PRONE, BTN_ROLL, BTN_SPRINT, Body, JET_CUIRASS, MF_NO_JUMP, MF_NO_SPRINT, MF_OUT, MF_ROOTED, MF_WINDED, MODE_FLYER, MODE_GHOST, MODE_SWIM, MODE_WALK, STAMINA_UNITS, stepBody } from "./character.ts";
import { Heightfield, TERRAIN_CELL } from "../world/heightfield.ts";
import { Fall, SETTLE_TICKS, layCorpse } from "../anim/corpse.ts";
import { buildProvingHeightfield, populateProving, PROVING_DIMS } from "../world/proving.ts";
import { castWorld, lookDirection, rayHit } from "../world/ray.ts";
import { NodeField, nodeForms, scatterNodes, type NodeSpot } from "../world/nodes.ts";
import { StructureStore } from "../world/structures.ts";
import { MapWater } from "../world/water.ts";
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

/**
 * Survivors walking, jumping, crouching and swimming over the proving ground, one a ghost, and pteranodons flying over it.
 * `ground` is the proving ground from elsewhere, such as its map file. Without it the proving ground is built here.
 */
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
  // Pteranodons, wild and tamed, from the plaza, the pool's shore and the slopes, on their own stream of inputs: in the air
  // while their jump is held, climbing and diving by the look, sprinting, braking and rolling, let down to land, and now and
  // then knocked out, caught by a bola or too heavy, as the server sets them. One tires within seconds and is put down.
  const ptera = reg.index.get("core:pteranodon");
  const flyers = ptera === undefined ? [] : [[256, 236], [196, 256], [290, 262], [230, 292]].map(([x, z], i) => {
    const b = new Body();
    b.x = x!;
    b.z = z!;
    b.y = hf.heightAt(b.x, b.z);
    b.grounded = true;
    b.kind = ptera;
    b.staminaMax = i === 1 ? 20 : 150;
    b.stamina = b.staminaMax * STAMINA_UNITS;
    return b;
  });
  const flies = ptera === undefined ? [] : [reg.move[ptera]!, reg.tamedMove[ptera]!];
  const air = new Rng(20261115);
  const flown = flyers.map(() => [127, 0, 0, BTN_JUMP]);
  // Survivors carrying a glider (planning/workstreams/glider.md), let go high over the plaza, the pool and the slopes on
  // their own stream of inputs: opening and folding it with either key, steering, flaring and diving, one in the cuirass
  // whose jet takes Jump, one that tires within seconds. Each is lifted again a second after it lands or swims.
  const gliders = [[250, 244, 70], [205, 258, 45], [288, 276, 110], [262, 270, 25]].map(([x, z, up], i) => {
    const b = new Body();
    b.x = x!;
    b.z = z!;
    b.y = hf.heightAt(b.x, b.z) + up!;
    b.glideGear = 1;
    if (i === 2) b.jetGear = JET_CUIRASS;
    if (i === 3) b.staminaMax = 9;
    return b;
  });
  const wind = new Rng(20261121);
  const glided = gliders.map(() => [0, 127, 0, 0, 0]);
  const f = new Float32Array(6);
  const bytes = new Uint8Array(f.buffer);
  let h1 = 0x811c9dc5;
  let h2 = 0x9747b28c;
  const mix = (b: Body): void => {
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
  };
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
      mix(b);
    }
    for (let i = 0; i < flyers.length; i++) {
      const b = flyers[i]!;
      const inp = flown[i]!;
      if (air.int(20) === 0) {
        inp[0] = air.int(255) - 127;
        inp[1] = air.int(65536);
        inp[2] = air.int(32769) - 16384;
        inp[3] = (air.int(5) === 0 ? 0 : BTN_JUMP) | (air.int(2) === 0 ? BTN_SPRINT : 0) | (air.int(8) === 0 ? BTN_BRAKE : 0) | (air.int(8) === 0 ? BTN_ROLL : 0);
        const r = air.int(40);
        b.mflags = (b.mflags & MF_WINDED) | (r === 0 ? MF_OUT : r === 1 ? MF_ROOTED | MF_NO_SPRINT : r === 2 ? MF_ROOTED | MF_NO_SPRINT | MF_NO_JUMP : 0);
      }
      stepBody(world, b, 0, inp[0]!, inp[1]!, inp[2]!, inp[3]!, flies[i % 2]!, TICK_DT);
      mix(b);
      h1 = Math.imul(h1 ^ (b.yaw | (b.regenWait << 16)), 0x01000193);
      h2 = Math.imul(h2 + b.rollWait, 0x85ebca6b) ^ (h2 >>> 13);
    }
    for (let i = 0; i < gliders.length; i++) {
      const b = gliders[i]!;
      const inp = glided[i]!;
      if (wind.int(12) === 0) {
        inp[0] = wind.int(255) - 127;
        inp[1] = wind.int(3) === 0 ? wind.int(255) - 127 : 127;
        inp[2] = wind.int(65536);
        inp[3] = (wind.int(4) === 0 ? BTN_JUMP : 0) | (wind.int(4) === 0 ? BTN_CROUCH : 0) | (wind.int(3) === 0 ? BTN_SPRINT : 0);
      }
      if (b.grounded || b.mode === MODE_SWIM) {
        if (++inp[4]! > 30) {
          inp[4] = 0;
          b.mode = MODE_WALK;
          b.y = Math.fround(b.y + 60);
          b.grounded = false;
        }
      }
      stepBody(world, b, inp[0]!, inp[1]!, inp[2]!, 0, inp[3]!, p, TICK_DT);
      mix(b);
      h1 = Math.imul(h1 ^ (b.glide | (b.glideKeys << 1) | (b.regenWait << 3) | (b.jetThrust << 13)), 0x01000193);
      h2 = Math.imul(h2 + b.jetSpent, 0x85ebca6b) ^ (h2 >>> 13);
    }
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

/**
 * The bodies of `simHash` over the proving ground with water standing on its own surfaces: the pool's west half 1.25 m
 * over the sea in its east half, a pond 2 m up over the foot of the slopes, and a puddle 0.6 m deep on the plaza where the
 * first survivor starts. Equal on both engines means swimming into, out of and between waters of different heights is
 * predicted as the server steps it.
 */
export function waterHash(reg: Registry, ticks = 3000): string {
  const hf = buildProvingHeightfield();
  const structs = new StructureStore(PROVING_DIMS, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  populateProving(structs, hf, reg);
  const side = (PROVING_DIMS.chunksX * 64) / 2;
  const grid = new Uint16Array(side * side);
  const fill = (x0: number, z0: number, x1: number, z1: number, b: number): void => {
    for (let j = z0 / 2; j < z1 / 2; j++) for (let i = x0 / 2; i < x1 / 2; i++) grid[j * side + i] = b;
  };
  fill(140, 220, 172, 292, 1);
  fill(196, 276, 246, 300, 2);
  fill(248, 234, 264, 250, 3);
  const level = (m: number): number => Math.round((m - hf.minY) / hf.stepY);
  hf.water = MapWater.fromGrid(PROVING_DIMS, hf.minY, hf.stepY, 2, [{ name: "Raised pool", level: level(0.75) }, { name: "Slope pond", level: level(2) }, { name: "Puddle", level: level(0.6) }], grid);
  return simHash(reg, ticks, { hf, structs });
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
export const RAMP_LIP = 0.06;

const H = 1.5;
const pieceShapes: readonly ShapeDef[] = [
  // Rises a storey over a side, toward +Z, short of it by RAMP_LIP: 44.4 degrees, as ARK's ramp measures, under the steepest a
  // survivor stands on. A full storey would be 45.
  { type: "shape", id: "test:shape_ramp", role: "stairs", boxes: [], hulls: [{ corners: [[-H, -H, -H], [H, -H, -H], [-H, -H, H], [H, -H, H], [-H, H - RAMP_LIP, H], [H, H - RAMP_LIP, H]] }] },
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

/**
 * Every creature at every third speed, striking and not, at whole and fractional ticks. Then each through a knock-out,
 * fed twice and waking; a flinch over a walk and over a strike; a startle into a run, a fall and its landing, swimming, and
 * standing long enough for its idles; and one that flies through its flight, taking off, banked, pitched, rolling and
 * landing. Hashes its bone transforms and what two rays hit.
 */
export function creatureHash(anims: Iterable<CreatureAnim>, reg: Registry): string {
  const st = new AnimState();
  // Ground that rises toward +X in steps of 5 cm, with a wall in the way of a body laid beside it.
  const dims = { chunksX: 2, chunksZ: 2 };
  const ground = new Heightfield(dims, TERRAIN_CELL, -32, 1 / 256);
  for (let j = 0; j < ground.nz; j++) for (let i = 0; i < ground.nx; i++) ground.setSample(i, j, i * TERRAIN_CELL * 0.3 + Math.floor(j / 7) * 0.05);
  const lying = { hf: ground, structs: new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts) };
  const wall = reg.index.get("core:wall_wood")!;
  lying.structs.add(wall, 41.2, ground.heightAt(41.2, 40) + reg.halfY[wall]!, 40, 9000, 1, 1000);
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
  for (const a of anims) {
    const rig = a.rig;
    const rot = new Uint8Array(rig.solved.rot.buffer);
    const pos = new Uint8Array(rig.solved.pos.buffer);
    const pose = (tick: number, rays: boolean): void => {
      creaturePose(a, st, tick, rig.a);
      solve(rig, rig.a, rig.solved);
      mix(rot);
      mix(pos);
      // One ray from the side at mid height, and one along its length from the front.
      if (rays) {
        for (const [ox, oy, oz, dx, dz] of [[-20, rig.mid, 0.3, 1, 0], [0.05, rig.mid * 1.2, 30, 0, -1]] as const) {
          f[0] = rayCreature(a, st, tick, 0, 0, 0, (n * 4099) & 0xffff, ox, oy, oz, dx, 0, dz, 60);
          f[1] = zoneHit.t;
          mix(fb);
        }
      }
      n++;
    };
    st.unpack(0);
    st.mode = MODE_WALK;
    for (let speed = 0; speed <= 15; speed += 3) {
      for (const strike of [false, true]) {
        for (let k = 0; k < 6; k++) {
          const tick = 100 + n * 5.25;
          st.speed = speed;
          st.seed = (n * 37) % 1024;
          st.setAction(strike ? ACT_SWING : ACT_NONE, HOLD_HANDS, Math.floor(tick) - k * 4);
          pose(tick, true);
        }
      }
    }
    // Knocked out at 400 while walking, fed at 470 and 520, awake at 900. Each cue is cleared 240 ticks on, as the server does.
    st.unpack(0);
    st.mode = MODE_WALK;
    st.seed = 211;
    for (let tick = 397; tick < 1000; tick += tick < 480 || tick > 890 ? 1.25 : 9.5) {
      st.out = tick >= 400 && tick < 900;
      st.speed = tick < 400 ? 2 : 0;
      const start = tick >= 900 ? 900 : 400;
      st.cue = tick >= 400 && tick < start + 240 ? CUE_TORPOR : CUE_NONE;
      st.cueStart = start & 255;
      const fed = tick >= 520 ? 520 : 470;
      st.layer = tick >= 470 && tick < fed + 240 ? LAYER_EAT : LAYER_NONE;
      st.layerStart = fed & 255;
      pose(tick, tick > 450 && tick < 460);
    }
    // A flinch over a walk, and over a strike; a startle into a run; a fall, and its landing; afloat, still and swimming.
    st.unpack(0);
    st.mode = MODE_WALK;
    st.seed = 5;
    st.layer = LAYER_FLINCH;
    st.layerStart = 1200 & 255;
    st.speed = 2;
    for (let tick = 1199; tick < 1220; tick += 0.75) pose(tick, false);
    st.speed = 0;
    st.setAction(ACT_SWING, HOLD_HANDS, 1201);
    for (let tick = 1199; tick < 1220; tick += 0.75) pose(tick, tick === 1205);
    st.unpack(0);
    st.mode = MODE_WALK;
    st.cue = CUE_STARTLE;
    st.cueStart = 1300 & 255;
    for (let tick = 1299; tick < 1335; tick += 1.25) {
      st.speed = tick < 1302 ? 0 : 2;
      pose(tick, false);
    }
    st.unpack(0);
    st.mode = MODE_WALK;
    st.grounded = false;
    for (let tick = 1400; tick < 1412; tick += 1.5) pose(tick, false);
    st.grounded = true;
    st.cue = CUE_LAND;
    st.cueStart = 1412 & 255;
    for (let tick = 1412; tick < 1440; tick += 1.5) pose(tick, false);
    st.unpack(0);
    st.mode = MODE_SWIM;
    for (let tick = 1500; tick < 1560; tick += 3.5) {
      st.speed = tick < 1530 ? 0 : 4;
      pose(tick, false);
    }
    // Turning on its feet, going forward and backing up, each step of turn either way.
    st.unpack(0);
    st.mode = MODE_WALK;
    for (let k = 0; k < 14; k++) {
      st.speed = 2 + (k % 4) * 4;
      st.dir = k < 7 ? 0 : DIR_STEPS / 2;
      st.setTurn((k % 7) - 3);
      pose(1600 + k * 2.5, k % 5 === 0);
    }
    // Standing for a minute: every turn of its idle, a variant or not, for three bodies.
    st.unpack(0);
    st.mode = MODE_WALK;
    for (const seed of [0, 333, 777]) {
      st.seed = seed;
      for (let tick = 2000; tick < 3800; tick += 11.5) pose(tick, false);
    }
    // Dead and knocked out, laid on the slope and against the wall, every tick until it rests: the server lays it as clients do.
    for (const [out, yaw, x] of [[false, 0.3, 40], [true, 2.1, 40.6], [false, 4.4, 39.5]] as const) {
      const r = layCorpse(a, out, false, x, ground.heightAt(x, 40), 40, yaw, 1, rig.solved);
      if (!r) break;
      const fall = new Fall(r);
      for (let t = 0; t < SETTLE_TICKS && fall.tick(lying); t++) {
        mix(new Uint8Array(r.x.buffer));
        mix(new Uint8Array(r.q.buffer));
      }
      mix(new Uint8Array(r.x.buffer));
      mix(new Uint8Array(r.q.buffer));
    }
    if (!a.flies) continue;
    // In the air: each speed, look, bank and climb in turn, taking off and rolling now and then, and landing.
    for (let k = 0; k < 96; k++) {
      const tick = 4000 + k * 3.25;
      st.unpack(0);
      st.mode = MODE_FLYER;
      st.grounded = false;
      st.seed = (k * 37) % 1024;
      st.speed = k % 11;
      st.pitch = ((k * 7) % 61) - 30;
      st.bank = (k % 15) - 7;
      st.climb = k % 4;
      st.cue = k % 5 === 0 ? CUE_TAKEOFF : k % 5 === 1 ? CUE_ROLL : CUE_NONE;
      st.cueStart = (Math.floor(tick) - (k % 70)) & 255;
      pose(tick, true);
    }
    st.unpack(0);
    st.mode = MODE_WALK;
    st.cue = CUE_LAND;
    st.cueStart = 4500 & 255;
    for (let tick = 4500; tick < 4550; tick += 1.5) pose(tick, false);
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

const STAND_IN_YIELD = [{ item: "core:fiber", min: 1, max: 1 }];

/**
 * Node kinds standing in for the art: several variants of different weights, boxes off their middles, sizes over a wide range,
 * and what is left once used up, for the kind and for one variant. Their meshes are the tests' (tests/fixtures/nodes.ts).
 */
export const VARIANT_NODES: readonly Def[] = [
  {
    type: "node",
    id: "test:palm",
    mesh: "box",
    color: 3,
    half: [0.2, 3, 0.2],
    hits: 5,
    respawnHours: 1,
    material: "wood",
    yields: STAND_IN_YIELD,
    xp: 1,
    size: [0.6, 1.7],
    variants: [
      { mesh: "test:palm_1", boxes: [{ at: [0, 3, 0], half: [0.2, 3, 0.2] }] },
      { mesh: "test:palm_2", weight: 3, boxes: [{ at: [0, 1.5, 0], half: [0.25, 1.5, 0.25] }, { at: [0.8, 4, 0.3], half: [0.2, 1, 0.2] }] },
      { mesh: "test:palm_3", weight: 2, boxes: [{ at: [-0.3, 2, 0.1], half: [0.3, 2, 0.15] }], depleted: { mesh: "test:palm_3_depleted", boxes: [{ at: [-0.3, 0.4, 0.1], half: [0.3, 0.4, 0.15] }] } },
    ],
    depleted: { mesh: "test:palm_depleted", boxes: [{ at: [0, 0.3, 0], half: [0.25, 0.3, 0.25] }] },
  },
  {
    type: "node",
    id: "test:boulder",
    mesh: "box",
    color: 15,
    half: [1, 0.7, 0.8],
    hits: 5,
    respawnHours: 1,
    material: "stone",
    yields: STAND_IN_YIELD,
    xp: 1,
    size: [0.5, 2.5],
    // Where the ground falls away under it, a shrub grows in its slot.
    footing: { reach: 3, fall: 0.5, else: "test:shrub" },
    variants: [
      { mesh: "test:boulder_1", boxes: [{ at: [0, 0.5, 0], half: [1.2, 0.5, 0.7] }, { at: [0.4, 1.3, 0], half: [0.6, 0.3, 0.5] }] },
      { mesh: "test:boulder_2", boxes: [{ at: [0.2, 0.8, -0.3], half: [0.9, 0.8, 1.1] }] },
    ],
  },
  { type: "node", id: "test:shrub", mesh: "box", color: 16, half: [0.6, 0.5, 0.6], soft: true, hits: 2, respawnHours: 1, yields: STAND_IN_YIELD, xp: 0.5, size: [0.7, 1.4], depleted: { mesh: "test:shrub_depleted" } },
];

/**
 * With the definitions of `base` and VARIANT_NODES: those kinds scattered over the proving ground, each node's kind (a boulder
 * where its footing holds, else a shrub), form (its variant and size), place and turn hashed; then a seventh of them used up, and bodies walking among the rest and the stumps
 * and casting rays at them. Equal on both engines means every client grows the same forest the server does and meets it alike.
 */
export function nodeHash(base: Registry): string {
  const { registry: reg, errors } = compileContent([...base.defs.filter((d): d is Def => d !== null), ...VARIANT_NODES]);
  if (!reg) throw new Error(errors.join("\n"));
  const hf = buildProvingHeightfield();
  const [palm, boulder, shrub] = ["test:palm", "test:boulder", "test:shrub"].map((id) => reg.index.get(id)!);
  const kinds = [palm!, palm!, boulder!, shrub!, 0];
  const source = scatterNodes(PROVING_DIMS, hf, 0x7ee5, 96, nodeForms(reg), (x, z) => (Math.max(Math.abs(x - 256), Math.abs(z - 256)) > 60 ? kinds : null));
  let h1 = 0x811c9dc5;
  let h2 = 0x9747b28c;
  const f = new Float64Array(10);
  const bytes = new Uint8Array(f.buffer);
  const add = (n: number): void => {
    for (let k = 0; k < n * 8; k++) {
      h1 = Math.imul(h1 ^ bytes[k]!, 0x01000193);
      h2 = Math.imul(h2 + bytes[k]!, 0x85ebca6b) ^ (h2 >>> 13);
    }
  };
  const spot: NodeSpot = { kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 };
  const chunks = PROVING_DIMS.chunksX * PROVING_DIMS.chunksZ;
  for (let c = 0; c < chunks; c++) {
    for (let i = 0; i < source.perChunk; i++) {
      source.at(c, i, spot);
      f[0] = spot.kind;
      if (spot.kind === 0) {
        add(1);
        continue;
      }
      [f[1], f[2], f[3], f[4], f[5]] = [spot.form, spot.x, spot.y, spot.z, spot.yaw];
      add(6);
    }
  }
  const field = new NodeField(PROVING_DIMS, reg, source);
  field.retain(27, 8, 1, (chunk, i) => (chunk * 96 + i) % 7 === 0);
  const world = { hf, structs: new StructureStore(PROVING_DIMS, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts), nodes: field.store };
  const rng = new Rng(4417);
  const moves = ["core:survivor", "core:raptor", "core:parasaur"].map((id) => reg.move[reg.index.get(id)!]!);
  const bodies = Array.from({ length: 24 }, () => {
    const b = new Body();
    b.x = 256 + rng.range(-190, 190);
    b.z = 256 + rng.range(-190, 190);
    b.y = hf.heightAt(b.x, b.z) + 3;
    return b;
  });
  const input = bodies.map(() => [0, 127, 0, 0]);
  const d = [0, 0, 0];
  for (let t = 0; t < 400; t++) {
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i]!;
      const inp = input[i]!;
      if (rng.int(20) === 0) {
        inp[0] = rng.int(255) - 127;
        inp[2] = rng.int(65536);
        inp[3] = rng.int(4);
      }
      stepBody(world, b, inp[0]!, inp[1]!, inp[2]!, 0, inp[3]!, moves[i % moves.length]!, TICK_DT);
      lookDirection(inp[2]!, (i * 911 + t * 37) % 8000 - 4000, d);
      f[0] = castWorld(world, b.x, b.y + 1.5, b.z, d[0]!, d[1]!, d[2]!, 40);
      [f[1], f[2], f[3], f[4], f[5], f[6], f[7], f[8], f[9]] = [rayHit.t, rayHit.ref, rayHit.nx, rayHit.ny, rayHit.nz, b.x, b.y, b.z, b.grounded ? 1 : 0];
      add(10);
    }
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}
