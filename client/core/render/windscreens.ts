// Camera-relative glass in the clear openings of the live road fleet. The body mesh supplies the
// cowl, seals, wipers and pillars. A single two-sided sheet transmits the cabin already drawn.
import { BONE_FLOATS, DETAIL, DETAIL_FLOATS, DETAIL_GLASS, type FramePacket } from "./packet.ts";
import { finishSeed } from "./street-finish.ts";
import { VehicleCards } from "./vehicle-cards.ts";

type Edge = readonly [y: number, z: number, halfWidth: number];
type Pane = readonly [sill: Edge, header: Edge];
const FRONT: Readonly<Record<string, Pane>> = {
  "core:compact": [
    [0.95, 0.72, 0.72],
    [1.445, 0.25, 0.67],
  ],
  "core:fastback": [
    [0.9, 0.765, 0.69],
    [1.449, 0.186, 0.6],
  ],
  "core:patrol_sedan": [
    [1.007, 1.069, 0.85],
    [1.447, 0.425, 0.69],
  ],
  "core:patrol_jeep": [
    [1.32, 0.95, 0.84],
    [1.866, 0.578, 0.774],
  ],
  "core:veloce": [
    [0.775, 1.025, 0.795],
    [1.27, 0.085, 0.605],
  ],
  "core:berlinetta": [
    [0.775, 0.892, 0.8],
    [1.27, 0.114, 0.608],
  ],
  "core:panel_van": [
    [1.34, 1.78, 0.93],
    [2.15, 0.83, 0.84],
  ],
  "core:caravan": [
    [1.04, 1.7, 0.83],
    [1.74, 0.58, 0.76],
  ],
  "core:taxi": [
    [0.95, 0.89, 0.73],
    [1.39, 0.26, 0.64],
  ],
  "core:muscle_car": [
    [0.9, 0.5, 0.76],
    [1.35, -0.02, 0.61],
  ],
  "core:monster_truck": [
    [1.88, 0.23, 0.73],
    [2.4, -0.03, 0.69],
  ],
  "core:bus": [
    [1.775, 3.61, 1.16],
    [2.646, 3.61, 1.16],
  ],
  "core:semi": [
    [1.995, 2.04, 1.02],
    [2.906, 2.04, 1.02],
  ],
  "core:tanker": [
    [2.21, 3.15, 1.02],
    [2.95, 3.055, 1.02],
  ],
};

export class Windscreens extends VehicleCards {
  constructor() {
    super(24);
  }

  add(p: FramePacket, first: number, model: string, id: number, damage: number): void {
    const pane = FRONT[model],
      hz = p.tier.reflectionHz;
    if (!pane || !p.lit || damage >= 3) return;
    const [bottom, top] = pane,
      b = first * BONE_FLOATS,
      m = p.bones;
    const y = (bottom[0] + top[0]) * 0.5,
      z = (bottom[1] + top[1]) * 0.5;
    const x0 = m[b + 1]! * y + m[b + 2]! * z + m[b + 3]!,
      y0 = m[b + 5]! * y + m[b + 6]! * z + m[b + 7]!,
      z0 = m[b + 9]! * y + m[b + 10]! * z + m[b + 11]!;
    const d2 = x0 * x0 + y0 * y0 + z0 * z0,
      reach = hz >= 2 ? 32 : hz ? 18 : 12,
      cap = hz >= 2 ? 24 : hz ? 8 : 4;
    if (d2 >= reach * reach) return;
    let o;
    const out = this.cards;
    if (this.count < cap) o = this.next();
    else {
      let far = d2;
      for (let n = 0; n < this.count; n++) {
        const at = n * DETAIL_FLOATS,
          other = out[at]! ** 2 + out[at + 1]! ** 2 + out[at + 2]! ** 2;
        if (other > far) {
          far = other;
          o = at;
        }
      }
      if (o === undefined) return;
    }
    out[o] = x0;
    out[o + 1] = y0;
    out[o + 2] = z0;
    const dy = (top[0] - bottom[0]) * 0.5,
      dz = (top[1] - bottom[1]) * 0.5;
    for (let k = 0; k < 3; k++) {
      const row = b + 4 * k;
      out[o + DETAIL.along + k] = m[row + 1]! * dy + m[row + 2]! * dz;
      out[o + DETAIL.across + k] = m[row]! * bottom[2];
    }
    out[o + DETAIL.floor] = top[2] / bottom[2];
    const fade = Math.min(1, (reach - Math.sqrt(d2)) / 6) * (1 - 0.22 * damage);
    this.words[o + DETAIL.misc] = (Math.round(255 * finishSeed(id)) << 24) | (Math.round(255 * fade) << 16) | (DETAIL_GLASS << 8);
  }
}

/** Straight alpha for one thin sheet. Its reflected fraction plus absorbed tint is the covered share. */
export function paneOptics(cosine: number, height: number, seed: number, gloss: number, out: Float64Array): void {
  const inside = cosine < 0,
    grazing = (1 - Math.min(1, Math.abs(cosine))) ** 3;
  const reflected = Math.min(0.86, (inside ? 0.014 + 0.09 * grazing : 0.07 + 0.74 * grazing) * (1 + gloss * 0.45));
  const band = Math.max(0, Math.min(1, (height - 0.55) / 0.4));
  const tint = (inside ? 0.035 : 0.095) + 0.026 * seed + 0.085 * band * band;
  out[0] = reflected + (1 - reflected) * tint;
  out[1] = reflected / out[0]!;
}
