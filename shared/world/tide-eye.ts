// The authored Tide Eye uses metres relative to the centre of its transfer deck. The map head places its visual
// once, independently of which chunks a client holds; its stationary collision pieces travel as ordinary statics.
import { detCos, detSin } from "../math/scalar.ts";
import type { MapStatic } from "./mapfile.ts";
import profile from "./tide-eye-profile.json" with { type: "json" };
import sextant from "./sextant-profile.json" with { type: "json" };

export const EYE_COLORS = ["blue", "red", "green"] as const;
export type EyeColor = typeof EYE_COLORS[number];
export interface TideEyeSite {
  readonly name: string;
  readonly form?: "sextant";
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
export const HULLS = { spar: [7, 12, 9], tip: [2.5, 8, 3], bearing: [4.2, 4.2, 4.4] } as const;

export const EYE_COLLIDERS = new Set(Object.keys(HULLS).map(name => "core:zztide_eye_" + name));

export function eyeCollision(site: TideEyeSite): MapStatic[] {
  const a = site.yaw * Math.PI / 32768, c = detCos(a), s = detSin(a);
  const pieces: MapStatic[] = [];
  const put = (kind: keyof typeof HULLS, x: number, h: number) => {
    pieces.push({ kind: "core:zztide_eye_" + kind, x: site.x + x * c, y: site.y + KEEL + h, z: site.z - x * s, yaw: site.yaw });
  };
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
