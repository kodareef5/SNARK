// A creature's carriage in a turn: its spine bent into the turn, its neck and head leading it, its tail swung out and its
// whole body rolled a little into it, more the faster it turns and goes. It reads only the pose state and keeps nothing,
// so the server's hit zones and bite sockets and every client's drawing agree.

import { PI } from "../math/scalar.ts";
import { quatAxis, quatIdentity, quatMul, quatRotate, quatUnrotate } from "../math/quat.ts";
import type { Pose } from "./clip.ts";
import { SPEED_STEP, TURN_STEPS, turnOf, type AnimState } from "./pose.ts";
import type { Rig } from "./rigs.ts";

const DEG = PI / 180;
/** At a full turn: the spine's bend from hips to chest, the lead of neck and head on it, and the tail's swing out. */
export const BEND = 4 * DEG;
export const LEAD = 6 * DEG;
export const SWING = 10 * DEG;
/** Its roll into a full turn at a walk, and at three times that speed or more. */
export const ROLL_WALK = 2 * DEG;
export const ROLL_FAST = 6 * DEG;

const up = new Float64Array(3);
const axis = new Float64Array(3);
const m = new Float64Array(4);
const q = new Float64Array(4);
const v = new Float64Array(3);
const path = new Int16Array(128);

/** What one species turns: the spine after its root, the neck and head, and the tail, and the speed it walks at. */
export class Carriage {
  readonly rig: Rig;
  readonly bend: Uint8Array;
  readonly lead: Uint8Array;
  readonly swing: Uint8Array;
  readonly walk: number;

  constructor(rig: Rig, walk: number) {
    const s = rig.sections;
    this.rig = rig;
    this.bend = Uint8Array.from(s.spine.slice(1));
    this.lead = Uint8Array.from(s.head >= 0 ? [...s.neck, s.head] : s.neck);
    this.swing = Uint8Array.from(s.tail);
    this.walk = walk;
  }

  /** Bends `out` for the turn and speed `st` carries. Nothing for no turn or no speed. */
  apply(st: AnimState, out: Pose): void {
    const steps = turnOf(st.dir);
    const speed = st.speed * SPEED_STEP;
    if (steps === 0 || !(speed > 0) || !(this.walk > 0)) return;
    const x = speed / this.walk;
    const k = (steps / TURN_STEPS) * (x >= 1 ? 1 : x * x * (3 - 2 * x));
    const rig = this.rig;
    // About the trunk's up, as its root carries it.
    quatRotate(out.rot, 0, 0, 1, 0, up, 0);
    turnChain(rig, out, this.bend, k * BEND, false);
    turnChain(rig, out, this.lead, k * LEAD, true);
    // Turned the same way as the front, the tail behind swings to the outside.
    turnChain(rig, out, this.swing, k * SWING, false);
    // The whole body leans into the turn about a line on the ground along its length, the turn's left a roll to its left.
    const fast = (x - 1) / 2;
    const roll = k * (ROLL_WALK + (ROLL_FAST - ROLL_WALK) * (fast <= 0 ? 0 : fast >= 1 ? 1 : fast));
    quatAxis(q, 0, 0, 0, 1, -roll);
    quatMul(out.rot, 0, q, 0, out.rot, 0);
    const rest = rig.rest;
    quatRotate(q, 0, rest[0]! + out.root[0]!, rest[1]! + out.root[1]!, rest[2]! + out.root[2]!, v, 0);
    for (let c = 0; c < 3; c++) out.root[c] = v[c]! - rest[c]!;
  }
}

/**
 * Turns each bone of `bones`, a chain root first, about `up` in the model's space: by equal shares of `total`, or with
 * `ramp` by shares growing toward its end.
 */
function turnChain(rig: Rig, out: Pose, bones: Uint8Array, total: number, ramp: boolean): void {
  const n = bones.length;
  if (n === 0 || total === 0) return;
  modelTurn(rig, out, rig.parent[bones[0]!]!);
  const sum = ramp ? (n * (n + 1)) / 2 : n;
  for (let i = 0; i < n; i++) {
    const b = bones[i]!;
    // The axis in the bone's parent's frame, which its own turn is given in.
    quatUnrotate(m, 0, up[0]!, up[1]!, up[2]!, axis, 0);
    quatAxis(q, 0, axis[0]!, axis[1]!, axis[2]!, (total * (ramp ? i + 1 : 1)) / sum);
    quatMul(out.rot, b * 4, q, 0, out.rot, b * 4);
    quatMul(m, 0, m, 0, out.rot, b * 4);
  }
}

/** Bone `bone`'s turn in the model's space, as `out` has it, into m: identity for none. */
function modelTurn(rig: Rig, out: Pose, bone: number): void {
  let n = 0;
  for (let b = bone; b >= 0; b = rig.parent[b]!) path[n++] = b;
  quatIdentity(m, 0);
  while (n > 0) quatMul(m, 0, m, 0, out.rot, path[--n]! * 4);
}
