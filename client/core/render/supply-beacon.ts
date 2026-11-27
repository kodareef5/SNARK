// Both capsule models emit the same light at touchdown.
import { SHAFT_HEIGHT } from "../../../shared/sim/supply.ts";
import type { Frame } from "./pass.ts";
import { DETAIL, DETAIL_BEACON, DETAIL_GLOW, GLOW_STEPS } from "./packet.ts";
import { SHAFTS_MOST, shaftKeeps, shaftRadius } from "./supply.ts";
import { VehicleCards } from "./vehicle-cards.ts";

export class SupplyBeacons extends VehicleCards {
  constructor() { super(2 * SHAFTS_MOST); }

  add(f: Pick<Frame, "cam" | "packet" | "viewHeight">, x: number, y: number, z: number, fraction: number, power: number, rgb: number, ringed: boolean): boolean {
    const cam = f.cam, p = f.packet;
    const reach = Math.hypot(x, z);
    const fog = Math.max(0, Math.min(1, (reach - p.fogStart) / Math.max(1, p.fogEnd - p.fogStart)));
    const shows = Math.round(255 * power * shaftKeeps(reach, fog));
    if (shows < 1 || this.count + 2 > 2 * SHAFTS_MOST) return false;
    const scale = reach > 0.9 * cam.far ? 0.9 * cam.far / reach : 1;
    const tall = SHAFT_HEIGHT * fraction * scale;
    const radius = shaftRadius(reach, cam.fovY, f.viewHeight) * scale;
    const spread = ringed ? 5 : 3;
    const wide = radius * spread;
    const glow = 1.25 * scale;
    x *= scale;
    y *= scale;
    z *= scale;
    const bounds = Math.max(wide, glow);
    if (!cam.boxVisible(x - bounds, y - glow, z - bounds, x + bounds, y + Math.max(tall, glow), z + bounds)) return false;
    const tint = (rgb >> 16) | (rgb & 0xff00) | ((rgb & 255) << 16) | 0xff000000;
    const rx = reach ? -z / (reach * scale) : -Math.cos(cam.yaw);
    const rz = reach ? x / (reach * scale) : Math.sin(cam.yaw);
    if (reach < 400) {
      const i = this.next(), card = this.cards;
      const distance = Math.hypot(x, y, z) || 1;
      card[i] = x; card[i + 1] = y; card[i + 2] = z;
      card[i + DETAIL.across] = rx * glow; card[i + DETAIL.across + 1] = 0; card[i + DETAIL.across + 2] = rz * glow;
      card[i + DETAIL.along] = -rz * y / distance * glow;
      card[i + DETAIL.along + 1] = reach * scale / distance * glow;
      card[i + DETAIL.along + 2] = rx * y / distance * glow;
      this.words[i + DETAIL.colourA] = tint;
      this.words[i + DETAIL.misc] = (3 * GLOW_STEPS << 24) | (shows << 16) | (DETAIL_GLOW << 8);
    }
    if (tall <= 0) return false;
    const i = this.next(), card = this.cards;
    card[i] = x; card[i + 1] = y + tall / 2; card[i + 2] = z;
    card[i + DETAIL.across] = rx * wide; card[i + DETAIL.across + 1] = 0; card[i + DETAIL.across + 2] = rz * wide;
    card[i + DETAIL.along] = 0; card[i + DETAIL.along + 1] = tall / 2; card[i + DETAIL.along + 2] = 0;
    this.words[i + DETAIL.colourA] = tint;
    this.words[i + DETAIL.misc] = (Math.round(255 * 3 / spread) << 24) | (shows << 16) | (DETAIL_BEACON << 8);
    return true;
  }
}
