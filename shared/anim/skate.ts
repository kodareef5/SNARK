// The push follows Kenney's CC0 Mini Skate "skate" clip on the survivor's articulated legs.
// Source: https://kenney.nl/assets/mini-skate · CC0-1.0 · character-skate-boy.glb
// SHA-256 f2540556bb1bae1aabe08de36b7e6b2c19d366a6fa0f6fd31970ad7272a413d8

import { quatAxis, quatMul, type Numbers } from "../math/quat.ts";
import { PI, TAU, clamp, detSin } from "../math/scalar.ts";
import { GRAB, GRIND, KICKFLIP, MANUAL, OLLIE, PUSH, SHOVE, SPIN } from "../sim/skate-state.ts";
import { clip, type PoseBuilder } from "./authored.ts";
import { type Clip, type Pose, sampleClip } from "./clip.ts";
import { foot, hand } from "./emote-clips.ts";
import {
  B_CHEST, B_FOOT_L, B_FOOT_R, B_HAND_L, B_HEAD, B_HIPS, B_LOWER_ARM_L,
  B_LOWER_ARM_R, B_NECK, B_SPINE, B_UPPER_ARM_L, B_UPPER_ARM_R,
} from "./human.ts";

// Right ankle rise and travel, torso drop (source metres) and torso yaw (degrees) at eighths of the push.
const STROKE = [
  [0, 0, 0, 0], [.027, .082, 0, 3.77], [.108, .198, 0, 9.76],
  [.108, .208, -.007, 10.24], [-.037, .100, -.051, 3.12], [-.060, -.062, -.077, -5.96],
  [.091, -.258, -.035, -15.91], [.207, -.250, 0, -12.49], [0, 0, 0, 0],
] as const;

interface Weight {
  drop?: number; forward?: number; tilt?: number; twist?: number; arms?: number; grab?: number;
  backX?: number; backY?: number; backZ?: number; frontY?: number; frontX?: number;
}

function stance(b: PoseBuilder, w: Weight): void {
  const tilt = w.tilt ?? 0, spread = w.arms ?? 0, grab = w.grab ?? 0, twist = w.twist ?? 0;
  b.hips(.02 + tilt*.05, .87 - (w.drop ?? 0), -.041 + (w.forward ?? 0))
    .turn(B_HIPS, 0, -74, -tilt*7).turn(B_SPINE, 6, 14 + twist, -24*grab)
    .turn(B_CHEST, 5, 12, -28*grab).turn(B_NECK, -4, 23 - twist*.5).turn(B_HEAD, -4, 22);
  // Deck + ankle height in the model frame. The heels sit over the bolts with toes across the board.
  const ankle = .154;
  foot(b, 1, [.046 + (w.frontX ?? 0), ankle + (w.frontY ?? 0), .13], [-.9, 0, .45]);
  foot(b, -1, [-.046 - (w.backX ?? 0), ankle + (w.backY ?? 0), -.22 + (w.backZ ?? 0)], [.9, 0, -.08]);
  b.turn(B_FOOT_L, 0, -58).turn(B_FOOT_R, 0, -80 + 62*Math.min(1, (w.backX ?? 0)*5));
  for (const side of [1, -1] as const) {
    const left = side === 1;
    b.aim(left ? B_UPPER_ARM_L : B_UPPER_ARM_R, -.25, -.78 + spread*.62 + side*tilt*.22, side*(.54 + spread*.5) + twist*.012);
    b.aim(left ? B_LOWER_ARM_L : B_LOWER_ARM_R, -.33, -.66 + spread*.48, side*.72 + twist*.014);
  }
  if (grab > 0) {
    hand(b, 1, [.095, .69 - .46*grab, .075], [-1, .2, .65]);
    b.level(B_HAND_L).turn(B_HAND_L, 0, 0, -86*grab);
  }
}

function makeClips() {
  return {
    ride: clip("human/skate/ride", 1, false, b => stance(b, {})),
    push: clip("human/skate/push", STROKE.length, false, (b, phase) => {
      const [rise, travel, torso, twist] = STROKE[Math.round(phase*8)]!;
      const off = Math.min(1, detSin(PI*phase)*2.3);
      stance(b, { drop: -torso*1.25, forward: off*.065, twist, backX: off*.19, backY: rise*1.6, backZ: travel*1.45 });
    }),
    air: clip("human/skate/ollie", 13, false, (b, phase) => {
      const tuck = detSin(phase*PI);
      stance(b, { drop: .14*tuck, frontY: .16*tuck, backY: .12*tuck*tuck, arms: tuck });
    }),
    flip: clip("human/skate/kickflip", 13, false, (b, phase) => {
      const tuck = detSin(phase*PI), flick = Math.max(0, detSin(phase*TAU));
      stance(b, { drop: .14*tuck, frontY: .21*tuck, frontX: -.14*flick, backY: .19*tuck, arms: tuck });
    }),
    grab: clip("human/skate/melon", 8, false, (b, p) => {
      const hold = Math.min(1, p*2);
      stance(b, { drop: .50*hold, grab: hold, frontY: .045*hold, backY: .035*hold, arms: .65*hold });
    }),
    manual: clip("human/skate/manual", 3, false, (b, p) => stance(b, { drop: .10, forward: -.12, tilt: p*2-1, arms: .8 })),
    grind: clip("human/skate/grind", 3, false, (b, p) => stance(b, { drop: .12, tilt: p*2-1, arms: 1 })),
  };
}

let clips: ReturnType<typeof makeClips> | undefined;
export function skateClips() { return clips ??= makeClips(); }

const turn = new Float64Array(4);
const fraction = (angle: number): number => angle / TAU - Math.floor(angle / TAU);

export function sampleSkater(move: number, angle: number, steer: number, out: Pose, switched = false): void {
  const c = skateClips();
  let motion: Clip, t = fraction(angle);
  switch (move) {
    case PUSH: motion = c.push; break;
    case GRAB: motion = c.grab; break;
    case GRIND: case MANUAL:
      motion = move === GRIND ? c.grind : c.manual;
      t = .5 + clamp(steer, -1, 1)*.5;
      break;
    case KICKFLIP: motion = c.flip; break;
    case OLLIE: case SHOVE: case SPIN: motion = c.air; break;
    default: motion = c.ride;
  }
  sampleClip(motion, t*(motion.frames - 1), out);
  if (move === SPIN) {
    quatAxis(turn, 0, 0, 1, 0, t*PI*(switched ? -1 : 1));
    quatMul(out.rot, B_HIPS*4, turn, 0, out.rot, B_HIPS*4);
  }
}

export function skateDeckRotation(move: number, angle: number, out: Numbers): void {
  const t = fraction(angle);
  if (move === KICKFLIP) quatAxis(out, 0, 0, 0, 1, t*TAU);
  else if (move === SHOVE || move === SPIN) quatAxis(out, 0, 0, 1, 0, t*(move === SPIN ? PI : TAU));
  else if (move === GRAB) quatAxis(out, 0, 0, 0, 1, -.28*Math.min(1, t*2));
  else if (move === OLLIE) quatAxis(out, 0, 1, 0, 0, -.24*detSin(t*TAU));
}
