// The cuts: what each hides, where each opening ends, how far off the skin it sits, and how its sheet is unrolled.
// Distances are metres. Hems reach past the farthest point of the zones they hide by CLEAR at the levels drawn with
// materials, and by less at the flat levels, whose borders are coarser (see reachClear).

import {
  B_FOOT_L, B_FOOT_R, B_HAND_L, B_HAND_R, B_HIPS, B_LOWER_ARM_L, B_LOWER_ARM_R, B_LOWER_LEG_L, B_LOWER_LEG_R, B_NECK, B_SPINE, B_TOE_L, B_TOE_R, B_UPPER_ARM_L, B_UPPER_ARM_R,
  B_UPPER_CHEST, B_UPPER_LEG_L, B_UPPER_LEG_R,
} from "../../../../../shared/anim/human.ts";
import {
  SKIN_ABDOMEN, SKIN_ANKLE_L, SKIN_ANKLE_R, SKIN_CHEST, SKIN_COLLAR, SKIN_FOOT_L, SKIN_FOOT_R, SKIN_FOREARM_L, SKIN_FOREARM_R, SKIN_NECK, SKIN_PELVIS, SKIN_SHIN_L, SKIN_SHIN_R, SKIN_THIGH_LOW_L,
  SKIN_THIGH_LOW_R, SKIN_THIGH_TOP_L, SKIN_THIGH_TOP_R, SKIN_UPPER_ARM_LOW_L, SKIN_UPPER_ARM_LOW_R, SKIN_UPPER_ARM_TOP_L, SKIN_UPPER_ARM_TOP_R, SKIN_WAIST, SKIN_WRIST_L, SKIN_WRIST_R,
} from "../../../../../shared/anim/skin-zones.ts";
import { SHEETS, type SheetName } from "../../../../../shared/people/cuts.ts";
import { ACCENT, flatPanel, joint, MAIN, ringPanel, skinPointsOf, TRIM, type CutDef, type Hem, type Panel, type Rest } from "./build.ts";
import { across, unit, type RingFrame, type Vec } from "./rings.ts";
import { apron, footLoft, joined } from "./shapes.ts";
import type { Skin } from "./skin.ts";

/** How far past the hidden zones' farthest point a hem reaches: at the levels with materials, the first flat and the last. */
export const CLEAR: readonly number[] = [0.02, 0.02, 0.006, 0];

const X: Vec = [1, 0, 0], Y: Vec = [0, 1, 0], Z: Vec = [0, 0, 1];
const neg = (v: Vec): Vec => [-v[0], -v[1], -v[2]];
const between = (a: Vec, b: Vec): Vec => unit([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);

/** A ring up or down the body about a vertical line through x, z, with its seam out along `seam`. */
const vertical = (x: number, y: number, z: number, down: boolean, seam: Vec, quarter: Vec): RingFrame => ({ origin: [x, y, z], axis: down ? neg(Y) : Y, seam, quarter });

/** The trunk's middle in depth at the upper chest, and the height of the top sheet's first row. */
const trunkZ = (rest: Rest): number => joint(rest, B_UPPER_CHEST)[2];
const topOf = (rest: Rest): number => joint(rest, B_NECK)[1] + 0.12;
/** Where the arms leave the trunk on the top sheet: a little in from the shoulder joint. */
const armAt = (rest: Rest): number => joint(rest, B_UPPER_ARM_L)[0] - 0.005;

// ---- Hems ----

const collar = (extra = 0, rib = 0.018, into = [SKIN_COLLAR, SKIN_NECK]): Hem => ({
  name: "collar", into,
  frame: (rest) => vertical(0, 0, joint(rest, B_NECK)[2], false, neg(Z), neg(X)),
  near: (p, rest) => Math.hypot(p[0], p[2] - joint(rest, B_NECK)[2]) < 0.13 && p[1] > joint(rest, B_NECK)[1] - 0.06,
  extra, rib,
});

/** A hem down the trunk into the hips or the thighs, straight across. */
const waistDown = (extra: number, rib = 0, flare = 0): Hem => ({
  name: "waist", into: [SKIN_PELVIS, SKIN_THIGH_TOP_L, SKIN_THIGH_TOP_R, SKIN_THIGH_LOW_L, SKIN_THIGH_LOW_R],
  frame: (rest) => vertical(0, 0, trunkZ(rest), true, neg(Z), X),
  near: (p, rest) => p[1] < joint(rest, B_HIPS)[1] + 0.2,
  straight: true, extra, rib, flare, flareOver: 0.12,
});

/** A hem up the trunk from the hips, following the hips' border. */
const waistUp = (extra: number, rib = 0.035): Hem => ({
  name: "waist", into: [SKIN_WAIST, SKIN_ABDOMEN],
  frame: (rest) => vertical(0, 0, joint(rest, B_HIPS)[2], false, neg(Z), X),
  near: (p, rest) => p[1] > joint(rest, B_HIPS)[1] - 0.05 && Math.abs(p[0]) < 0.25,
  extra, rib,
});

/** Down an arm from `from` towards `to`, past the hidden zones into `into`. */
const armHem = (name: string, into: number[], from: number, to: number, side: 1 | -1, o: Partial<Hem> = {}): Hem => ({
  name, into,
  frame: (rest) => {
    const a = between(joint(rest, from), joint(rest, to));
    return { origin: joint(rest, from), axis: a, seam: across(neg(Y), a), quarter: across(neg(Z), a) };
  },
  near: (p, rest) => p[0] * side > joint(rest, B_UPPER_ARM_L)[0] - 0.02,
  straight: true, ...o,
});

/** Down a leg from the hip, past the hidden zones into `into`. */
const legHem = (name: string, into: number[], from: number, to: number, side: 1 | -1, o: Partial<Hem> = {}): Hem => ({
  name, into,
  frame: (rest) => {
    const a = between(joint(rest, from), joint(rest, to));
    return { origin: joint(rest, from), axis: a, seam: across([-side, 0, 0], a), quarter: across(Z, a) };
  },
  near: (p, rest) => p[0] * side > 0 && p[1] < joint(rest, from)[1] + 0.05,
  straight: true, ...o,
});

/** Along an arm hem's frame, a little short of the wrist. */
const wrist = (from: number, to: number, hand: number) => (rest: Rest): number => {
  const a = between(joint(rest, from), joint(rest, to));
  const d = [0, 1, 2].map((k) => joint(rest, hand)[k]! - joint(rest, from)[k]!);
  return d[0]! * a[0] + d[1]! * a[1] + d[2]! * a[2] - 0.01;
};

// ---- Offsets ----

/** Zones of the trunk and arms, as a garment's offset reads them. */
const ARM_TOP = [SKIN_UPPER_ARM_TOP_L, SKIN_UPPER_ARM_TOP_R], ARM_LOW = [SKIN_UPPER_ARM_LOW_L, SKIN_UPPER_ARM_LOW_R], FOREARM = [SKIN_FOREARM_L, SKIN_FOREARM_R, SKIN_WRIST_L, SKIN_WRIST_R];
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** A top's offset: `chest` over the chest and shoulders, growing to `belly` at the hips, `arm` on the sleeves. */
const topOffset = (chest: number, belly: number, arm: number) => (zone: number, p: Vec, rest: Rest): number => {
  if (ARM_TOP.includes(zone) || ARM_LOW.includes(zone) || FOREARM.includes(zone)) return arm;
  const y = p[1];
  const chestY = joint(rest, B_UPPER_CHEST)[1], hipY = joint(rest, B_HIPS)[1];
  const t = smooth(chestY, hipY, y);
  // The neck's ring, for the collar, sits close.
  if (zone === SKIN_NECK) return Math.min(chest, 0.004);
  return chest + (belly - chest) * t;
};

// ---- Panels ----

/** The zones a trunk's ring is measured on, and a leg's. */
const TRUNK = [SKIN_NECK, SKIN_COLLAR, SKIN_CHEST, SKIN_ABDOMEN, SKIN_WAIST, SKIN_PELVIS, SKIN_THIGH_TOP_L, SKIN_THIGH_TOP_R];
const LEG_ZONES = [SKIN_ABDOMEN, SKIN_WAIST, SKIN_PELVIS, SKIN_ANKLE_L, SKIN_ANKLE_R, SKIN_THIGH_TOP_L, SKIN_THIGH_LOW_L, SKIN_SHIN_L, SKIN_THIGH_TOP_R, SKIN_THIGH_LOW_R, SKIN_SHIN_R];

/** The top sheet's panels on a body: the trunk round from the right side seam, each arm from the shoulder. */
export function topPanels(rest: Rest, skin: Skin): Panel[] {
  const x0 = armAt(rest), top = topOf(rest), z = trunkZ(rest);
  const trunk = (p: Vec): boolean => Math.abs(p[0]) <= x0;
  const torso = ringPanel("top", "torso", vertical(0, top, z, true, neg(X), Z), skinPointsOf(skin, TRUNK, trunk), trunk, "u");
  const arm = (side: 1 | -1): Panel => {
    const from = joint(rest, side > 0 ? B_UPPER_ARM_L : B_UPPER_ARM_R), to = joint(rest, side > 0 ? B_LOWER_ARM_L : B_LOWER_ARM_R);
    const a = between(from, to);
    const origin: Vec = [x0 * side, from[1], from[2]];
    const on = (p: Vec): boolean => p[0] * side > x0;
    // Seen from its own side as the arm hangs, a sleeve runs from the shoulder down and round from the front.
    const frame = { origin, axis: a, seam: across(neg(Y), a), quarter: across(side > 0 ? Z : neg(Z), a) };
    return ringPanel("top", side > 0 ? "left sleeve" : "right sleeve", frame, skinPointsOf(skin, side > 0 ? [SKIN_UPPER_ARM_TOP_L, SKIN_UPPER_ARM_LOW_L, SKIN_FOREARM_L, SKIN_WRIST_L] : [SKIN_UPPER_ARM_TOP_R, SKIN_UPPER_ARM_LOW_R, SKIN_FOREARM_R, SKIN_WRIST_R], on), on, "u");
  };
  return [{ ...torso, bounds: [(p) => p[0] - x0, (p) => p[0] + x0] }, arm(1), arm(-1)];
}

/** The bottom sheet's panels: each half of the hips and its leg, round from its inside seam. */
export function bottomPanels(rest: Rest, skin: Skin): Panel[] {
  const leg = (side: 1 | -1): Panel => {
    const hip = joint(rest, side > 0 ? B_UPPER_LEG_L : B_UPPER_LEG_R);
    const top = joint(rest, B_HIPS)[1] + 0.22;
    const on = (p: Vec): boolean => p[0] * side >= 0;
    const frame = vertical(hip[0], top, hip[2], true, [-side, 0, 0], side > 0 ? Z : neg(Z));
    return ringPanel("bottom", side > 0 ? "left leg" : "right leg", frame, skinPointsOf(skin, LEG_ZONES, (p) => on(p) && p[1] < top), on, "u");
  };
  return [{ ...leg(1), bounds: [(p) => p[0]] }, leg(-1)];
}

/**
 * The shoes' panels, looked at from a line along each foot: what looks out sideways is unrolled round the shoe from the
 * heel, what looks up is its top seen from above and what looks down its sole seen from below, both with the toe up.
 */
export function shoePanels(rest: Rest, skin: Skin): Panel[] {
  const out: Panel[] = [];
  for (const side of [1, -1] as const) {
    const name = side > 0 ? "left" : "right";
    const mine = (p: Vec): boolean => p[0] * side > 0;
    const zones = [side > 0 ? SKIN_FOOT_L : SKIN_FOOT_R, side > 0 ? SKIN_ANKLE_L : SKIN_ANKLE_R, side > 0 ? SKIN_SHIN_L : SKIN_SHIN_R];
    const foot = joint(rest, side > 0 ? B_FOOT_L : B_FOOT_R);
    const top = foot[1] + 0.1;
    const pts = skinPointsOf(skin, [zones[0]!]);
    let zLo = Infinity, zHi = -Infinity;
    for (let i = 2; i < pts.length; i += 3) [zLo, zHi] = [Math.min(zLo, pts[i]!), Math.max(zHi, pts[i]!)];
    // The line is an L: up the ankle, and from the ankle's foot along to the toe.
    const ankle: Vec = [foot[0], 0.035, foot[2]], shin: Vec = [foot[0], 0.3, foot[2]], toe: Vec = [foot[0], 0.03, zHi - 0.06];
    const fromSegment = (p: Vec, a: Vec, b: Vec): Vec => {
      const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0]! + (p[1] - a[1]) * d[1]! + (p[2] - a[2]) * d[2]!) / (d[0]! ** 2 + d[1]! ** 2 + d[2]! ** 2)));
      return [p[0] - a[0] - t * d[0]!, p[1] - a[1] - t * d[1]!, p[2] - a[2] - t * d[2]!];
    };
    /** Which way a point looks out from the line along the foot. */
    const look = (p: Vec): Vec => {
      const a = fromSegment(p, ankle, shin), b = fromSegment(p, ankle, toe);
      return unit(Math.hypot(...a) < Math.hypot(...b) ? a : b);
    };
    const up = (p: Vec): number => (mine(p) ? look(p)[1] - SHOE_FACE : -1), down = (p: Vec): number => (mine(p) ? -look(p)[1] - SHOE_FACE : -1);
    const around = (p: Vec): boolean => mine(p) && up(p) < 0 && down(p) < 0;
    // Each side seen from beside it, upright and unmirrored: the outer side's right is towards the heel.
    const outer = (p: Vec): number => (mine(p) ? look(p)[0] * side : 0);
    const sideOn = (sign: number) => (p: Vec): boolean => around(p) && outer(p) * sign >= 0;
    out.push(flatPanel("shoes", `${name} outer`, skinPointsOf(skin, zones, (p) => sideOn(1)(p) && p[1] < top), side > 0 ? neg(Z) : Z, neg(Y), sideOn(1), [up, down, outer]));
    out.push(flatPanel("shoes", `${name} inner`, skinPointsOf(skin, zones, (p) => sideOn(-1)(p) && p[1] < top), side > 0 ? Z : neg(Z), neg(Y), sideOn(-1)));
    out.push(flatPanel("shoes", `${name} top`, skinPointsOf(skin, zones, (p) => mine(p) && up(p) > 0 && p[1] < top), neg(X), neg(Z), (p) => mine(p) && up(p) >= 0));
    out.push(flatPanel("shoes", `${name} sole`, skinPointsOf(skin, zones, (p) => mine(p) && down(p) > 0), X, neg(Z), (p) => mine(p) && down(p) >= 0));
  }
  return out;
}

/** How far up or down a shoe's part looks, past which it is on the top or the sole and not round the sides. */
const SHOE_FACE = 0.72;

/** The sheet a cut's panels are on, by name. */
export const PANELS: Readonly<Record<SheetName, (rest: Rest, skin: Skin) => Panel[]>> = {
  top: topPanels, bottom: bottomPanels, shoes: shoePanels, apron: () => [],
};


// ---- Cuts ----

/** A top hangs from a little above the hips. */
const DRAPE = { below: (rest: Rest) => joint(rest, B_HIPS)[1] + 0.1, zones: [SKIN_ABDOMEN, SKIN_WAIST, SKIN_PELVIS, SKIN_THIGH_TOP_L, SKIN_THIGH_TOP_R, SKIN_THIGH_LOW_L, SKIN_THIGH_LOW_R] };

const HIDE_TEE = [SKIN_CHEST, SKIN_ABDOMEN, SKIN_WAIST, SKIN_UPPER_ARM_TOP_L, SKIN_UPPER_ARM_TOP_R];

export const TEE: CutDef = {
  name: "tee", sheet: "top", covers: HIDE_TEE,
  hems: [
    collar(),
    waistDown(0.015, 0, 0.004),
    armHem("left sleeve", [SKIN_UPPER_ARM_LOW_L], B_UPPER_ARM_L, B_LOWER_ARM_L, 1, { flare: 0.006, flareOver: 0.06 }),
    armHem("right sleeve", [SKIN_UPPER_ARM_LOW_R], B_UPPER_ARM_R, B_LOWER_ARM_R, -1, { flare: 0.006, flareOver: 0.06 }),
  ],
  offset: topOffset(0.005, 0.011, 0.007), least: 0.003, drape: DRAPE,
};

export const TEE_LOOSE: CutDef = {
  name: "tee_loose", sheet: "top", covers: HIDE_TEE,
  hems: [
    collar(0.004, 0.022),
    waistDown(0.035, 0, 0.012),
    armHem("left sleeve", [SKIN_UPPER_ARM_LOW_L], B_UPPER_ARM_L, B_LOWER_ARM_L, 1, { extra: 0.05, flare: 0.012, flareOver: 0.1 }),
    armHem("right sleeve", [SKIN_UPPER_ARM_LOW_R], B_UPPER_ARM_R, B_LOWER_ARM_R, -1, { extra: 0.05, flare: 0.012, flareOver: 0.1 }),
  ],
  offset: topOffset(0.012, 0.022, 0.016), least: 0.005, smooth: 16, drape: DRAPE,
};

/** The hood lies bunched on the upper back and round the neck: how much more off the skin it stands there. */
const hood = (p: Vec, rest: Rest): number => {
  const neck = joint(rest, B_NECK);
  const behind = smooth(0.02, -0.05, p[2] - neck[2]);
  const down = neck[1] - p[1];
  const band = smooth(-0.05, 0.02, down) * (1 - smooth(0.12, 0.24, down));
  const wide = 1 - smooth(0.12, 0.2, Math.abs(p[0]));
  return 0.032 * behind * band * wide + 0.01 * band * wide;
};

export const HOODIE: CutDef = {
  name: "hoodie", sheet: "top", covers: [...HIDE_TEE, SKIN_COLLAR, SKIN_UPPER_ARM_LOW_L, SKIN_UPPER_ARM_LOW_R, SKIN_FOREARM_L, SKIN_FOREARM_R],
  hems: [
    collar(0.01, 0.03, [SKIN_NECK]),
    waistDown(0.03, 0.05, -0.004),
    armHem("left cuff", [SKIN_WRIST_L], B_UPPER_ARM_L, B_LOWER_ARM_L, 1, { atLeast: wrist(B_UPPER_ARM_L, B_LOWER_ARM_L, B_HAND_L), rib: 0.05, flare: -0.008, flareOver: 0.05 }),
    armHem("right cuff", [SKIN_WRIST_R], B_UPPER_ARM_R, B_LOWER_ARM_R, -1, { atLeast: wrist(B_UPPER_ARM_R, B_LOWER_ARM_R, B_HAND_R), rib: 0.05, flare: -0.008, flareOver: 0.05 }),
  ],
  offset: (zone, p, rest) => topOffset(0.016, 0.026, 0.02)(zone, p, rest) + (zone === SKIN_NECK ? 0 : hood(p, rest)), least: 0.008, smooth: 16, drape: DRAPE,
  region: (p, inside, hem, rest) => {
    if (hem?.rib && inside < hem.rib) return TRIM;
    // The pouch pocket across the belly.
    const hips = joint(rest, B_HIPS)[1];
    if (p[2] > 0.02 && Math.abs(p[0]) < 0.12 && p[1] > hips + 0.02 && p[1] < hips + 0.17) return ACCENT;
    return MAIN;
  },
};

const HIDE_LEGS = [SKIN_PELVIS, SKIN_THIGH_TOP_L, SKIN_THIGH_LOW_L, SKIN_SHIN_L, SKIN_THIGH_TOP_R, SKIN_THIGH_LOW_R, SKIN_SHIN_R];
const legOffset = (hip: number, knee: number, ankle: number) => (zone: number, p: Vec, rest: Rest): number => {
  const k = joint(rest, B_LOWER_LEG_L)[1];
  if (zone === SKIN_ABDOMEN || zone === SKIN_WAIST) return hip;
  if (p[1] > k) return hip + (knee - hip) * smooth(joint(rest, B_HIPS)[1] - 0.05, k, p[1]);
  return knee + (ankle - knee) * smooth(k, 0.1, p[1]);
};

export const JEANS: CutDef = {
  name: "jeans", sheet: "bottom", covers: HIDE_LEGS,
  hems: [
    waistUp(0.005),
    legHem("left hem", [SKIN_ANKLE_L, SKIN_FOOT_L], B_LOWER_LEG_L, B_FOOT_L, 1, { flare: 0.004, atLeast: wrist(B_LOWER_LEG_L, B_FOOT_L, B_FOOT_L) }),
    legHem("right hem", [SKIN_ANKLE_R, SKIN_FOOT_R], B_LOWER_LEG_R, B_FOOT_R, -1, { flare: 0.004, atLeast: wrist(B_LOWER_LEG_R, B_FOOT_R, B_FOOT_R) }),
  ],
  offset: legOffset(0.005, 0.01, 0.016), least: 0.0035, smooth: 14,
  region: (p, inside, hem, rest) => {
    if (hem?.name === "waist" && inside < (hem.rib ?? 0)) return TRIM;
    // Back pockets and the front pockets' openings.
    const hips = joint(rest, B_HIPS)[1];
    if (p[2] < -0.06 && Math.abs(p[0]) > 0.03 && Math.abs(p[0]) < 0.13 && p[1] > hips - 0.1 && p[1] < hips + 0.04) return ACCENT;
    return MAIN;
  },
};

export const SHORTS: CutDef = {
  name: "shorts", sheet: "bottom", covers: [SKIN_PELVIS, SKIN_THIGH_TOP_L, SKIN_THIGH_TOP_R],
  hems: [
    waistUp(0.005),
    legHem("left leg", [SKIN_THIGH_LOW_L], B_UPPER_LEG_L, B_LOWER_LEG_L, 1, { flare: 0.01, flareOver: 0.1 }),
    legHem("right leg", [SKIN_THIGH_LOW_R], B_UPPER_LEG_R, B_LOWER_LEG_R, -1, { flare: 0.01, flareOver: 0.1 }),
  ],
  offset: legOffset(0.005, 0.012, 0.012), least: 0.0035, smooth: 14,
  region: JEANS.region,
};

export const TRAINERS: CutDef = {
  name: "trainers", sheet: "shoes", covers: [SKIN_FOOT_L, SKIN_FOOT_R],
  hems: [
    { ...legHem("left collar", [SKIN_ANKLE_L, SKIN_SHIN_L], B_FOOT_L, B_LOWER_LEG_L, 1, { flare: 0.012, flareOver: 0.04 }), near: (p) => p[0] > 0 },
    { ...legHem("right collar", [SKIN_ANKLE_R, SKIN_SHIN_R], B_FOOT_R, B_LOWER_LEG_R, -1, { flare: 0.012, flareOver: 0.04 }), near: (p) => p[0] < 0 },
  ],
  offset: (zone, p) => (p[1] < 0.03 ? 0.008 : 0.006) + 0.006 * smooth(0.0, 0.05, p[2] - 0.05),
  least: 0.004, smooth: 6, facing: 0.012, floor: 0,
  shape: (skin, rest) => {
    const top = (b: number): number => joint(rest, b)[1] + 0.12;
    return joined(footLoft(skin, new Set([SKIN_FOOT_L, SKIN_ANKLE_L, SKIN_SHIN_L]), 1, top(B_FOOT_L)), footLoft(skin, new Set([SKIN_FOOT_R, SKIN_ANKLE_R, SKIN_SHIN_R]), -1, top(B_FOOT_R)));
  },
  rigid: (w, p) => {
    const left = p[0] > 0;
    const [foot, toe] = left ? [B_FOOT_L, B_TOE_L] : [B_FOOT_R, B_TOE_R];
    return w[toe]! > w[foot]! ? toe : foot;
  },
  region: (p) => (p[1] < 0.026 ? TRIM : MAIN),
};

export const APRON: CutDef = {
  name: "apron", sheet: "apron", covers: [], hems: [],
  offset: () => 0, least: 0.004, smooth: 0, ownWeights: true,
  shape: (skin, rest) => {
    const r = (b: number): Vec => joint(rest, b);
    const sheet = SHEETS.apron, rect = (name: string) => sheet.panels.find((p) => p.name === name)!.rect;
    return apron(skin, {
      top: r(B_UPPER_CHEST)[1] + 0.07, waist: r(B_SPINE)[1] + 0.01, hem: r(B_LOWER_LEG_L)[1] + 0.07,
      bib: 0.11, hips: 0.2, skirt: 0.23, nape: r(B_NECK)[1] + 0.005, neckZ: r(B_NECK)[2], trunkZ: trunkZ(rest),
      neck: (z) => [SKIN_NECK, SKIN_COLLAR, SKIN_CHEST].includes(z), belt: (z) => [SKIN_ABDOMEN, SKIN_WAIST, SKIN_PELVIS].includes(z),
      metres: sheet.metres, front: rect("front"), back: rect("back"), straps: rect("straps"),
    }, (z) => [SKIN_CHEST, SKIN_COLLAR, SKIN_NECK, SKIN_ABDOMEN, SKIN_WAIST, SKIN_PELVIS, SKIN_THIGH_TOP_L, SKIN_THIGH_TOP_R, SKIN_THIGH_LOW_L, SKIN_THIGH_LOW_R].includes(z));
  },
  region: (p, _inside, _hem, rest) => {
    const waist = joint(rest, B_SPINE)[1];
    if (p[2] < trunkZ(rest) - 0.02 || p[1] > joint(rest, B_UPPER_CHEST)[1] + 0.075) return TRIM;
    if (Math.abs(p[0]) < 0.13 && p[1] < waist - 0.06 && p[1] > waist - 0.22) return ACCENT;
    return MAIN;
  },
};

/** Every cut made on a body's skin, in the order the pack lists them. */
export const BODY_CUTS: readonly CutDef[] = [TEE, TEE_LOOSE, HOODIE, JEANS, SHORTS, TRAINERS, APRON];

