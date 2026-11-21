// The authored Tide Eye uses metres relative to the centre of its transfer deck. The map head places its visual
// once, independently of which chunks a client holds; its stationary collision pieces travel as ordinary statics.
import { detCos, detSin } from "../math/scalar.ts";
import type { MapStatic } from "./mapfile.ts";
import profile from "./tide-eye-profile.json" with { type: "json" };
import sextant from "./sextant-profile.json" with { type: "json" };
import lantern from "./lantern-profile.json" with { type: "json" };

// These indices are stored in the optional map-header form column. Zero is the original Tide Eye.
export const EYE_FORMS = [undefined, "sextant", "lantern"] as const;
export const EYE_COLORS = ["blue", "red", "green"] as const;
export type EyeColor = typeof EYE_COLORS[number];
export interface TideEyeSite {
  readonly name: string;
  readonly form?: typeof EYE_FORMS[number];
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly color: EyeColor;
  readonly radius: number;
}
export const EYE_DYE = { blue: 65, red: 46, green: 50 } as const;
export const DECK_RADIUS = 70;
export const KEEL = 270;
export const CROWN_ORIGIN = KEEL + 190;
export const LENS_HEIGHT = KEEL + 269;
export const SEXTANT_PIVOT = KEEL + sextant.pivot;
// Slats pivot around their upper axles. The same three uprights locate the axles in Blender and on the server.
export const LANTERN_BANKS = lantern.banks.map(({ first, pitch, count }) => {
  const lower = first - 8, upper = first + (count - 1) * pitch + 6;
  const middle = (lower + upper) / 2;
  return {
    well: KEEL + middle + 2, radius: middle * 0.127,
    slats: Array.from({ length: count }, (_, i) => {
      const h = first + i * pitch;
      return { h: KEEL + h, depth: lantern.corners[0]![1]! * h, width: lantern.corners[1]![0]! * h / 50 };
    }),
  };
});
export const HULLS = { spar: [7, 12, 9], tip: [2.5, 8, 3], bearing: [4.2, 4.2, 4.4] } as const;
/**
 * Where each form's beam leaves it, by the form's place in EYE_FORMS: metres across from the deck's axis and over the
 * keel tip, the top of the finial its model has there (the profiles' `emitter`). The Lantern's three beams leave its
 * masts, each this far across and deep from the axis.
 */
export const EMITTERS = [
  { x: profile.emitter[0]!, h: profile.emitter[1]! },
  { x: sextant.emitter[0]!, h: sextant.emitter[1]! },
  { x: 0, h: lantern.emitter },
] as const;
export const LANTERN_MASTS = lantern.corners.map(([x, z]) => [x! * 380, z! * 380] as const);

export const EYE_COLLIDERS = new Set(Object.keys(HULLS).map(name => "core:zztide_eye_" + name));

export function eyeCollision(site: TideEyeSite): MapStatic[] {
  const a = site.yaw * Math.PI / 32768, c = detCos(a), s = detSin(a);
  const pieces: MapStatic[] = [];
  const put = (kind: keyof typeof HULLS, x: number, h: number, z = 0) => {
    pieces.push({ kind: "core:zztide_eye_" + kind, x: site.x + x * c + z * s, y: site.y + KEEL + h, z: site.z - x * s + z * c, yaw: site.yaw });
  };
  if (site.form === "lantern") {
    for (const [x, z] of lantern.corners) {
      for (let h = 8; h <= 376; h += 16) put(h < 70 || h > 356 ? "tip" : "spar", x! * h, h, z! * h);
    }
    // Solid lamp housings sit behind the moving blades. Keep the windows between banks open to riders.
    for (const { first, pitch, count } of lantern.banks) {
      const top = first + (count - 1) * pitch;
      for (let h = first; h <= top; h += 13) {
        const radius = h * 0.112;
        put("spar", 0, h);
        for (let i = 0; i < 8; i++) {
          const a = i * Math.PI / 4;
          put("spar", (radius - 4) * detCos(a), h, (radius - 4) * detSin(a));
        }
      }
    }
    return pieces;
  }
  if (site.form === "sextant") {
    // These fixed steel and stone members are solid. The slender animated index moves across the open dial.
    for (let h = 8; h < 380; h += 16) {
      const hi = sextant.keel.findIndex(row => row[0]! >= h);
      const a = sextant.keel[hi - 1]!, b = sextant.keel[hi]!;
      const f = (h - a[0]!) / (b[0]! - a[0]!);
      const x = a[1]! + f * (b[1]! - a[1]!);
      const w = a[2]! + f * (b[2]! - a[2]!);
      if (w < 5) put("tip", x, h);
      else {
        put("spar", x - Math.max(0, w - 7) * 0.76, h);
        if (w > 9) put("spar", x + (w - 7) * 0.76, h);
      }
    }
    for (let degree = sextant.start; degree <= sextant.end; degree += 4) {
      const t = degree * Math.PI / 180;
      put(degree < sextant.start + 14 ? "bearing" : "spar", sextant.bowX * detCos(t), sextant.pivot + sextant.bowY * detSin(t));
    }
    for (let i = 0; i < 16; i++) {
      const t = i * Math.PI / 8;
      put("bearing", 25 * detCos(t), sextant.pivot + 25 * detSin(t));
    }
    return pieces;
  }
  for (const [side, stations] of [[-1, profile.left], [1, profile.right]] as const) {
    const end = stations.at(-1)![0]!;
    for (let bottom = 0; bottom < end - 8;) {
      const tip = bottom < 44 || bottom > end - 28;
      const half = tip ? HULLS.tip[1] : HULLS.spar[1];
      const h = Math.min(end - half, bottom + half);
      const hi = stations.findIndex(p => p[0]! >= h);
      const lo = stations[hi - 1]!, next = stations[hi]!;
      const x = lo[1]! + (next[1]! - lo[1]!) * (h - lo[0]!) / (next[0]! - lo[0]!);
      if (side < 0 || x >= 3) put(tip ? "tip" : "spar", side * x, h);
      bottom += half * 2;
    }
  }
  for (let i = 0; i < 32; i++) {
    const t = i * Math.PI / 16;
    put("bearing", 39.5 * detCos(t), 269 + 39.5 * detSin(t));
  }
  return pieces;
}
