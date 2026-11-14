// Prints hashes of fixed, seeded scenarios. The same file runs under Bun (JavaScriptCore) and Node (V8). Equal hashes mean
// the simulation is bit-identical across the two engines, which client prediction relies on.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CORE_CONTENT } from "../content/core.ts";
import { Pose } from "../shared/anim/clip.ts";
import { HUMAN, HUMAN_BONES } from "../shared/anim/human.ts";
import { AnimState, HumanAnim, humanPose } from "../shared/anim/pose.ts";
import { ACT_COOL, ACT_DRAW, ACT_HOLD, ACT_NONE, ACT_RELOAD, ACT_SWING, HOLD_BOW, HOLD_HANDS, HOLD_PISTOL, HOLD_RIFLE, HOLD_TOOL } from "../shared/sim/weapon.ts";
import { Solved, rayZones, solve, zoneHit } from "../shared/anim/skeleton.ts";
import { authoredClips } from "../shared/anim/authored.ts";
import { creaturePose, rayCreature } from "../shared/anim/creature.ts";
import { buildRigs, type Rig } from "../shared/anim/rigs.ts";
import { parsePack } from "../shared/pack/pack.ts";
import { defaultPalette } from "../shared/pack/palette.ts";
import { SOURCE, readPacks } from "./art/source.ts";
import { buildPack } from "./pack/write.ts";
import { compileContent, type Registry } from "../shared/content/registry.ts";
import { deriveRegistry, type Tuning } from "../shared/content/tuning.ts";
import { TICK_DT } from "../shared/coords.ts";
import { Rng } from "../shared/rng.ts";
import { BTN_CROUCH, BTN_PRONE, Body, MODE_GHOST, stepBody } from "../shared/sim/character.ts";
import { buildProvingHeightfield, populateProving, PROVING_DIMS } from "../shared/world/proving.ts";
import { StructureStore } from "../shared/world/structures.ts";
import { frameAxes, makeAim, makeSockets, obstructed, pickSnap, poseAt, socketsOf, type Pose as SnapPose } from "../shared/world/snap.ts";

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
 * Hashes the tuned registry: its own hash, the tables the tuning changes, and the movement scenario on the tuned survivor.
 * Equal on both engines means a client derives exactly what its server did.
 */
export function tunedHash(): string {
  const reg = deriveRegistry(compileContent(CORE_CONTENT).registry!, FIXED_TUNING);
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
  return (h >>> 0).toString(16).padStart(8, "0") + simHash(600, reg);
}

export function simHash(ticks = 3000, content: Registry | null = null): string {
  const reg = content ?? compileContent(CORE_CONTENT).registry!;
  const hf = buildProvingHeightfield();
  const structs = new StructureStore(PROVING_DIMS, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  populateProving(structs, hf, reg);
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

/** Converted and authored clips, passed through the pack's own encoding. Built only from files and modules both engines can read. */
export function sourceClips(): HumanAnim {
  const converted = parsePack(new Uint8Array(readFileSync(new URL("../assets/source/core/humans/human-clips/human-clips.snpk", import.meta.url)))).clips.clips;
  return new HumanAnim(parsePack(buildPack([], defaultPalette(), [...converted, ...authoredClips()])).clips);
}

export function poseHash(): string {
  const anim = sourceClips();
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

/**
 * Joins random building pieces onto a first piece at many facings, and hashes each pose, whether its place is free, and
 * what a look from above picks. Equal hashes mean the client's preview and the server's check agree on both engines.
 */
export function snapHash(): string {
  const reg = compileContent(CORE_CONTENT).registry!;
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

/** The creature rigs and their clips, as `bun run art` wrote them, one pack a creature. */
export function sourceRigs(): Map<string, Rig> {
  const art = readPacks(join(SOURCE, "core/creatures"));
  const pack = parsePack(buildPack([], defaultPalette(), art.clips, art.rigs));
  return buildRigs(pack.header.rigs, pack.clips);
}

/** Every creature at every third speed, striking and not, at whole and fractional ticks. Hashes its bone transforms and what two rays hit. */
export function creatureHash(): string {
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
  for (const rig of sourceRigs().values()) {
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

if (import.meta.main) console.log(simHash() + " " + poseHash() + " " + snapHash() + " " + creatureHash() + " " + tunedHash());
