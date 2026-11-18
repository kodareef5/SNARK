// Turns a pack's creature rig into the same Skeleton the humanoid uses, so one code path poses, solves and hits both.
// A rig's clips are found by its id ("core:raptor/walk"), and what each shows by its name (RIG_CLIPS,
// shared/anim/creature.ts).

import { loadHitSurfaces } from "./hit-hulls.ts";
import { type PackFootfall, type PackRig, validMassCentre } from "../pack/pack.ts";
import { PI } from "../math/scalar.ts";
import { Pose, type Clip, type ClipSet } from "./clip.ts";
import { footRadius } from "./gait.ts";
import type { Socket } from "./human.ts";
import type { RagdollDef } from "./ragdoll.ts";
import { Solved, type Skeleton } from "./skeleton.ts";

/**
 * The clips a creature plays, by name: a rig's clip ids are "<rig id>/<one of these>", which its asset maps to the actions
 * it makes them from. Besides these, each clip named "idle_" and a word plays now and then in place of a turn of its idle.
 * "held", "carried" and "jump" wait for a game that holds, carries or jumps a creature. The flyer's (the pteranodon's
 * FUNCTIONS.md, section 15; planning/reference/flyers-plan.md) wait for FL4 and FL6: taking off, hovering, flying, flying
 * fast, gliding and diving; the bite in the air and the barrel roll; grabbing, carrying in its feet and letting go; limp
 * in the air when knocked out, and dying in the air. A flyer lands by "land".
 */
export const RIG_CLIPS = [
  "idle", "walk", "run", "attack", "swim", "swim_idle", "fall", "land", "turn", "startled", "flinch", "call",
  "torpor_in", "torpor_idle", "torpor_eat", "torpor_out", "death", "held", "carried", "jump",
  "take_off", "hover", "fly", "fly_fast", "glide", "dive", "attack_air", "barrel_roll", "grab", "carry", "release",
  "torpor_fall", "death_air",
  "startled_swim", "land_swim", "torpor_out_swim",
  "attack_right", "charge_windup", "charge", "charge_stop",
  "impale_in", "impale_hold", "impale_out", "plate_switch", "plate_hardened", "plate_heavy", "plate_sharpened",
] as const;
export type RigClip = (typeof RIG_CLIPS)[number];

export interface GroundLeg {
  readonly upper: number; readonly lower: number; readonly end: number;
  readonly foot: Socket;
  readonly x: number; readonly y: number; readonly z: number;
}
export interface GroundRig {
  readonly maxTilt: number; readonly maxStep: number; readonly probe: number;
  readonly legs: readonly GroundLeg[];
}

export interface Rig extends Skeleton {
  /** Its clips, by the name its asset gives each: "walk", "attack", "idle_look". */
  readonly clips: ReadonlyMap<string, Clip>;
  /** Metres one turn of a clip carries the body, for the clips its asset gives a stride. */
  readonly strides: ReadonlyMap<string, number>;
  readonly footfalls: ReadonlyMap<string, readonly PackFootfall[]>;
  /** The bones it stands on. Gaits are lined up by the first. */
  readonly feet: readonly number[];
  /** Named points, such as where a rider sits and where it bites. */
  readonly sockets: ReadonlyMap<string, Socket>;
  readonly breath: readonly [Socket, Socket] | null;
  /** In metres. Roughly, no part of it in any pose is farther than `reach` from the ground point it stands on. `mid` is the height of its middle. */
  readonly reach: number;
  readonly mid: number;
  /** How far its feet stand from where it turns, in metres. */
  readonly turn: number;
  readonly ragdoll: RagdollDef | null;
  readonly ground: GroundRig | null;
  /** Scratch for posing it. */
  readonly a: Pose;
  readonly b: Pose;
  readonly c: Pose;
  readonly d: Pose;
  readonly e: Pose;
  readonly f: Pose;
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
  const own = new Map<string, Clip>();
  const prefix = `${r.id}/`;
  for (const c of clips.clips) if (c.id.startsWith(prefix) && c.bones === bones) own.set(c.id.slice(prefix.length), c);
  const strides = new Map<string, number>();
  for (const [name, stride] of Object.entries(r.strides ?? {})) if (stride > 0) strides.set(name, stride);
  const sockets = new Map<string, Socket>();
  for (const s of r.sockets ?? []) if (s.bone >= 0 && s.bone < bones) sockets.set(s.name, { bone: s.bone, x: s.x, y: s.y, z: s.z });
  const skeleton: Skeleton = { id: r.id, bones, names: r.names, parent: Int8Array.from(r.parent), rest, zoneBones: bones, zone, capA, capB, capR, hitSurfaces: loadHitSurfaces(r.hitSurfaces, r.parent, zone) };
  const feet = (r.feet ?? []).filter((b) => b >= 0 && b < bones);
  const footfalls = new Map<string, readonly PackFootfall[]>();
  for (const [name, rows] of Object.entries(r.footfalls ?? {})) {
    if (!own.get(name)?.loop || !Array.isArray(rows) || rows.length < 2 || rows.length > 8 || rows.length !== feet.length) continue;
    if (rows.some(f => !f || !feet.includes(f.bone) || !Number.isFinite(f.plant) || !Number.isFinite(f.lift) || !(f.plant >= 0 && f.plant < 1 && f.lift >= 0 && f.lift < 1) || f.plant === f.lift) || new Set(rows.map(f => f.bone)).size !== rows.length) continue;
    footfalls.set(name, rows);
  }
  return {
    ...skeleton,
    clips: own,
    strides,
    footfalls,
    feet,
    sockets,
    breath: breathOf(r, sockets, bones),
    // Half as far again as the rest pose reaches, plus the widest capsule radius, covers a swung limb or a lowered head.
    reach: Math.max(far, top) * 1.5 + wide,
    mid: top / 2,
    turn: footRadius(skeleton, feet),
    ragdoll: ragdollOf(r, skeleton),
    ground: groundOf(r, skeleton, sockets),
    a: new Pose(bones),
    b: new Pose(bones),
    c: new Pose(bones),
    d: new Pose(bones),
    e: new Pose(bones),
    f: new Pose(bones),
    w: new Float64Array(2),
    solved: new Solved(bones),
  };
}

/** Invalid optional airway metadata preserves the legacy eye-height breathing rule. */
function breathOf(r: PackRig, sockets: ReadonlyMap<string, Socket>, bones: number): readonly [Socket, Socket] | null {
  const pair = r.breath;
  if (!Array.isArray(pair) || pair.length !== 2 || pair[0] === pair[1]) return null;
  for (const name of pair) {
    if (typeof name !== "string" || !name || r.sockets?.filter(s => s.name === name).length !== 1) return null;
    const s = sockets.get(name);
    if (!s || !Number.isInteger(s.bone) || s.bone < 0 || s.bone >= bones || !Number.isFinite(s.x + s.y + s.z)) return null;
  }
  return [sockets.get(pair[0])!, sockets.get(pair[1])!];
}

/** Malformed optional support metadata never changes an otherwise usable legacy rig. */
function groundOf(r: PackRig, skel: Skeleton, sockets: ReadonlyMap<string, Socket>): GroundRig | null {
  const g = r.ground;
  if (!g || !(g.maxTilt >= 0 && g.maxTilt <= 45 && g.maxStep > 0 && g.maxStep <= 1 && g.probe >= g.maxStep && g.probe <= 3) || !Array.isArray(g.legs) || g.legs.length < 3 || g.legs.length > 8) return null;
  const legs: GroundLeg[] = [];
  for (const l of g.legs) {
    const foot = sockets.get(l.socket);
    if (!foot || !(l.upper > 0 && l.lower > l.upper && l.end > l.lower && l.end < skel.bones) || skel.parent[l.lower] !== l.upper || skel.parent[l.end] !== l.lower || legs.some(p => p.upper === l.upper)) return null;
    let b = foot.bone;
    while (b > l.end) b = skel.parent[b]!;
    if (b !== l.end) return null;
    legs.push({ upper: l.upper, lower: l.lower, end: l.end, foot,
      x: skel.rest[foot.bone * 3]! + foot.x, y: skel.rest[foot.bone * 3 + 1]! + foot.y, z: skel.rest[foot.bone * 3 + 2]! + foot.z });
  }
  return { maxTilt: g.maxTilt * PI / 180, maxStep: g.maxStep, probe: g.probe, legs };
}

/** The ragdoll a rig's pack entry describes, with its limits in radians. Bodies on bones without a capsule are left out. */
function ragdollOf(r: PackRig, skel: Skeleton): RagdollDef | null {
  const bodies = (r.ragdoll?.bodies ?? []).filter((b) => b.bone >= 0 && b.bone < skel.bones && skel.capR[b.bone]! > 0);
  if (bodies.length === 0) return null;
  const deg = PI / 180;
  return {
    limp: r.ragdoll!.limp,
    bone: Int16Array.from(bodies, (b) => b.bone),
    mass: Float64Array.from(bodies, (b) => b.mass),
    ...(bodies.some(b => validMassCentre(b.massCentre)) ? { massCentres: bodies.map(b => validMassCentre(b.massCentre) ? b.massCentre : undefined) } : {}),
    swing: Float64Array.from(bodies, (b) => b.swing * deg),
    twist: Float64Array.from(bodies, (b) => b.twist * deg),
    ...(r.ragdoll!.contacts?.length ? { contacts: Int16Array.from(r.ragdoll!.contacts.slice(0, 16)) } : {}),
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
