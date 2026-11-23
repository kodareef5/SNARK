// The named parts of a creature's rig, found as it loads from its bones' names and parents: its spine, neck, head, jaw,
// tail and legs. A rig whose names do not settle a part has a line in OVERRIDES. From those parts comes a second
// ragdoll, the live one, for reactions of a body that is still alive; a corpse keeps the rig's own.

import { PI } from "../math/scalar.ts";
import type { Socket } from "./human.ts";
import type { RagdollDef } from "./ragdoll.ts";
import type { Skeleton } from "./skeleton.ts";

export interface RigSections {
  /** From the root to the bone the neck hangs from, root first. */
  readonly spine: readonly number[];
  /** From the trunk to the head, the head left out. */
  readonly neck: readonly number[];
  /** The head and its lower jaw, or -1. */
  readonly head: number;
  readonly jaw: number;
  /** From the trunk to the tip. */
  readonly tail: readonly number[];
  /** Each limb from its hip or shoulder to its tip, in bone order. */
  readonly legs: readonly (readonly number[])[];
}

/** A rig with no head, such as a vehicle's, has no parts. */
export const NO_SECTIONS: RigSections = { spine: [], neck: [], head: -1, jaw: -1, tail: [], legs: [] };

/** What names cannot settle, by rig id: the first bone of each leg. */
const OVERRIDES: Readonly<Record<string, { readonly legs?: readonly string[] }>> = {
  // Its legs hang from girdle bones at the middle of its body, named as legs.
  "core:raptor": { legs: ["BackUpLeg.L", "BackUpLeg.R", "FrontUpLeg.L", "FrontUpLeg.R"] },
};

/** A limb with no foot is one named so, off the trunk. */
const LIMB = /leg|arm|humerus/i;

/** `feet` are the bones it stands on, and `legTops` the upper bone and foot bone of each leg its ground support names. */
export function rigSections(skel: Skeleton, feet: readonly number[], sockets: ReadonlyMap<string, Socket>, legTops: readonly (readonly [number, number])[]): RigSections {
  const { names, parent, bones } = skel;
  let head = sockets.get("head")?.bone ?? -1;
  if (!(head > 0 && head < bones)) head = names.findIndex((n) => /^(head|skull)$/i.test(n));
  if (head <= 0) return NO_SECTIONS;
  const children: number[][] = Array.from({ length: bones }, () => []);
  for (let b = 1; b < bones; b++) if (parent[b]! >= 0) children[parent[b]!]!.push(b);
  const neck: number[] = [];
  for (let b = parent[head]!; b > 0 && /neck/i.test(names[b]!); b = parent[b]!) neck.unshift(b);
  const spine = fromRoot(parent, neck.length > 0 ? parent[neck[0]!]! : parent[head]!);
  const jaw = children[head]!.find((b) => /jaw/i.test(names[b]!)) ?? -1;
  const tailed = (b: number): boolean => b >= 0 && /tail/i.test(names[b]!);
  const roots = names.flatMap((_, b) => (b > 0 && tailed(b) && !tailed(parent[b]!) ? [b] : []));
  const tail: number[] = [];
  for (let b = roots.length === 1 ? roots[0]! : -1; b >= 0; ) {
    tail.push(b);
    const next = children[b]!.filter(tailed);
    b = next.length === 1 ? next[0]! : -1;
  }
  // The trunk is the spine and the bones from the root to where the tail hangs.
  const trunk = new Set([...spine, ...(tail.length > 0 ? fromRoot(parent, parent[tail[0]!]!) : [])]);
  const taken = new Set([...trunk, ...neck, head, ...tail]);
  const tips = new Uint8Array(bones);
  for (const b of feet) tips[b] = 1;
  for (const [, foot] of legTops) tips[foot] = 1;
  // Whether a bone or one below it is a foot. Parents come before their children, so one pass from the end carries it up.
  const toward = Uint8Array.from(tips);
  for (let b = bones - 1; b > 0; b--) if (toward[b] && parent[b]! >= 0) toward[parent[b]!] = 1;
  let firsts: number[];
  const over = OVERRIDES[skel.id]?.legs;
  if (over) firsts = over.map((n) => names.indexOf(n)).filter((b) => b > 0);
  else if (legTops.length > 0) firsts = legTops.map(([upper]) => upper);
  else {
    firsts = [];
    for (const foot of feet) {
      let b = foot;
      while (b > 0 && !trunk.has(parent[b]!)) b = parent[b]!;
      if (b > 0 && !taken.has(b) && !firsts.includes(b)) firsts.push(b);
    }
    for (const t of trunk) for (const c of children[t]!) if (!taken.has(c) && !firsts.includes(c) && LIMB.test(names[c]!) && children[c]!.length > 0) firsts.push(c);
  }
  const legs = firsts.sort((a, b) => a - b).map((first) => {
    const chain = [first];
    for (let b = first; ; ) {
      const kids = children[b]!;
      const ahead = kids.length === 1 ? kids : kids.filter((k) => toward[k]);
      if (ahead.length !== 1) break;
      b = ahead[0]!;
      chain.push(b);
    }
    return chain;
  });
  return { spine, neck, head, jaw, tail, legs };
}

/** The bones from the root down to `bone`, root first. */
function fromRoot(parent: Int8Array, bone: number): number[] {
  const out: number[] = [];
  for (let b = bone; b >= 0; b = parent[b]!) out.unshift(b);
  return out;
}

const DEG = PI / 180;
/** How far a whole neck and a whole tail may turn, shared among their bodies, with the least and the most for one. */
const NECK_TURN = 70 * DEG;
const NECK_LEAST = 15 * DEG;
const NECK_MOST = 35 * DEG;
const NECK_TWIST = 15 * DEG;
const TAIL_TURN = 80 * DEG;
const TAIL_LEAST = 10 * DEG;
const TAIL_MOST = 40 * DEG;
const TAIL_TWIST = 10 * DEG;
const HEAD_SWING = 30 * DEG;
const HEAD_TWIST = 30 * DEG;
const LEG_SWING = 60 * DEG;
const LEG_TWIST = 20 * DEG;
/** The chest against the hips. */
const CHEST_SWING = 15 * DEG;
const CHEST_TWIST = 10 * DEG;

/**
 * The ragdoll of a living body: its hips and chest, each bone of its neck, its head, each bone of its tail and the top
 * bone of each leg. A bone with no capsule rides the nearest body above it. Each body's mass is its share of the capsule
 * volume it carries, its own and that of the capsules riding it. Null for a rig with no trunk to hang the rest from.
 */
export function liveRagdoll(skel: Skeleton, s: RigSections): RagdollDef | null {
  const capped = (b: number): boolean => b >= 0 && skel.capR[b]! > 0;
  const trunk = s.spine.filter(capped);
  if (trunk.length === 0) return null;
  const root = trunk[0]!;
  const limits = new Map<number, readonly [number, number]>([[root, [0, 0]]]);
  if (trunk.length > 1) limits.set(trunk[trunk.length - 1]!, [CHEST_SWING, CHEST_TWIST]);
  const neck = s.neck.filter(capped);
  for (const b of neck) limits.set(b, [within(NECK_TURN / neck.length, NECK_LEAST, NECK_MOST), NECK_TWIST]);
  if (capped(s.head)) limits.set(s.head, [HEAD_SWING, HEAD_TWIST]);
  const tail = s.tail.filter(capped);
  for (const b of tail) limits.set(b, [within(TAIL_TURN / tail.length, TAIL_LEAST, TAIL_MOST), TAIL_TWIST]);
  for (const leg of s.legs) if (capped(leg[0]!)) limits.set(leg[0]!, [LEG_SWING, LEG_TWIST]);
  // Every body hangs from the first: one in another branch would have nothing to be held to.
  const bone = [...limits.keys()].filter((b) => below(skel.parent, b, root)).sort((a, b) => a - b);
  const body = new Int16Array(skel.bones).fill(-1);
  bone.forEach((b, i) => (body[b] = i));
  const volume = new Float64Array(bone.length);
  for (let b = 0; b < skel.bones; b++) {
    if (!capped(b)) continue;
    let o = -1;
    for (let a = b; a >= 0 && o < 0; a = skel.parent[a]!) o = body[a]!;
    volume[o < 0 ? 0 : o]! += capsuleVolume(skel, b);
  }
  let total = 0;
  for (const v of volume) total += v;
  return {
    limp: 0,
    bone: Int16Array.from(bone),
    mass: Float64Array.from(volume, (v) => v / total),
    swing: Float64Array.from(bone, (b) => limits.get(b)![0]),
    twist: Float64Array.from(bone, (b) => limits.get(b)![1]),
  };
}

function within(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Whether `bone` is `top` or below it. */
function below(parent: Int8Array, bone: number, top: number): boolean {
  for (let b = bone; b >= 0; b = parent[b]!) if (b === top) return true;
  return false;
}

/** A capsule's volume over pi: its cylinder and its two half spheres. */
function capsuleVolume(skel: Skeleton, b: number): number {
  const dx = skel.capB[b * 3]! - skel.capA[b * 3]!, dy = skel.capB[b * 3 + 1]! - skel.capA[b * 3 + 1]!, dz = skel.capB[b * 3 + 2]! - skel.capA[b * 3 + 2]!;
  const r = skel.capR[b]!;
  return r * r * (Math.sqrt(dx * dx + dy * dy + dz * dz) + (4 * r) / 3);
}
