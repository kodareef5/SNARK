// A rig made in code: a body on two straight legs a metre long, with a tail and a head. Its walk and run plant each foot
// for half the turn and carry it straight back along the ground, the body dropping as the leg leans, so a foot that is
// down does not move at all when the clip is played by the ground covered. It dies by falling onto its side.

import type { Clip, ClipSet } from "../../shared/anim/clip.ts";
import { ZONE_HEAD, ZONE_LEG_L, ZONE_LEG_R, ZONE_TORSO } from "../../shared/anim/human.ts";
import { buildRig, type Rig } from "../../shared/anim/rigs.ts";
import type { PackRig } from "../../shared/pack/pack.ts";

export const STRIDER = "t:strider";
/** Bones: the body, each hip and foot, the tail and the head. */
export const [BODY, HIP_L, FOOT_L, HIP_R, FOOT_R, TAIL, HEAD] = [0, 1, 2, 3, 4, 5, 6];
/** Metres one turn carries it: four times the reach of a foot fore and aft of its hip. */
export const WALK_STRIDE = 1.2;
export const RUN_STRIDE = 2;
export const LIMP = 8;

/** A turn of `angle` about X then of `side` about Z, as x, y, z, w. */
function legTurn(angle: number, side: number): number[] {
  const [sx, cx, sz, cz] = [Math.sin(angle / 2), Math.cos(angle / 2), Math.sin(side / 2), Math.cos(side / 2)];
  return [cz * sx, sz * sx, sz * cx, cz * cx];
}

/** A loop of `frames` whose feet reach `reach` metres fore and aft of their hips. */
function gait(name: string, frames: number, reach: number): Clip {
  const rot = new Float32Array(frames * 7 * 4);
  const root = new Float32Array(frames * 3);
  for (let k = 3; k < rot.length; k += 4) rot[k] = 1;
  for (let f = 0; f < frames; f++) {
    const phase = f / frames;
    for (const [hip, shift, out] of [[HIP_L, 0, 1], [HIP_R, 0.5, -1]] as const) {
      const p = (phase + shift) % 1;
      // Down for the first half, carried back along the ground; up for the second, lifted out to the side.
      const down = p < 0.5;
      const u = down ? p / 0.5 : (p - 0.5) / 0.5;
      const z = down ? reach - 2 * reach * u : -reach + 2 * reach * u;
      const lean = -Math.asin(z);
      rot.set(legTurn(lean, down ? 0 : out * 0.35 * Math.sin(Math.PI * u)), (f * 7 + hip) * 4);
      if (down) root[f * 3 + 1] = Math.cos(lean) - 1;
    }
  }
  return { id: `${STRIDER}/${name}`, bones: 7, frames, loop: true, rot, root };
}

/** Falls onto its right side over twenty frames and lies there. */
function death(): Clip {
  const frames = 30;
  const rot = new Float32Array(frames * 7 * 4);
  const root = new Float32Array(frames * 3);
  for (let k = 3; k < rot.length; k += 4) rot[k] = 1;
  for (let f = 0; f < frames; f++) {
    const k = Math.min(1, f / 20);
    const a = (k * Math.PI) / 2;
    rot.set([0, 0, Math.sin(a / 2), Math.cos(a / 2)], f * 7 * 4);
    root[f * 3 + 1] = -0.75 * k * k;
  }
  return { id: `${STRIDER}/death`, bones: 7, frames, loop: false, rot, root };
}

export function striderClips(): Clip[] {
  const idle: Clip = { id: `${STRIDER}/idle`, bones: 7, frames: 2, loop: true, rot: new Float32Array(2 * 7 * 4).map((_, i) => (i % 4 === 3 ? 1 : 0)), root: new Float32Array(6) };
  return [idle, gait("walk", 24, WALK_STRIDE / 4), gait("run", 16, RUN_STRIDE / 4), death()];
}

export const STRIDER_RIG: PackRig = {
  id: STRIDER,
  skeleton: "strider",
  rest: [0, 1, 0, 0.2, 1, 0, 0.2, 0, 0, -0.2, 1, 0, -0.2, 0, 0, 0, 1, -0.5, 0, 1.3, 0.4],
  names: ["body", "hip.L", "foot.L", "hip.R", "foot.R", "tail", "head"],
  parent: [-1, 0, 1, 0, 3, 0, 0],
  caps: [
    BODY, ZONE_TORSO, 0, 0, -0.3, 0, 0, 0.3, 0.25,
    HIP_L, ZONE_LEG_L, 0, -0.15, 0, 0, -0.85, 0, 0.08,
    HIP_R, ZONE_LEG_R, 0, -0.15, 0, 0, -0.85, 0, 0.08,
    TAIL, ZONE_TORSO, 0, 0, -0.1, 0, 0, -0.6, 0.08,
    HEAD, ZONE_HEAD, 0, 0, 0, 0, 0, 0.2, 0.12,
  ],
  sockets: [],
  feet: [FOOT_L, FOOT_R],
  strides: { walk: WALK_STRIDE, run: RUN_STRIDE },
  ragdoll: {
    limp: LIMP,
    bodies: [
      { bone: BODY, mass: 0.6, swing: 0, twist: 0 },
      { bone: HIP_L, mass: 0.1, swing: 80, twist: 30 },
      { bone: HIP_R, mass: 0.1, swing: 80, twist: 30 },
      { bone: TAIL, mass: 0.06, swing: 45, twist: 20 },
      { bone: HEAD, mass: 0.08, swing: 60, twist: 30 },
    ],
  },
};

export function striderSet(): ClipSet {
  const clips = striderClips();
  return { clips, index: new Map(clips.map((c, i) => [c.id, i])), hash: 0 };
}

export function strider(): Rig {
  return buildRig(STRIDER_RIG, striderSet())!;
}
