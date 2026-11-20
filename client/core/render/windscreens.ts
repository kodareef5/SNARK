// Camera-relative glass in the clear openings of the live road fleet. The body mesh supplies the
// cowl, seals, wipers and pillars. A single two-sided sheet transmits the cabin already drawn.
import { BONE_FLOATS, DETAIL, DETAIL_FLOATS, DETAIL_GLASS, type FramePacket } from "./packet.ts";
import { finishSeed } from "./street-finish.ts";
import { VehicleCards } from "./vehicle-cards.ts";

import { FRONT } from "../../../content/vehicles/windscreens.ts";

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
