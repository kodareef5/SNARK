// The rider's poses on the board, written as code. Model space: +Z the deck's nose, +X its heel edge, the rider turned
// side-on with the left foot forward. Each trick's pose comes from its row in the trick table (shared/sim/skate-tricks.ts).
// The push follows Kenney's CC0 Mini Skate "skate" clip on the survivor's articulated legs.
// Source: https://kenney.nl/assets/mini-skate · CC0-1.0 · character-skate-boy.glb
// SHA-256 f2540556bb1bae1aabe08de36b7e6b2c19d366a6fa0f6fd31970ad7272a413d8

import { quatAxis, quatMul, type Numbers } from "../math/quat.ts";
import { PI, TAU, clamp, detSin } from "../math/scalar.ts";
import { BAIL, FLIP, GRAB, GRIND, MANUAL, OLLIE, PUSH, REVERT, SLIDE, SPECIAL } from "../sim/skate-state.ts";
import { FAM_FLIP, FAM_GRAB, FAM_GRIND, FAM_MANUAL, FAM_SLIDE, FAM_SPECIAL, SKATE_TRICKS, T_5050, T_BOARDSLIDE, T_MANUAL, trickOf } from "../sim/skate-tricks.ts";
import { clip, type PoseBuilder } from "./pose-builder.ts";
import { blendPose, type Clip, Pose, sampleClip } from "./clip.ts";
import { foot, hand } from "./limb-pose.ts";
import {
  B_CHEST, B_FOOT_L, B_FOOT_R, B_HAND_L, B_HAND_R, B_HEAD, B_HIPS, B_LOWER_ARM_L,
  B_LOWER_ARM_R, B_NECK, B_SPINE, B_UPPER_ARM_L, B_UPPER_ARM_R, HUMAN_BONES,
} from "./human.ts";

// Right ankle rise and travel, torso drop (source metres) and torso yaw (degrees) at eighths of the push.
const STROKE = [
  [0, 0, 0, 0], [.027, .082, 0, 3.77], [.108, .198, 0, 9.76],
  [.108, .208, -.007, 10.24], [-.037, .100, -.051, 3.12], [-.060, -.062, -.077, -5.96],
  [.091, -.258, -.035, -15.91], [.207, -.250, 0, -12.49], [0, 0, 0, 0],
] as const;

interface Weight {
  /** Hips down, ahead along the deck, and the torso bent forward (+) or back, in degrees. */
  drop?: number; forward?: number; bend?: number;
  /** Lean toward the heel edge (+) for balance, the torso's twist, and the arms out (0 down to 1 wide). */
  tilt?: number; twist?: number; arms?: number; armsUp?: number;
  /** A grab: how far in (0 to 1), which hand (1 front, -1 back), where on the deck (along: nose +1; across: toe +1). */
  grab?: number; hand?: number; along?: number; across?: number;
  backX?: number; backY?: number; backZ?: number; frontX?: number; frontY?: number; frontZ?: number;
}

function stance(b: PoseBuilder, w: Weight): void {
  const tilt = w.tilt ?? 0, spread = w.arms ?? 0, grab = w.grab ?? 0, twist = w.twist ?? 0, bend = w.bend ?? 0;
  const front = grab > 0 && w.hand === 1, back = grab > 0 && w.hand === -1;
  b.hips(.02 + tilt*.05, .87 - (w.drop ?? 0), -.041 + (w.forward ?? 0))
    .turn(B_HIPS, 0, -74, -tilt*7).turn(B_SPINE, 6 + bend*.5, 14 + twist, -24*grab)
    .turn(B_CHEST, 5 + bend*.5, 12, -28*grab).turn(B_NECK, -4 - bend*.4, 23 - twist*.5).turn(B_HEAD, -4 - bend*.3, 22);
  // Deck + ankle height in the model frame. The heels sit over the bolts with toes across the board.
  const ankle = .154;
  foot(b, 1, [.046 + (w.frontX ?? 0), ankle + (w.frontY ?? 0), .13 + (w.frontZ ?? 0)], [-.9, 0, .45]);
  foot(b, -1, [-.046 - (w.backX ?? 0), ankle + (w.backY ?? 0), -.22 + (w.backZ ?? 0)], [.9, 0, -.08]);
  b.turn(B_FOOT_L, 0, -58).turn(B_FOOT_R, 0, -80 + 62*Math.min(1, Math.abs(w.backX ?? 0)*5));
  const up = w.armsUp ?? 0;
  for (const side of [1, -1] as const) {
    const left = side === 1;
    if ((left && front) || (!left && back)) continue;
    b.aim(left ? B_UPPER_ARM_L : B_UPPER_ARM_R, -.25 + up*.25, -.78 + spread*.62 + side*tilt*.22 + up, side*(.54 + spread*.5) + twist*.012);
    b.aim(left ? B_LOWER_ARM_L : B_LOWER_ARM_R, -.33 + up*.3, -.66 + spread*.48 + up*1.1, side*.72 + twist*.014);
  }
  if (front || back) {
    // The hand meets the deck: +X is the heel edge, so a toe-side grab reaches to -X.
    const s = front ? 1 : -1, x = -(w.across ?? 0) * .095, z = .03 + (w.along ?? 0) * .36;
    hand(b, s, [x * s, .69 - .46*grab, z], [-1, .2, .65 * s]);
    b.level(front ? B_HAND_L : B_HAND_R).turn(front ? B_HAND_L : B_HAND_R, 0, 0, -86*grab*s);
  }
}

function flipClip(id: number): Clip {
  const t = trickOf(id), frames = Math.max(2, t.ticks);
  return clip(`human/skate/${id}`, frames, false, (b, phase) => {
    const tuck = detSin(phase*PI), flick = Math.max(0, detSin(phase*TAU));
    // A flip flicks the front foot off the toe edge (heelflip off the heel); a shove-it scoops the back foot.
    stance(b, {
      drop: .14*tuck, frontY: (.16 + .06*Math.abs(t.flip))*tuck, backY: (.12 + .08*Math.abs(t.pitch))*tuck*tuck, arms: tuck,
      frontX: -.14*flick*t.flip, backX: .1*flick*Math.min(1, Math.abs(t.shove)), backZ: -.06*flick*t.pitch,
    });
  });
}

function grabClip(id: number): Clip {
  const t = trickOf(id);
  return clip(`human/skate/${id}`, 8, false, (b, p) => {
    const hold = Math.min(1, p*2);
    stance(b, { drop: .5*hold, grab: hold, hand: t.hand, along: t.along, across: t.across,
      frontY: (.045 + (t.along > 0 ? .06 : 0))*hold, backY: (.035 + (t.along < 0 ? .06 : 0))*hold, arms: .65*hold,
      frontX: t.id % 2 ? -.06*hold : 0 });
  });
}

/** A balance pose over three frames, from leaning to the toe edge to leaning to the heel edge. */
function balanceClip(id: number, w: Weight): Clip {
  return clip(`human/skate/${id}`, 3, false, (b, p) => stance(b, { ...w, tilt: p*2-1 }));
}

function makeClips() {
  const byTrick: Clip[] = [];
  for (const t of SKATE_TRICKS) {
    if (t.family === FAM_FLIP) byTrick[t.id] = flipClip(t.id);
    else if (t.family === FAM_GRAB) byTrick[t.id] = grabClip(t.id);
    else if (t.family === FAM_GRIND) {
      byTrick[t.id] = balanceClip(t.id, { drop: .12 + .04*Math.abs(t.along), forward: .08*t.along, bend: 10*t.along, arms: 1,
        frontY: t.along < 0 ? .05 : 0, backY: t.along > 0 ? .05 : 0, twist: 8*t.across });
    } else if (t.family === FAM_SLIDE) {
      byTrick[t.id] = balanceClip(t.id, { drop: .16, forward: .06*t.along, bend: 6 + 8*t.along, arms: .9, twist: 12 });
    } else if (t.family === FAM_MANUAL) {
      byTrick[t.id] = balanceClip(t.id, { drop: .1, forward: .12*t.along, bend: 14*t.along, arms: .8 });
    } else if (t.family === FAM_SPECIAL) byTrick[t.id] = t.hand === 2
      ? clip(`human/skate/${t.id}`, 8, false, (b, p) => {
        const open = Math.min(1, p*2.5);
        stance(b, { drop: -.04*open, arms: 1, armsUp: .55*open, frontY: .05*open, backY: .05*open, bend: -10*open });
      })
      : grabClip(t.id);
  }
  return {
    byTrick,
    ride: clip("human/skate/ride", 1, false, b => stance(b, {})),
    crouch: clip("human/skate/crouch", 1, false, b => stance(b, { drop: .24, bend: 16, arms: .25, forward: .02 })),
    push: clip("human/skate/push", STROKE.length, false, (b, phase) => {
      const [rise, travel, torso, twist] = STROKE[Math.round(phase*8)]!;
      const off = Math.min(1, detSin(PI*phase)*2.3);
      stance(b, { drop: -torso*1.25, forward: off*.065, twist, backX: off*.19, backY: rise*1.6, backZ: travel*1.45 });
    }),
    air: clip("human/skate/ollie", 13, false, (b, phase) => {
      const tuck = detSin(phase*PI);
      stance(b, { drop: .14*tuck, frontY: .16*tuck, backY: .12*tuck*tuck, arms: tuck });
    }),
    revert: clip("human/skate/revert", 8, false, (b, p) => {
      const lean = detSin(p*PI);
      stance(b, { drop: .1 + .08*lean, bend: 12*lean, arms: .7*lean, twist: -18*lean, backY: .03*lean });
    }),
    bail: clip("human/skate/bail", 8, false, (b, p) => {
      const fall = Math.min(1, p*1.6);
      stance(b, { drop: .1*fall, bend: -26*fall, arms: 1, armsUp: .8*fall, tilt: .8*fall, frontY: .1*fall, backY: .2*fall });
    }),
  };
}

let clips: ReturnType<typeof makeClips> | undefined;
export function skateClips() { return clips ??= makeClips(); }

const crouched = new Pose(HUMAN_BONES);
const fraction = (angle: number): number => angle / TAU - Math.floor(angle / TAU);

/** The rider's pose for a move and trick at the phase the board's wheel angle carries, crouched by `crouch` (0 to 1). */
export function sampleSkater(move: number, trick: number, angle: number, steer: number, out: Pose, crouch = 0): void {
  const c = skateClips();
  let motion: Clip, t = fraction(angle);
  switch (move) {
    case PUSH: motion = c.push; break;
    case FLIP: case GRAB: case SPECIAL: motion = c.byTrick[trick] ?? c.air; break;
    case GRIND: case SLIDE: case MANUAL:
      motion = c.byTrick[trick] ?? c.byTrick[move === GRIND ? T_5050 : move === SLIDE ? T_BOARDSLIDE : T_MANUAL]!;
      t = .5 + clamp(steer, -1, 1)*.5;
      break;
    case OLLIE: motion = c.air; break;
    case REVERT: motion = c.revert; break;
    case BAIL: motion = c.bail; break;
    default: motion = c.ride;
  }
  sampleClip(motion, t*(motion.frames - 1), out);
  if (crouch > 0) {
    sampleClip(c.crouch, 0, crouched);
    blendPose(out, out, crouched, Math.min(1, crouch) * (move === GRIND || move === SLIDE || move === MANUAL ? .6 : 1));
  }
}

const axis = new Float64Array(4);
/** The deck's own turn within its frame: a flip's, a shove-it's and an impossible's, a grab's tweak, a bail's tumble. */
export function skateDeckRotation(move: number, trick: number, angle: number, out: Numbers): void {
  const t = fraction(angle), row = trickOf(trick);
  if (move === FLIP) {
    quatAxis(out, 0, 0, 1, 0, row.shove * t * TAU);
    if (row.flip) { quatAxis(axis, 0, 0, 0, 1, row.flip * t * TAU); quatMul(out, 0, out, 0, axis, 0); }
    if (row.pitch) { quatAxis(axis, 0, 1, 0, 0, row.pitch * t * TAU); quatMul(out, 0, out, 0, axis, 0); }
  } else if (move === GRAB || move === SPECIAL) quatAxis(out, 0, 0, 0, 1, -.28 * Math.min(1, t*2) * (row.across || 1));
  else if (move === OLLIE) quatAxis(out, 0, 1, 0, 0, -.24 * detSin(t*TAU));
  else if (move === BAIL) {
    quatAxis(out, 0, 0, 0, 1, t * TAU);
    quatAxis(axis, 0, 0, 1, 0, t * PI); quatMul(out, 0, axis, 0, out, 0);
  }
}
