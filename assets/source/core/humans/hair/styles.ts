// The hair and beard styles, each made on a head's own skin (head.ts) as patches and cards (build.ts). A cap is the hair
// over the scalp, from a whorl out to the hairline; long hair hangs a curtain from it; a ponytail is a tube and buns are
// balls. Each hair style also has an under-hat form: pressed flat to the scalp under the brim, with what stands above
// it (buns) left off, and its cards only where they show below the brim.
//
// Angles are degrees: theta down from straight up over the middle of the skull, phi round from the front towards the
// head's left. Every style is symmetric but a parting's.

import { B_UPPER_CHEST, B_HEAD } from "../../../../../shared/anim/human.ts";
import { anglesOf, deg, direction, keepOut, onHead, sample, type Head, type Vec } from "./head.ts";
import { fallingFrom, onHeadBone, type CardLayer, type Form, type Patch } from "./build.ts";
import type { CardKind } from "./sheet.ts";

/** Metres hair keeps off the widened skin under it. */
export const GAP = 0.0015;
/** The most hair stands off the scalp under a hat's crown, metres. */
export const PRESSED = 0.001;

/** A curve through (x, y) points, straight between them; flat past the ends. */
function curve(points: readonly (readonly [number, number])[]): (x: number) => number {
  return (x) => {
    if (x <= points[0]![0]) return points[0]![1];
    for (let k = 1; k < points.length; k++) {
      const [x1, y1] = points[k]!, [x0, y0] = points[k - 1]!;
      if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
    return points.at(-1)![1];
  };
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** Round angle in degrees, 0 to 180, either side. */
const side = (phi: number): number => Math.abs((((phi * 180) / Math.PI + 540) % 360) - 180);

/** Where each sex's hair ends round the face, over the ears and at the nape: theta at each |phi|. */
const HAIRLINES: readonly (readonly (readonly [number, number])[])[] = [
  [[0, 46], [24, 45], [38, 50], [50, 58], [60, 64], [70, 70], [77, 80], [80, 97], [86, 97], [89, 82], [93, 77], [110, 77], [118, 92], [130, 114], [150, 125], [180, 130]],
  [[0, 47], [30, 48], [48, 56], [60, 64], [70, 72], [78, 82], [83, 92], [87, 90], [90, 80], [94, 78], [110, 78], [118, 94], [130, 116], [150, 127], [180, 132]],
];
/** Where a hat's brim sits, theta at |phi|: above it, an under-hat form is pressed flat. */
export const BRIM = curve([[0, 60], [60, 66], [90, 80], [130, 92], [180, 98]]);

interface CapSpec {
  /** theta of the hairline at |phi|. */
  hairline: (phi: number) => number;
  /** Metres it stands off the scalp at a direction, and at `v`, 0 at the whorl and 1 at the hairline. Radians. */
  thickness: (theta: number, phi: number, v: number) => number;
  /** The whorl: theta and phi the hair falls from. */
  whorl: readonly [number, number];
}

/** Pressed flat to the skin above the brim, as the style is below it. */
function pressed(head: Head, spec: CapSpec): CapSpec {
  return {
    ...spec,
    thickness: (theta, phi, v) => {
      const t = spec.thickness(theta, phi, v);
      const under = smooth(BRIM(side(phi)) - 2, BRIM(side(phi)) + 6, (theta * 180) / Math.PI);
      // Down onto the skin itself, not the widened surface the hair otherwise keeps off.
      const widened = sample(head.clear, theta, phi) - sample(head.skin, theta, phi);
      return (Math.min(t, PRESSED) - widened) * (1 - under) + t * under;
    },
  };
}

/**
 * The hair over the scalp: u round the whorl (0 behind it), v out from it to the hairline. A column walks a great circle
 * from the whorl until it meets the hairline; past v = 1 it goes on down the skin, for cards' tips.
 */
function cap(head: Head, spec: CapSpec, name = "cap"): Patch {
  const w = direction(deg(spec.whorl[0]), deg(spec.whorl[1]));
  const t1: Vec = [Math.cos(deg(spec.whorl[0])) * Math.sin(deg(spec.whorl[1])), -Math.sin(deg(spec.whorl[0])), Math.cos(deg(spec.whorl[0])) * Math.cos(deg(spec.whorl[1]))];
  const t2: Vec = [Math.cos(deg(spec.whorl[1])), 0, -Math.sin(deg(spec.whorl[1]))];
  const along = (psi: number, s: number, out: Vec): Vec => {
    for (let a = 0; a < 3; a++) out[a] = Math.cos(s) * w[a]! + Math.sin(s) * (Math.cos(psi) * t1[a]! + Math.sin(psi) * t2[a]!);
    return out;
  };
  // How far each column's great circle runs before it meets the hairline, radians, at 720 columns round.
  const ends = new Float64Array(721);
  const d: Vec = [0, 0, 0];
  const past = (psi: number, s: number): number => {
    along(psi, s, d);
    const theta = Math.acos(Math.max(-1, Math.min(1, d[1])));
    return (theta * 180) / Math.PI - spec.hairline(side(Math.atan2(d[0], d[2])));
  };
  for (let k = 0; k <= 720; k++) {
    const psi = (k / 720) * Math.PI * 2;
    let s = 0;
    while (s < Math.PI && past(psi, s) < 0) s += deg(1);
    let lo = Math.max(0, s - deg(1)), hi = s;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (past(psi, mid) < 0) lo = mid;
      else hi = mid;
    }
    ends[k] = hi;
  }
  const endAt = (u: number): number => {
    const f = (((u % 1) + 1) % 1) * 720, k = Math.floor(f);
    return ends[k]! + (ends[Math.min(720, k + 1)]! - ends[k]!) * (f - k);
  };
  const across = 2 * Math.PI * 0.11;
  return {
    name, wrap: true, poles: [true, false], size: [across, 0.2], bend: 0.11, drawn: "core", bones: onHeadBone,
    at(u, v, lift, out) {
      along(u * Math.PI * 2, endAt(u) * v, d);
      const theta = Math.acos(Math.max(-1, Math.min(1, d[1]))), phi = Math.atan2(d[0], d[2]);
      onHead(head, theta, phi, GAP + spec.thickness(theta, phi, Math.min(v, 1)) * (v > 1 ? Math.max(0, 1 - (v - 1) * 8) : 1) + lift, out);
    },
  };
}

/** A curtain hung from the cap round the back, from |phi| `opening` on each side, ending `drop(|phi|)` below the head's joint. */
function curtain(head: Head, from: (phi: number) => number, stand: number, opening: number, drop: (phi: number) => number): Patch {
  const headY = head.rest[B_HEAD * 3 + 1]!;
  const top: Vec = [0, 0, 0];
  const span = 360 - 2 * opening;
  return {
    name: "curtain", wrap: false, poles: [false, false], size: [deg(span) * 0.12, 0.2], bend: 0.12, drawn: "core",
    bones: fallingFrom(B_UPPER_CHEST, headY, headY - 0.16),
    at(u, v, lift, out) {
      const phi = deg(opening + u * span);
      onHead(head, deg(from(side(phi))), phi, GAP + stand, top);
      const out2 = [top[0] - head.centre[0], top[2] - head.centre[2]];
      const l = Math.hypot(out2[0]!, out2[1]!) || 1;
      const fall = top[1] - (headY - drop(side(phi)));
      const y = top[1] - fall * v;
      // Hair hangs a little out from the neck as it falls.
      const flare = 0.12 * (top[1] - y) + lift;
      out[0] = top[0] + (out2[0]! / l) * flare;
      out[1] = y;
      out[2] = top[2] + (out2[1]! / l) * flare;
      keepOut(head, out, GAP + 0.008 + lift);
    },
  };
}

/** A tube along `path` (points, a spline through them), `radius` at each v; it closes to a point at its end. */
function tube(head: Head, name: string, path: readonly Vec[], radius: (v: number) => number, bones: Patch["bones"]): Patch {
  const at = (v: number): Vec => {
    const f = Math.min(path.length - 1.0001, Math.max(0, v) * (path.length - 1)), k = Math.floor(f), t = f - k;
    const p0 = path[Math.max(0, k - 1)]!, p1 = path[k]!, p2 = path[k + 1]!, p3 = path[Math.min(path.length - 1, k + 2)]!;
    return [0, 1, 2].map((a) => 0.5 * (2 * p1[a]! + (-p0[a]! + p2[a]!) * t + (2 * p0[a]! - 5 * p1[a]! + 4 * p2[a]! - p3[a]!) * t * t + (-p0[a]! + 3 * p1[a]! - 3 * p2[a]! + p3[a]!) * t * t * t)) as Vec;
  };
  const length = path.slice(1).reduce((s, p, k) => s + Math.hypot(p[0] - path[k]![0], p[1] - path[k]![1], p[2] - path[k]![2]), 0);
  return {
    name, wrap: true, poles: [false, true], size: [2 * Math.PI * radius(0.2), length], bend: radius(0.2), drawn: "core", bones,
    at(u, v, lift, out) {
      const c = at(v), e = 0.01;
      const ahead = at(Math.min(1, v + e)), behind = at(Math.max(0, v - e));
      let tx = ahead[0] - behind[0], ty = ahead[1] - behind[1], tz = ahead[2] - behind[2];
      const tl = Math.hypot(tx, ty, tz) || 1;
      [tx, ty, tz] = [tx / tl, ty / tl, tz / tl];
      // Across: the head's left, made square to the tube; and the third way.
      let nx = 1 - tx * tx, ny = -tx * ty, nz = -tx * tz;
      const nl = Math.hypot(nx, ny, nz) || 1;
      [nx, ny, nz] = [nx / nl, ny / nl, nz / nl];
      const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
      const a = u * Math.PI * 2, r = (v >= 1 ? 0 : radius(v)) + (v >= 1 ? 0 : lift);
      out[0] = c[0] + r * (Math.cos(a) * nx + Math.sin(a) * bx);
      out[1] = c[1] + r * (Math.cos(a) * ny + Math.sin(a) * by);
      out[2] = c[2] + r * (Math.cos(a) * nz + Math.sin(a) * bz);
    },
  };
}

/** A ball of hair on the cap at `theta`, `phi`, `radius` across, flattened against the head. */
function bun(head: Head, name: string, theta: number, phi: number, radius: number, stand: number): Patch {
  const base = onHead(head, deg(theta), deg(phi), GAP + stand + radius * 0.6);
  const a = direction(deg(theta), deg(phi));
  let n: Vec = [a[1], -a[0], 0];
  if (Math.hypot(...n) < 1e-3) n = [1, 0, 0];
  const nl = Math.hypot(...n);
  n = [n[0] / nl, n[1] / nl, n[2] / nl];
  const b: Vec = [a[1] * n[2] - a[2] * n[1], a[2] * n[0] - a[0] * n[2], a[0] * n[1] - a[1] * n[0]];
  return {
    name, wrap: true, poles: [true, true], size: [2 * Math.PI * radius, Math.PI * radius], bend: radius, drawn: "core", bones: onHeadBone,
    at(u, v, lift, out) {
      const polar = Math.min(1, v) * Math.PI, round = u * Math.PI * 2, r = radius + lift;
      for (let k = 0; k < 3; k++) out[k] = base[k]! + r * (0.85 * Math.cos(polar) * a[k]! + Math.sin(polar) * (Math.cos(round) * n[k]! + Math.sin(round) * b[k]!));
    },
  };
}

/** Cards in up to three layers: each `[kind, lift, from, to, width]`. */
function layers(on: string, list: readonly (readonly [CardKind, number, number, number, number])[], start?: (u: number) => number): CardLayer[] {
  return list.map(([kind, lift, from, to, width], k) => ({ on, kind, lift, from, to, width, stagger: k % 2 === 1, start }));
}

/** Where along the cap the brim is at a column: the v at which an under-hat form's cards may root, or Infinity. */
function brimStart(head: Head, patch: Patch): (u: number) => number {
  const p: Vec = [0, 0, 0];
  return (u) => {
    for (let v = 0; v <= 1.1; v += 0.02) {
      patch.at(u, v, 0, p);
      const [theta, phi] = anglesOf(head.centre, p);
      if ((theta * 180) / Math.PI >= BRIM(side(phi)) + 3) return v;
    }
    // Hair that ends above the brim, as over the ears, has no cards under a hat.
    return Infinity;
  };
}

export interface HairStyleForms {
  worn: Form;
  /** Under a hat or helmet. */
  hat: Form;
}

/** A cap style's worn and under-hat forms, with the cards each `[kind, lift, from, to, width]`. */
function capStyle(head: Head, spec: CapSpec, cards: readonly (readonly [CardKind, number, number, number, number])[]): HairStyleForms {
  const worn = cap(head, spec);
  const flat = cap(head, pressed(head, spec));
  return {
    worn: { patches: [worn], cards: layers("cap", cards) },
    hat: { patches: [flat], cards: layers("cap", cards.slice(0, 1), brimStart(head, flat)) },
  };
}

const MM = 0.001;

/** Every hair style but none, by its id in shared/anim/look.ts, made on `head`. */
export function hairStyles(head: Head): Record<string, HairStyleForms> {
  const sex = head.sex;
  const hairline = curve(HAIRLINES[sex]!);
  const headY = head.rest[B_HEAD * 3 + 1]!;
  const theta = (t: number): number => (t * 180) / Math.PI;
  /** 1 on top of the head, falling to 0 down the sides. */
  const topness = (t: number): number => 1 - smooth(48, 74, theta(t));
  const taper = (v: number, from: number, least: number): number => least + (1 - least) * (1 - smooth(from, 1, v));
  const out: Record<string, HairStyleForms> = {};

  // A buzz cut lies on the skin itself, not the widened surface: it is the default look, held to the hit head.
  const onSkin = (t: number, p: number): number => sample(head.clear, t, p) - sample(head.skin, t, p);
  out.buzzed = capStyle(head, { hairline, whorl: [26, 180], thickness: (t, p, v) => 3 * MM * taper(v, 0.9, 0.35) - onSkin(t, p) }, [["stubble", 1.2 * MM, 0.04, 1.03, 0.025]]);

  out.parted = capStyle(head, {
    hairline, whorl: [30, 40],
    thickness: (t, p, v) => {
      // The parting runs back from the forehead on the head's left, where the hair lies thin.
      const parting = Math.exp(-(((((p * 180) / Math.PI) - 38) / 9) ** 2)) * (1 - smooth(55, 70, theta(t)));
      return (sex === 0 ? 13 : 15) * MM * (1 - 0.65 * parting) * taper(v, 0.82, 0.25);
    },
  }, [["fine", 2.5 * MM, 0.04, 1.06, 0.022], ["fine", 6 * MM, 0.08, 1.04, 0.03], ["clumps", 10 * MM, 0.1, 0.7, 0.035]]);

  // Fade: length on top only; the sides and back are stubble that shows the skin through, the core's edge high above them.
  const fadeLine = curve([[0, hairline(0)], [30, hairline(30)], [55, 66], [90, 70], [140, 96], [180, 106]]);
  const fadeTop: CapSpec = { hairline: (p) => Math.min(hairline(p), fadeLine(p)), whorl: [24, 180], thickness: (t, p, v) => (sex === 0 ? 20 : 18) * MM * taper(v, side(p) < 40 ? 0.8 : 0.4, 0.08) };
  // Stubble lies on the skin itself, not on the widened surface.
  const fadeSides: CapSpec = { hairline, whorl: [24, 180], thickness: (t, p) => 0.5 * MM - (sample(head.clear, t, p) - sample(head.skin, t, p)) };
  const sides = (spec: CapSpec): Patch => ({ ...cap(head, spec, "sides"), drawn: "stubble" });
  const fadeCards = layers("cap", [["fine", 4 * MM, 0.04, 1.08, 0.026], ["clumps", 9 * MM, 0.06, 0.85, 0.034]]);
  out.fade = {
    worn: { patches: [cap(head, fadeTop), sides(fadeSides)], cards: fadeCards },
    hat: { patches: [cap(head, pressed(head, fadeTop)), sides(fadeSides)], cards: [] },
  };

  // Coils stand off the head in lumps a few centimetres across.
  const lumps = [[0.3, 0.8, 0.5, 21, 0.4], [-0.7, 0.2, 0.6, 24, 1.9], [0.5, -0.4, 0.75, 19, 3.1], [-0.2, 0.6, -0.8, 26, 4.4], [0.9, 0.1, -0.4, 23, 5.2]] as const;
  const lumpy = (t: number, p: number): number => {
    const d = direction(t, p);
    return lumps.reduce((sum, [x, y, z, f, phase]) => sum + Math.sin(f * (d[0] * x + d[1] * y + d[2] * z) + phase), 0) / lumps.length;
  };
  out.coils = capStyle(head, {
    hairline, whorl: [20, 180],
    thickness: (t, p, v) => {
      const back = smooth(100, 170, side(p));
      return (24 + 9 * topness(t) - 8 * back * (1 - topness(t)) + 9 * lumpy(t, p)) * MM * taper(v, 0.72, 0.3);
    },
  }, [["coils", 3 * MM, 0.03, 1.05, 0.024], ["coils", 8 * MM, 0.04, 1.02, 0.028], ["coils", 13 * MM, 0.06, 0.95, 0.032]]);

  // Long: a cap that reaches over the ears, and a curtain from it round the back.
  const opening = sex === 0 ? 56 : 54;
  const turn = curve([[0, hairline(0)], [36, hairline(36)], [opening - 4, 92], [90, 94], [180, 104]]);
  const longCap: CapSpec = { hairline: turn, whorl: [28, 25], thickness: (t, p, v) => (sex === 0 ? 11 : 12) * MM * taper(v, 0.85, side(p) > opening ? 0.7 : 0.3) };
  const stand = 0.6 * (sex === 0 ? 11 : 12) * MM;
  const drop = sex === 0 ? curve([[60, 0.03], [120, 0.05], [180, 0.07]]) : curve([[60, 0.12], [120, 0.17], [180, 0.21]]);
  const hang = (spec: CapSpec): Form => {
    const c = cap(head, spec);
    const hung = curtain(head, (p) => turn(p) - 6, stand, opening, drop);
    return { patches: [c, hung], cards: [] };
  };
  out.long = {
    worn: { ...hang(longCap), cards: [...layers("cap", [["fine", 2.5 * MM, 0.04, 1.02, 0.024], ["fine", 7 * MM, 0.1, 0.75, 0.032]]), ...layers("curtain", [["fine", 3 * MM, 0.0, 1.05, 0.026], ["clumps", 7 * MM, 0.05, 1.07, 0.032]])] },
    hat: { ...hang(pressed(head, longCap)), cards: layers("curtain", [["fine", 3 * MM, 0.15, 1.05, 0.026]]) },
  };

  // Buns: a smooth cap, and a ball each side of the crown.
  const bunCap: CapSpec = { hairline, whorl: [10, 180], thickness: (_, __, v) => 8 * MM * taper(v, 0.85, 0.3) };
  const bunSize = sex === 0 ? 0.038 : 0.043;
  out.buns = {
    worn: {
      patches: [cap(head, bunCap), bun(head, "bun-l", 36, 62, bunSize, 8 * MM), bun(head, "bun-r", 36, -62, bunSize, 8 * MM)],
      cards: [...layers("cap", [["fine", 2.5 * MM, 0.04, 1.04, 0.024]]), ...layers("bun-l", [["clumps", 3 * MM, 0.02, 0.9, 0.03]]), ...layers("bun-r", [["clumps", 3 * MM, 0.02, 0.9, 0.03]])],
    },
    hat: capStyle(head, bunCap, [["fine", 2.5 * MM, 0.04, 1.04, 0.024]]).hat,
  };

  // Tied: a slicked cap, and a ponytail from the back of the head down the back.
  const tiedCap: CapSpec = { hairline, whorl: [70, 180], thickness: (_, __, v) => 7 * MM * taper(v, 0.88, 0.35) };
  const tailFrom = (theta: number): Patch => {
    const root = onHead(head, deg(theta), Math.PI, GAP + 7 * MM - 0.012);
    const rootOut = onHead(head, deg(theta), Math.PI, GAP + 7 * MM + 0.01);
    const length = sex === 0 ? 0.2 : 0.27;
    const path: Vec[] = [root, rootOut, [0, rootOut[1] - 0.035, rootOut[2] - 0.03], [0, rootOut[1] - 0.1, rootOut[2] - 0.045], [0, rootOut[1] - length * 0.7, rootOut[2] - 0.04], [0, rootOut[1] - length, rootOut[2] - 0.035]];
    for (const p of path.slice(2)) keepOut(head, p, 0.03);
    const radius = (v: number): number => (v < 0.15 ? 0.017 + 0.009 * smooth(0, 0.15, v) : 0.026 - 0.016 * smooth(0.15, 1, v)) * (sex === 0 ? 0.75 : 1);
    return tube(head, "tail", path, radius, fallingFrom(B_UPPER_CHEST, headY, headY - 0.2));
  };
  out.tied = {
    worn: { patches: [cap(head, tiedCap), tailFrom(98)], cards: [...layers("cap", [["fine", 2 * MM, 0.04, 1.03, 0.024]]), ...layers("tail", [["clumps", 3 * MM, 0.16, 1, 0.022], ["fine", 7 * MM, 0.2, 1, 0.026]])] },
    // Under a hat the tail comes out below the brim.
    hat: { patches: [cap(head, pressed(head, tiedCap)), tailFrom(BRIM(180) + 16)], cards: layers("tail", [["clumps", 3 * MM, 0.16, 1, 0.022]]) },
  };
  return out;
}

/** Where a beard reaches: (phi, theta) at each angle round the mouth, from -90 under it to 90 over it, on the head's left. */
const BEARD_REACH: Readonly<Record<"full" | "short", readonly (readonly [number, number, number])[]>> = {
  full: [[-90, 0, 28], [-70, 25, 27], [-45, 55, 22], [-20, 76, 8], [5, 80, -12], [20, 70, -26], [35, 50, -18], [60, 24, -14], [90, 0, -13]],
  short: [[-90, 0, 24], [-70, 22, 23], [-45, 50, 19], [-20, 72, 6], [5, 77, -10], [20, 66, -22], [35, 46, -16], [60, 24, -13], [90, 0, -12]],
};

/** A ring about the mouth: u round it from under the chin, v out from the lips to the beard's edge. */
function ring(head: Head, mouth: number, reach: readonly (readonly [number, number, number])[], thickness: (alpha: number, v: number) => number, drawn: Patch["drawn"]): Patch {
  const phiAt = curve(reach.map(([a, p]) => [a, p] as const)), thetaAt = curve(reach.map(([a, , t]) => [a, t] as const));
  // Around the lips: as wide as the mouth's corners and a little past each lip.
  const lips = (alpha: number): [number, number] => [24 * Math.cos(deg(alpha)), (alpha > 0 ? -9 : -8.5) * Math.sin(deg(alpha))];
  return {
    name: "beard", wrap: true, poles: [false, false], size: [0.4, 0.06], bend: 0.1, drawn, bones: onHeadBone,
    at(u, v, lift, out) {
      let alpha = -90 + u * 360;
      if (alpha > 180) alpha -= 360;
      // The head's right mirrors its left.
      const right = alpha > 90 || alpha < -90;
      const a = !right ? alpha : alpha > 0 ? 180 - alpha : -180 - alpha;
      const [ip, it] = lips(a);
      const op = phiAt(a), ot = thetaAt(a);
      const phi = (ip + (op - ip) * v) * (right ? -1 : 1), theta = mouth + it + (ot - it) * v;
      onHead(head, deg(theta), deg(phi), GAP + thickness(a, Math.min(1, v)) + lift, out, head.skin);
    },
  };
}

/** Every beard but none, by its id in shared/anim/look.ts, made on `head` with its mouth at polar angle `mouth`. */
export function beardStyles(head: Head, mouth: number): Record<string, Form> {
  const profile = (v: number): number => 0.3 + 0.7 * smooth(0, 0.25, v) - 0.6 * smooth(0.6, 1, v);
  const full = ring(head, mouth, BEARD_REACH.full, (a, v) => (a < -30 ? 12 : a < 15 ? 9 : a < 45 ? 6 : 5) * MM * profile(v), "core");
  const short = ring(head, mouth, BEARD_REACH.short, (a, v) => (a > 45 ? 4 : 5) * MM * profile(v), "core");
  const stubble = ring(head, mouth, BEARD_REACH.short, () => 0.6 * MM, "stubble");
  return {
    full: { patches: [full], cards: layers("beard", [["clumps", 2 * MM, 0, 1.04, 0.02], ["fine", 5 * MM, 0.1, 0.95, 0.025]]) },
    stubble: { patches: [stubble], cards: [], most: [480, 200] },
    short: { patches: [short], cards: layers("beard", [["stubble", 1.5 * MM, 0, 1.03, 0.02]]) },
  };
}
