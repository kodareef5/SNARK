// Turns a pack's creature rig into the same Skeleton the humanoid uses, so one code path poses, solves and hits both.
// A rig's clips are found by its id ("core:raptor/walk").

import type { PackRig } from "../pack/pack.ts";
import { Pose, type Clip, type ClipSet } from "./clip.ts";
import { footRadius, footStart, gaitClip, type GaitClip } from "./gait.ts";
import type { Socket } from "./human.ts";
import { Solved, type Skeleton } from "./skeleton.ts";

/** A rig's clip ids are "<rig id>/<one of these>". */
export const RIG_CLIPS = ["idle", "walk", "run", "attack", "jump", "death"] as const;

export interface Rig extends Skeleton {
  /** Null for a clip the rig lacks. */
  readonly idle: Clip | null;
  readonly walk: Clip | null;
  readonly run: Clip | null;
  readonly attack: Clip | null;
  readonly jump: Clip | null;
  readonly death: Clip | null;
  /** Named points, such as where a rider sits and where it bites. */
  readonly sockets: ReadonlyMap<string, Socket>;
  /** In metres. Roughly, no part of it in any pose is farther than `reach` from the ground point it stands on. `mid` is the height of its middle. */
  readonly reach: number;
  readonly mid: number;
  /** Its walk and run as gaits, where its asset gives them a stride, null where not. */
  readonly walkGait: GaitClip | null;
  readonly runGait: GaitClip | null;
  /** Every moving clip it has, slowest first, when all of them have a stride and so blend in step. Otherwise empty. */
  readonly gaits: readonly GaitClip[];
  /** How far its feet stand from where it turns, in metres. */
  readonly turn: number;
  /** Scratch for posing it. */
  readonly a: Pose;
  readonly b: Pose;
  readonly c: Pose;
  readonly w: Float64Array;
  readonly solved: Solved;
}

/** Returns null for a rig without bones of its own, which is only a body's proportions on a skeleton written in code. */
export function buildRig(r: PackRig, clips: ClipSet): Rig | null {
  if (!r.names || !r.parent || r.parent.length !== r.names.length || r.rest.length !== r.names.length * 3) return null;
  const bones = r.names.length;
  if (bones > 127) return null;
  const zone = new Uint8Array(bones);
  const capA = new Float32Array(bones * 3);
  const capB = new Float32Array(bones * 3);
  const capR = new Float32Array(bones);
  const caps = r.caps ?? [];
  let wide = 0;
  for (let k = 0; k + 8 < caps.length; k += 9) {
    const b = caps[k]!;
    if (!(b >= 0 && b < bones)) continue;
    zone[b] = caps[k + 1]!;
    for (let a = 0; a < 3; a++) {
      capA[b * 3 + a] = caps[k + 2 + a]!;
      capB[b * 3 + a] = caps[k + 5 + a]!;
    }
    capR[b] = caps[k + 8]!;
    if (capR[b]! > wide) wide = capR[b]!;
  }
  const rest = Float32Array.from(r.rest);
  let far = 0;
  let top = 0;
  for (let b = 0; b < bones; b++) {
    const d = Math.sqrt(rest[b * 3]! * rest[b * 3]! + rest[b * 3 + 2]! * rest[b * 3 + 2]!);
    if (d > far) far = d;
    if (rest[b * 3 + 1]! > top) top = rest[b * 3 + 1]!;
  }
  const clip = (name: string): Clip | null => {
    const c = clips.clips[clips.index.get(`${r.id}/${name}`) ?? -1];
    return c && c.bones === bones ? c : null;
  };
  const sockets = new Map<string, Socket>();
  for (const s of r.sockets ?? []) if (s.bone >= 0 && s.bone < bones) sockets.set(s.name, { bone: s.bone, x: s.x, y: s.y, z: s.z });
  const skeleton: Skeleton = { id: r.id, bones, names: r.names, parent: Int8Array.from(r.parent), rest, zoneBones: bones, zone, capA, capB, capR };
  const feet = (r.feet ?? []).filter((b) => b >= 0 && b < bones);
  const a = new Pose(bones);
  const solved = new Solved(bones);
  const gait = (name: string): GaitClip | null => {
    const c = clip(name);
    const stride = r.strides?.[name];
    return c && c.loop && stride !== undefined && stride > 0 ? gaitClip(c, stride, feet.length > 0 ? footStart(skeleton, c, feet[0]!, a, solved) : 0) : null;
  };
  const walk = clip("walk");
  const run = clip("run");
  const walkGait = gait("walk");
  const runGait = gait("run");
  const moving = [walk ? walkGait : undefined, run ? runGait : undefined].filter((g) => g !== undefined);
  return {
    ...skeleton,
    idle: clip("idle"),
    walk,
    run,
    attack: clip("attack"),
    jump: clip("jump"),
    death: clip("death"),
    sockets,
    // Half as far again as the rest pose reaches, plus the widest capsule radius, covers a swung limb or a lowered head.
    reach: Math.max(far, top) * 1.5 + wide,
    mid: top / 2,
    walkGait,
    runGait,
    gaits: moving.length > 0 && moving.every((g) => g !== null) ? (moving as GaitClip[]).sort((p, q) => p.speed - q.speed) : [],
    turn: footRadius(skeleton, feet),
    a,
    b: new Pose(bones),
    c: new Pose(bones),
    w: new Float64Array(2),
    solved,
  };
}


export function buildRigs(rigs: readonly PackRig[], clips: ClipSet): Map<string, Rig> {
  const out = new Map<string, Rig>();
  for (const r of rigs) {
    const rig = buildRig(r, clips);
    if (rig) out.set(r.id, rig);
  }
  return out;
}
