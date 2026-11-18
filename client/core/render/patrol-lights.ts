// The authored lenses stay on the mesh. Each illuminated lens gains one depth-tested card with a bright strip and a soft halo.
import type { EmergencyLamp } from "../../../shared/sim/vehicle.ts";
import { TICK_DT } from "../../../shared/coords.ts";
import { BONE_FLOATS, DETAIL, DETAIL_LAMP, type FramePacket } from "./packet.ts";
import { VehicleCards } from "./vehicle-cards.ts";

export const MAX_PATROL_CARDS = 256;
// RGBA bytes in a packet word, least significant first.
const RED = 0xff1915ff, RED_CORE = 0xff979cff;
const BLUE = 0xffff5116, BLUE_CORE = 0xffffd27c;

/** Seconds on the interpolated simulation clock. Each bank has a dark interval between beats. */
export function patrolLampStrength(mode: number, color: EmergencyLamp["color"], seconds: number): number {
  const half = mode === 1 ? 1.3 : mode === 2 ? .49 : .46;
  const period = 2 * half;
  let t = (seconds + (color === "blue" ? half : 0)) % period;
  if (t < 0) t += period;
  if (mode === 1 && t < .98) return .50 * Math.sin(Math.PI * t / .98) ** 2;
  if (mode === 2 && t < .32) return .79;
  if (mode === 3 && (t < .10 || (t >= .19 && t < .31))) return 1;
  return 0;
}

export class PatrolLights extends VehicleCards {
  constructor() { super(MAX_PATROL_CARDS); }

  /** Bone zero of either the full pose or its rigid stand-in carries the chassis rotation, scale and camera-relative position. */
  add(p: FramePacket, first: number, lamps: readonly EmergencyLamp[], mode: number, tick: number, id: number, size: number): void {
    if (!mode || size <= 0 || this.count >= MAX_PATROL_CARDS) return;
    const b = p.bones, o = first * BONE_FLOATS;
    // Offset each vehicle's oscillator by a fixed amount, including after it leaves and re-enters view.
    const seconds = tick * TICK_DT + id * .173;
    const red = patrolLampStrength(mode, "red", seconds), blue = patrolLampStrength(mode, "blue", seconds);
    if (red + blue < 1 / 255) return;
    const xx = b[o]! / size, xy = b[o + 4]! / size, xz = b[o + 8]! / size;
    const zx = b[o + 2]! / size, zy = b[o + 6]! / size, zz = b[o + 10]! / size;
    for (const lamp of lamps) {
      const power = lamp.color === "red" ? red : blue;
      if (power < 1 / 255) continue;
      if (this.count >= MAX_PATROL_CARDS) break;
      const [lx, ly, lz] = lamp.at;
      const x = b[o]! * lx + b[o + 1]! * ly + b[o + 2]! * lz + b[o + 3]!;
      const y = b[o + 4]! * lx + b[o + 5]! * ly + b[o + 6]! * lz + b[o + 7]!;
      const z = b[o + 8]! * lx + b[o + 9]! * ly + b[o + 10]! * lz + b[o + 11]!;
      const distance = Math.hypot(x, y, z);
      if (distance < .12) continue;
      const nx = -x / distance, ny = -y / distance, nz = -z / distance;
      const front = nx * zx + ny * zy + nz * zz;
      const facing = lamp.facing ? Math.min(1, Math.max(0, (lamp.facing === "front" ? front : -front) * 3)) : 1;
      const shows = Math.round(255 * power * facing);
      if (shows === 0) continue;

      // The long axis is the apparent width of the actual lens. Seen end-on it contracts to a small spot.
      const sideways = nx * xx + ny * xy + nz * xz;
      let ax = xx - nx * sideways, ay = xy - ny * sideways, az = xz - nz * sideways;
      const projected = Math.hypot(ax, ay, az);
      if (projected < .001) { ax = zx - nx * front; ay = zy - ny * front; az = zz - nz * front; }
      const length = projected < .001 ? Math.hypot(ax, ay, az) : projected;
      ax /= length; ay /= length; az /= length;

      const width = (lamp.width ?? .36) * size;
      const halo = width * (.22 + .60 * power) + Math.min(width * .45, distance * .00085);
      const across = .5 * width * projected + halo, along = .10 * width + halo;
      // Stand the strip just proud of the lens and its moulded ribs. Depth still hides it behind bodywork.
      const faceBias = lamp.facing === "front" ? .012 * size : lamp.facing === "rear" ? -.012 * size : 0;
      const bias = .012 * size;
      const i = this.next(), card = this.cards;
      card[i] = x + nx * bias + zx * faceBias;
      card[i + 1] = y + ny * bias + zy * faceBias;
      card[i + 2] = z + nz * bias + zz * faceBias;
      card[i + DETAIL.across] = ax * across; card[i + DETAIL.across + 1] = ay * across; card[i + DETAIL.across + 2] = az * across;
      card[i + DETAIL.along] = (ny * az - nz * ay) * along;
      card[i + DETAIL.along + 1] = (nz * ax - nx * az) * along;
      card[i + DETAIL.along + 2] = (nx * ay - ny * ax) * along;
      this.words[i + DETAIL.colourA] = lamp.color === "red" ? RED : BLUE;
      this.words[i + DETAIL.colourB] = lamp.color === "red" ? RED_CORE : BLUE_CORE;
      const grey = Math.round(255 - power * 64);
      this.words[i + DETAIL.misc] = ((grey << 24) | (shows << 16) | (DETAIL_LAMP << 8)) >>> 0;
    }
  }
}
