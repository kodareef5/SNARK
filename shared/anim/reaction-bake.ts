// The reaction curves as the ragdoll solver works them out (shared/anim/ragdoll.ts), and packed as
// shared/anim/reactions.ts reads them. The server, tests and tools bake them once as they load
// (shared/anim/reaction-curves.ts); a page's build bakes them as it builds, so no page runs the solver.

import { detCos, detSin } from "../math/scalar.ts";
import { REACT_FRAMES } from "../sim/react.ts";
import { Heightfield } from "../world/heightfield.ts";
import { StructureStore } from "../world/structures.ts";
import type { CollisionWorld } from "../world/collide.ts";
import { HUMAN, HUMAN_RAGDOLL } from "./human.ts";
import { standingPose } from "./human-fall.ts";
import { Ragdoll } from "./ragdoll.ts";
import { CURVE_DIGITS, CURVE_SCALE, keptCurves, REACT_CHEST, REACT_DIRS, REACT_HEAD, reactDir, reactHeight, reactKind, reactStrength, TURNED } from "./reactions.ts";

/** The whole body's change of speed, in metres a second, for each strength. */
const STRENGTHS = [0.6, 1, 1.5, 2.2];
/** Each class's drives: how fast the body springs back, and how little it overshoots. */
const OMEGA = [0, 12, 9];
const ZETA = [0, 0.6, 0.5];
/** The farthest a packed turn may land from the solver's, as the distance between quaternions: about 0.01 degrees. */
const PACKED_MOST = 1e-4;

let still: CollisionWorld | null = null;

/** Ground far below, so a curve's body meets nothing. */
function nowhere(): CollisionWorld {
  if (still) return still;
  const dims = { chunksX: 1, chunksZ: 1 };
  const hf = new Heightfield(dims, 64, -1000, 1);
  still = { hf, structs: new StructureStore(dims, new Float32Array(0), new Float32Array(0), new Float32Array(0)) };
  return still;
}

/**
 * The solver's curve for a stagger or heavy stagger `word`, frames by turned bodies by a quaternion each: every turned
 * body's turn against its parent, as a turn from where the standing pose has it. A body standing still with its hips
 * and legs anchored and the rest driven back toward standing, struck once.
 */
export function bakeCurve(word: number): Float64Array {
  const kind = reactKind(word), frames = REACT_FRAMES[kind]!, stand = standingPose(), world = nowhere();
  const r = new Ragdoll(HUMAN, HUMAN_RAGDOLL);
  r.start(stand, stand, 32, 0, 32, 0, 1);
  for (const i of [0, 7, 8, 9, 10]) r.anchor(i, true);
  for (const i of TURNED) { r.driveOmega[i] = OMEGA[kind]!; r.driveZeta[i] = ZETA[kind]!; }
  r.lift = 1;
  // Pushed toward `dir`: a blow high on the body throws what it hits that way, one low on it moves the hips and leaves
  // the chest behind.
  const angle = (reactDir(word) / REACT_DIRS) * 2 * Math.PI, dv = STRENGTHS[reactStrength(word)]!;
  const height = reactHeight(word), toward = height >= REACT_CHEST ? 1 : -0.7;
  const dx = detSin(angle) * dv * toward, dz = detCos(angle) * dv * toward;
  r.strike(height === REACT_HEAD ? 2 : 1, dx, height === REACT_HEAD ? 0 : -0.15 * dv, dz);
  const curve = new Float64Array(frames * TURNED.length * 4);
  for (let f = 0; f < frames; f++) {
    r.follow(stand, 32, 0, 32, 0);
    r.step(world, 1 / 30);
    for (let k = 0; k < TURNED.length; k++) r.offset(TURNED[k]!, curve, (f * TURNED.length + k) * 4);
  }
  return curve;
}

/**
 * One curve as the packed text holds it (shared/anim/reactions.ts `holdReactCurves`). Each turn is kept with w at or
 * above 0, the same turn, so w can be rebuilt from x, y and z; throws if the rebuilt turn is not the solver's.
 */
export function packCurve(curve: Float64Array): string {
  const n = TURNED.length * 3, frames = curve.length / (TURNED.length * 4), q = new Int16Array(frames * n);
  for (let i = 0; i < frames * TURNED.length; i++) {
    const o = i * 4, s = curve[o + 3]! < 0 ? -1 : 1;
    const x = curve[o]! * s, y = curve[o + 1]! * s, z = curve[o + 2]! * s, w = curve[o + 3]! * s;
    const px = Math.round(x * CURVE_SCALE), py = Math.round(y * CURVE_SCALE), pz = Math.round(z * CURVE_SCALE);
    // The turn as reactions.ts rebuilds it, which must be the solver's.
    const bx = px / CURVE_SCALE, by = py / CURVE_SCALE, bz = pz / CURVE_SCALE, bw = Math.sqrt(Math.max(0, 1 - bx * bx - by * by - bz * bz));
    const off = Math.sqrt((bx - x) * (bx - x) + (by - y) * (by - y) + (bz - z) * (bz - z) + (bw - w) * (bw - w));
    if (!(w >= 0) || !(off <= PACKED_MOST)) throw new Error(`a reaction curve's turn ${i} does not pack: (${x}, ${y}, ${z}, ${w})`);
    q[i * 3] = px;
    q[i * 3 + 1] = py;
    q[i * 3 + 2] = pz;
  }
  let out = "";
  for (let run = 0; run < n; run++) {
    let a = 0, b = 0;
    for (let f = 0; f < frames; f++) {
      const v = q[f * n + run]!, r = v - 2 * a + b;
      let z = r < 0 ? -2 * r - 1 : 2 * r;
      do {
        const digit = z & 31;
        z >>>= 5;
        out += CURVE_DIGITS[z > 0 ? digit | 32 : digit];
      } while (z > 0);
      b = a;
      a = v;
    }
  }
  return out;
}

/** Every kept curve (shared/anim/reactions.ts `keptCurves`) baked and packed, one after another. */
export function packCurves(): string {
  return keptCurves().map((word) => packCurve(bakeCurve(word))).join("");
}
