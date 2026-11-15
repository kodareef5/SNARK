// A rig made in code with the dodo's 21 clips: the same names, lengths, loops and layers as its rig.py gives them, and the
// same hand-overs, so the creature states can be tested before and beside the dodo's pack. torpor_in ends where
// torpor_idle begins and torpor_out begins, startled ends on run's first frame, the layers start and end at rest and turn
// nothing below the hips, and the peck (named attack, as the dodo's asset names it) bends the neck furthest on its sixth
// frame, where its bite lands.

import type { Clip, ClipSet } from "../../shared/anim/clip.ts";
import { PI, detCos, detSin } from "../../shared/math/scalar.ts";
import { CreatureAnim } from "../../shared/anim/creature.ts";
import { ZONE_HEAD, ZONE_LEG_L, ZONE_LEG_R, ZONE_TORSO } from "../../shared/anim/human.ts";
import { buildRig, type Rig } from "../../shared/anim/rigs.ts";
import type { PackRig } from "../../shared/pack/pack.ts";

export const BIRD = "t:bird";
export const [PELVIS, BELLY, CHEST, NECK, SKULL, JAW, THIGH_L, SHIN_L, TOES_L, THIGH_R, SHIN_R, TOES_R, WING_L, WING_R, TAIL] = Array.from({ length: 15 }, (_, i) => i);
const BONES = 15;
export const WALK_STRIDE = 0.35;
export const RUN_STRIDE = 0.55;
/** The frame of the peck its bite lands on, as the dodo's does. */
export const PECK_HIT = 6;

type Turns = [bone: number, ax: number, ay: number, az: number, angle: number][];

/** One frame: turns about the model's axes per bone, and the root's offset. */
function frame(turns: Turns, root: [number, number, number] = [0, 0, 0]): { rot: Float32Array; root: [number, number, number] } {
  const rot = new Float32Array(BONES * 4);
  for (let b = 0; b < BONES; b++) rot[b * 4 + 3] = 1;
  for (const [b, ax, ay, az, angle] of turns) {
    const s = detSin(angle / 2);
    const q = [ax * s, ay * s, az * s, detCos(angle / 2)];
    // Composed after any turn already given the bone.
    const p = Array.from(rot.subarray(b * 4, b * 4 + 4));
    rot[b * 4] = p[3]! * q[0]! + p[0]! * q[3]! + p[1]! * q[2]! - p[2]! * q[1]!;
    rot[b * 4 + 1] = p[3]! * q[1]! - p[0]! * q[2]! + p[1]! * q[3]! + p[2]! * q[0]!;
    rot[b * 4 + 2] = p[3]! * q[2]! + p[0]! * q[1]! - p[1]! * q[0]! + p[2]! * q[3]!;
    rot[b * 4 + 3] = p[3]! * q[3]! - p[0]! * q[0]! - p[1]! * q[1]! - p[2]! * q[2]!;
  }
  return { rot, root };
}

function make(name: string, frames: number, loop: boolean, at: (f: number) => { rot: Float32Array; root: [number, number, number] }): Clip {
  const rot = new Float32Array(frames * BONES * 4);
  const root = new Float32Array(frames * 3);
  for (let f = 0; f < frames; f++) {
    const p = at(f);
    rot.set(p.rot, f * BONES * 4);
    root.set(p.root, f * 3);
  }
  return { id: `${BIRD}/${name}`, bones: BONES, frames, loop, rot, root };
}

/** Rises from 0 to 1 and back over [from, to], peaking at `peak`. */
function bump(f: number, from: number, peak: number, to: number): number {
  if (f <= from || f >= to) return 0;
  const x = f < peak ? (f - from) / (peak - from) : (to - f) / (to - peak);
  return x * x * (3 - 2 * x);
}

const wave = (f: number, n: number): number => detSin((2 * PI * f) / n);

/** Lying on its left side, knocked out. */
const LIE: Turns = [[PELVIS, 0, 0, 1, 1.43], [NECK, 1, 0, 0, 0.6]];
const LIE_ROOT: [number, number, number] = [0.05, -0.2, -0.01];
/** Dead on its right side. */
const DEAD: Turns = [[PELVIS, 0, 0, 1, -1.43], [NECK, 1, 0, 0, 0.9], [JAW, 1, 0, 0, 0.3]];
const DEAD_ROOT: [number, number, number] = [-0.05, -0.2, 0];

/** A gait whose feet swing fore and aft by `reach` radians. */
function gaitTurns(f: number, n: number, reach: number): Turns {
  const s = wave(f, n);
  return [[THIGH_L, 1, 0, 0, -reach * detCos((2 * PI * f) / n)], [THIGH_R, 1, 0, 0, reach * detCos((2 * PI * f) / n)], [CHEST, 0, 0, 1, 0.05 * s], [TAIL, 0, 1, 0, 0.1 * s]];
}

function mix(a: Turns, b: Turns, k: number): Turns {
  return [...a.map(([bone, x, y, z, angle]) => [bone, x, y, z, angle * (1 - k)] as Turns[number]), ...b.map(([bone, x, y, z, angle]) => [bone, x, y, z, angle * k] as Turns[number])];
}

const lerp3 = (a: [number, number, number], b: [number, number, number], k: number): [number, number, number] => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const ease = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const REST: [number, number, number] = [0, 0, 0];

export function birdClips(): Clip[] {
  const run0 = gaitTurns(0, 12, 0.6);
  return [
    make("idle", 150, true, (f) => frame([[CHEST, 1, 0, 0, 0.03 * wave(f, 150)]])),
    make("idle_look", 90, false, (f) => frame([[SKULL, 0, 1, 0, 0.5 * detSin((PI * f) / 89) * wave(f, 89)]])),
    make("idle_peck", 75, false, (f) => frame([[NECK, 1, 0, 0, 0.9 * bump(f, 0, 30, 74)]])),
    make("call", 66, false, (f) => frame([[SKULL, 1, 0, 0, -0.5 * bump(f, 0, 20, 65)], [JAW, 1, 0, 0, 0.6 * bump(f, 5, 25, 60)]])),
    make("walk", 16, true, (f) => frame(gaitTurns(f, 16, 0.4))),
    make("run", 12, true, (f) => frame(gaitTurns(f, 12, 0.6))),
    make("turn", 24, false, (f) => frame([[THIGH_L, 1, 0, 0, -0.3 * bump(f, 2, 5, 8)], [THIGH_R, 1, 0, 0, -0.3 * bump(f, 6, 9, 12)], [SKULL, 0, 1, 0, 0.3 * bump(f, 0, 9, 23)]])),
    make("swim", 20, true, (f) => frame([[THIGH_L, 1, 0, 0, 0.5 * wave(f, 20)], [THIGH_R, 1, 0, 0, -0.5 * wave(f, 20)]], [0, 0.2, 0])),
    make("swim_idle", 45, true, (f) => frame([[THIGH_L, 1, 0, 0, 0.2 * wave(f, 45)]], [0, 0.2 + 0.01 * wave(f, 45), 0])),
    make("fall", 12, true, (f) => frame([[WING_L, 0, 0, 1, -1 - 0.3 * wave(f, 12)], [WING_R, 0, 0, 1, 1 + 0.3 * wave(f, 12)], [THIGH_L, 1, 0, 0, 0.3]])),
    make("land", 18, false, (f) => frame([[WING_L, 0, 0, 1, -1 * (1 - ease(f / 10))], [WING_R, 0, 0, 1, 1 * (1 - ease(f / 10))]], [0, -0.08 * bump(f, 0, 4, 17), 0])),
    // The peck, under the name the engine plays an attack by, as the dodo's asset names it.
    make("attack", 15, false, (f) => frame([[NECK, 1, 0, 0, 1.0 * bump(f, 0, PECK_HIT, 14)]])),
    make("flinch", 15, false, (f) => frame([[CHEST, 0, 0, 1, 0.2 * bump(f, 0, 3, 14)], [SKULL, 1, 0, 0, -0.3 * bump(f, 0, 4, 14)]])),
    make("held", 120, true, (f) => frame([[THIGH_L, 1, 0, 0, 0.4 + 0.05 * wave(f, 120)], [THIGH_R, 1, 0, 0, 0.4 - 0.05 * wave(f, 120)]])),
    make("carried", 120, true, (f) => frame([[THIGH_L, 1, 0, 0, 0.5], [THIGH_R, 1, 0, 0, 0.5], [WING_L, 0, 0, 1, -0.5 * (1 + wave(f, 120)) / 2]])),
    make("torpor_eat", 30, false, (f) => frame([[NECK, 1, 0, 0, -0.3 * bump(f, 0, 10, 29)], [JAW, 1, 0, 0, 0.3 * bump(f, 4, 12, 22)]])),
    make("startled", 20, false, (f) => frame(mix([[SKULL, 1, 0, 0, -0.6 * bump(f, 0, 6, 16)], [WING_L, 0, 0, 1, -1.2 * bump(f, 0, 6, 19)], [WING_R, 0, 0, 1, 1.2 * bump(f, 0, 6, 19)]], run0, ease((f - 13) / 6)), [0, 0.04 * bump(f, 2, 6, 11), 0])),
    make("torpor_in", 60, false, (f) => frame(mix([], LIE, ease(f / 59)), lerp3(REST, LIE_ROOT, ease(f / 59)))),
    make("torpor_idle", 300, true, (f) => frame([...LIE, [CHEST, 1, 0, 0, 0.04 * bump(f, 0, 30, 72) + 0.05 * bump(f, 72, 110, 160)]], LIE_ROOT)),
    make("torpor_out", 75, false, (f) => frame(mix(LIE, [], ease(f / 74)), lerp3(LIE_ROOT, REST, ease(f / 74)))),
    make("death", 48, false, (f) => frame(mix([], DEAD, ease(f / 40)), lerp3(REST, DEAD_ROOT, ease(f / 40)))),
  ];
}

export const BIRD_RIG: PackRig = {
  id: BIRD,
  skeleton: "bird",
  // Joints as the dodo's rig.py places them, in metres: +X its left, +Y up, +Z ahead.
  rest: [
    0, 0.29, -0.03, 0, 0.3, 0.025, 0, 0.325, 0.08, 0, 0.37, 0.125, 0, 0.55, 0.15, 0, 0.548, 0.195,
    0.055, 0.29, -0.03, 0.065, 0.2, 0.04, 0.056, 0.02, 0.008, -0.055, 0.29, -0.03, -0.065, 0.2, 0.04, -0.056, 0.02, 0.008,
    0.094, 0.312, 0.068, -0.094, 0.312, 0.068, 0, 0.345, -0.16,
  ],
  names: ["pelvis", "belly", "chest", "neck", "skull", "jaw", "thigh_l", "shin_l", "toes_l", "thigh_r", "shin_r", "toes_r", "wing_l", "wing_r", "tail"],
  parent: [-1, 0, 1, 2, 3, 4, 0, 6, 7, 0, 9, 10, 2, 2, 0],
  caps: [
    PELVIS, ZONE_TORSO, 0, -0.04, -0.15, 0, -0.04, 0.2, 0.13,
    NECK, ZONE_TORSO, 0, 0, 0, 0, 0.17, 0.02, 0.05,
    SKULL, ZONE_HEAD, 0, 0.04, 0, 0, 0, 0.18, 0.05,
    SHIN_L, ZONE_LEG_L, 0, 0, 0, 0, -0.18, -0.03, 0.025,
    SHIN_R, ZONE_LEG_R, 0, 0, 0, 0, -0.18, -0.03, 0.025,
  ],
  sockets: [{ name: "beak_tip", bone: SKULL, x: 0, y: -0.05, z: 0.182 }],
  feet: [TOES_L, TOES_R],
  strides: { walk: WALK_STRIDE, run: RUN_STRIDE },
  ragdoll: {
    limp: 47,
    bodies: [
      { bone: PELVIS, mass: 0.7, swing: 0, twist: 0 },
      { bone: SKULL, mass: 0.1, swing: 60, twist: 30 },
      { bone: SHIN_L, mass: 0.03, swing: 70, twist: 10 },
      { bone: SHIN_R, mass: 0.03, swing: 70, twist: 10 },
    ],
  },
};

export function birdSet(): ClipSet {
  const clips = birdClips();
  return { clips, index: new Map(clips.map((c, i) => [c.id, i])), hash: 0 };
}

export function birdRig(): Rig {
  return buildRig(BIRD_RIG, birdSet())!;
}

/** The bird as the dodo's species plays it: a walk of 0.65 m/s, a run from 0.975 m/s, a swim of 3 m/s. */
export function birdAnim(rig: Rig = birdRig()): CreatureAnim {
  return new CreatureAnim(rig, 0.975, 3);
}
