// A thruster car's cold gas (shared/sim/vehicle-thrusters.ts): each nozzle that fired on the car's last tick blows a short
// cone of soft white puffs from its socket along its jet, cards that face the camera, as the clouds' puffs are drawn.
import type { PackDetails } from "../../../shared/pack/details.ts";
import { nozzleStrength, type ThrusterNozzle } from "../../../shared/sim/vehicle-thrusters.ts";
import { BONE_FLOATS, DETAIL, DETAIL_LIT, DETAIL_PUFF, type FramePacket } from "./packet.ts";
import { VehicleCards } from "./vehicle-cards.ts";

export const MAX_PLUME_CARDS = 384;
/** Puffs along one jet, and its length and width at the far end, metres, at full strength. */
const PUFFS = 5;
const LENGTH = 1.9, BOOST_LENGTH = 2.8, WIDTH = .55;
// RGBA bytes in a packet word, least significant first: a cool white, and a little greyer in its shade.
const GAS = 0xfff6f2ee, GAS_SHADE = 0xffe2dcd6;

export class ThrusterPlumes extends VehicleCards {
  private cell = 0;
  private flat = 1;
  private grey = 255;

  constructor() { super(MAX_PLUME_CARDS); }

  /** The details' first dust picture, as the clouds take theirs (clouds.ts); the plain puff where the pack has none. */
  pictures(details: PackDetails | undefined): void {
    const p = details?.pictures.find((q) => /\/dust_\d+$/.test(q.id));
    if (p) { this.cell = p.cell; this.flat = p.flat; this.grey = Math.max(1, Math.min(255, Math.round(p.grey * 255))); }
  }

  /** Bone zero of the drawn car carries its rotation, scale and camera-relative place. `tick` turns each puff a little. */
  add(p: FramePacket, first: number, nozzles: readonly ThrusterNozzle[], thrust: number, tick: number, id: number, size: number): void {
    if (thrust === 0 || size <= 0) return;
    const b = p.bones, o = first * BONE_FLOATS;
    const misc = this.cell | ((this.flat | DETAIL_LIT | DETAIL_PUFF) << 8) | (this.grey << 24);
    for (let n = 0; n < nozzles.length; n++) {
      const nozzle = nozzles[n]!, power = nozzleStrength(thrust, nozzle.name);
      if (power <= 0) continue;
      const [lx, ly, lz] = nozzle.at, [dx0, dy0, dz0] = nozzle.dir;
      const x0 = b[o]! * lx + b[o + 1]! * ly + b[o + 2]! * lz + b[o + 3]!;
      const y0 = b[o + 4]! * lx + b[o + 5]! * ly + b[o + 6]! * lz + b[o + 7]!;
      const z0 = b[o + 8]! * lx + b[o + 9]! * ly + b[o + 10]! * lz + b[o + 11]!;
      // The bone's matrix carries the drawn size: the jet's way is turned and normalised apart from it.
      let jx = b[o]! * dx0 + b[o + 1]! * dy0 + b[o + 2]! * dz0, jy = b[o + 4]! * dx0 + b[o + 5]! * dy0 + b[o + 6]! * dz0, jz = b[o + 8]! * dx0 + b[o + 9]! * dy0 + b[o + 10]! * dz0;
      const jl = Math.hypot(jx, jy, jz); if (jl < 1e-6) continue;
      jx /= jl; jy /= jl; jz /= jl;
      const length = (nozzle.name.includes("boost") ? BOOST_LENGTH : LENGTH) * size * (.55 + .45 * power);
      for (let k = 0; k < PUFFS; k++) {
        if (this.count >= MAX_PLUME_CARDS) return;
        // Puffs flicker along the jet with the tick, each nozzle out of step with the others.
        const flicker = ((tick * 7 + n * 3 + k * 5 + id) % 11) / 11;
        const t = (k + .35 + .5 * flicker) / PUFFS, along = t * length;
        const x = x0 + jx * along, y = y0 + jy * along, z = z0 + jz * along;
        const distance = Math.hypot(x, y, z);
        if (distance < .2) continue;
        const vx = x / distance, vy = y / distance, vz = z / distance;
        // Stretched along the jet as it is seen, and across it toward the camera's side.
        const dot = jx * vx + jy * vy + jz * vz;
        let ax = jx - vx * dot, ay = jy - vy * dot, az = jz - vz * dot;
        const al = Math.hypot(ax, ay, az);
        if (al < 1e-3) { ax = vy; ay = -vx; az = 0; } else { ax /= al; ay /= al; az /= al; }
        const cx = vy * az - vz * ay, cy = vz * ax - vx * az, cz = vx * ay - vy * ax;
        const width = (.12 + WIDTH * t) * size * (.6 + .4 * power), stretch = width * (1.6 - .6 * t) * Math.max(.35, al);
        const shows = Math.round(255 * power * (1 - t * .8) * (k === 0 ? .8 : 1));
        if (shows <= 0) continue;
        const i = this.next(), card = this.cards;
        card[i] = x; card[i + 1] = y; card[i + 2] = z;
        card[i + DETAIL.along] = ax * stretch; card[i + DETAIL.along + 1] = ay * stretch; card[i + DETAIL.along + 2] = az * stretch;
        card[i + DETAIL.across] = cx * width; card[i + DETAIL.across + 1] = cy * width; card[i + DETAIL.across + 2] = cz * width;
        // No floor to fade toward: the gas blows down onto the road and is drawn whole.
        card[i + DETAIL.floor] = -1e6;
        this.words[i + DETAIL.colourA] = GAS;
        this.words[i + DETAIL.colourB] = GAS_SHADE;
        this.words[i + DETAIL.misc] = (misc | (shows << 16)) >>> 0;
      }
    }
  }
}
