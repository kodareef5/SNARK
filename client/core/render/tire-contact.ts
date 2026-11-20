// The closest posed wheels get a small contact patch on the same solid surfaces a suspension ray can hit.
import type { CollisionWorld } from "../../../shared/world/collide.ts";
import { castWorld, HIT_NONE, rayHit } from "../../../shared/world/ray.ts";
import { BONE_FLOATS, DETAIL, DETAIL_TIRE, FRAME, MAX_TIRE_CONTACTS, type FramePacket } from "./packet.ts";
import { VehicleCards } from "./vehicle-cards.ts";

interface Wheel {
  bone: number;
  x: number;
  y: number;
  z: number;
  radius: number;
  distance: number;
}
export const tireLoad = (radius: number, height: number, distance: number): number =>
  Math.max(0, Math.min(1, (1.2 - height / radius) / 0.17)) * Math.max(0, Math.min(1, (16 - distance) / 5));

export class TireContacts extends VehicleCards {
  private readonly wheels: Wheel[] = [];
  private used = 0;
  constructor() {
    super(MAX_TIRE_CONTACTS);
  }

  override begin(): void {
    super.begin();
    this.used = 0;
  }

  consider(p: FramePacket, first: number, bones: Int16Array, rest: ArrayLike<number>, radius: number): void {
    if (!p.lit || !p.tier.contact) return;
    const m = p.bones;
    for (const local of bones) {
      if (local < 0) continue;
      const bone = first + local,
        b = bone * BONE_FLOATS,
        i = local * 3;
      const x = rest[i]!,
        y = rest[i + 1]!,
        z = rest[i + 2]!;
      const cx = m[b]! * x + m[b + 1]! * y + m[b + 2]! * z + m[b + 3]!;
      const cy = m[b + 4]! * x + m[b + 5]! * y + m[b + 6]! * z + m[b + 7]!;
      const cz = m[b + 8]! * x + m[b + 9]! * y + m[b + 10]! * z + m[b + 11]!;
      const distance = Math.hypot(cx, cy, cz);
      if (distance >= 16) continue;
      let at = this.used;
      if (at === MAX_TIRE_CONTACTS) {
        at = 0;
        for (let k = 1; k < this.used; k++) if (this.wheels[k]!.distance > this.wheels[at]!.distance) at = k;
        if (distance >= this.wheels[at]!.distance) continue;
      } else this.used++;
      const wheel = (this.wheels[at] ??= {} as Wheel);
      wheel.bone = bone;
      wheel.x = cx;
      wheel.y = cy;
      wheel.z = cz;
      wheel.radius = radius;
      wheel.distance = distance;
    }
  }

  build(p: FramePacket, world: CollisionWorld): void {
    if (this.used === 0) return;
    const support = { hf: world.hf, structs: world.structs };
    for (let i = 0; i < this.used; i++) {
      const w = this.wheels[i]!,
        radius = w.radius;
      const kind = castWorld(support, w.x + p.camX, w.y + p.camY, w.z + p.camZ, 0, -1, 0, radius * 1.7, true);
      if (kind === HIT_NONE || rayHit.ny < 0.65) continue;
      const { nx, ny, nz, t } = rayHit;
      const b = w.bone * BONE_FLOATS,
        m = p.bones;
      const dot = m[b]! * nx + m[b + 4]! * ny + m[b + 8]! * nz;
      const ax = m[b]! - dot * nx,
        ay = m[b + 4]! - dot * ny,
        az = m[b + 8]! - dot * nz,
        length = Math.hypot(ax, ay, az);
      // An axle pointing into the road belongs to a tipped vehicle.
      if (length < 0.7 * Math.hypot(m[b]!, m[b + 4]!, m[b + 8]!)) continue;
      const height = t * ny,
        strength = tireLoad(radius, height, w.distance);
      if (height < radius * 0.68 || strength <= 0) continue;
      const floor = nx * w.x + ny * w.y + nz * w.z - height;
      const slot = FRAME.tireContacts + this.count * 4;
      p.frame[slot] = nx;
      p.frame[slot + 1] = nz;
      p.frame[slot + 2] = floor;
      p.frame[slot + 3] = w.bone + 1;
      const o = this.next(),
        out = this.cards;
      out[o] = w.x - nx * (height - 0.006);
      out[o + 1] = w.y - ny * (height - 0.006);
      out[o + 2] = w.z - nz * (height - 0.006);
      // The compact is 0.8 radii wide. Feather the footprint beyond the tread on each side.
      const wide = (radius * 0.75) / length,
        long = (radius * 0.77) / length;
      const across = o + DETAIL.across,
        along = o + DETAIL.along;
      out[across] = ax * wide;
      out[across + 1] = ay * wide;
      out[across + 2] = az * wide;
      out[along] = (ay * nz - az * ny) * long;
      out[along + 1] = (az * nx - ax * nz) * long;
      out[along + 2] = (ax * ny - ay * nx) * long;
      this.words[o + DETAIL.misc] = (Math.round(255 * strength) << 16) | (DETAIL_TIRE << 8);
    }
  }
}

/** A dense core and a soft perimeter for the two triangles under the rubber. */
export function tireShadow(x: number, y: number): number {
  const d = Math.max(0, 1 - x * x - y * y);
  return 0.9 * d * d * (3 - 2 * d);
}

const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

/** Software vertex twin. The loaded part follows the support normal even as the wheel spins. */
export function deflectTire(
  frame: Float32Array,
  first: number,
  bone: number,
  rest: ArrayLike<number>,
  positions: Float32Array,
  vertex: number,
  px: number,
  py: number,
  pz: number,
  m: ArrayLike<number>,
  out: Float32Array,
): void {
  const i = vertex * 3,
    b = bone * 3,
    radius = Math.max(0.12, rest[b + 1]!);
  const radial = Math.hypot(positions[i + 1]! - rest[b + 1]!, positions[i + 2]! - rest[b + 2]!) / radius;
  if (radial <= 0.67) return;
  for (let slot = FRAME.tireContacts; slot < FRAME.tireContacts + MAX_TIRE_CONTACTS * 4; slot += 4) {
    if (!frame[slot + 3]) return;
    if (frame[slot + 3] !== first + bone + 1) continue;
    const nx = frame[slot]!,
      nz = frame[slot + 1]!,
      ny = Math.sqrt(Math.max(0, 1 - nx * nx - nz * nz)),
      floor = frame[slot + 2]!;
    const x = rest[b]! + px,
      y = rest[b + 1]! + py,
      z = rest[b + 2]! + pz;
    const hx = m[0]! * x + m[1]! * y + m[2]! * z + m[3]!,
      hy = m[4]! * x + m[5]! * y + m[6]! * z + m[7]!,
      hz = m[8]! * x + m[9]! * y + m[10]! * z + m[11]!;
    const scale = Math.hypot(m[0]!, m[4]!, m[8]!),
      r = radius * scale;
    const height = nx * hx + ny * hy + nz * hz - floor,
      above = nx * out[i]! + ny * out[i + 1]! + nz * out[i + 2]! - floor;
    const low = smooth(((height - above) / r - 0.5) / 0.44) * smooth((radial - 0.67) / 0.22) * tireLoad(r, height, Math.hypot(hx, hy, hz));
    const side = (Math.max(-1, Math.min(1, (positions[i]! - rest[b]!) / (radius * 0.2))) * 0.095 * r * low) / scale;
    const drop = Math.min(0.16 * r, Math.max(0, height - r) + 0.055 * r);
    const settle = (Math.max(0.0015, above - drop) - above) * low;
    out[i]! += m[0]! * side + nx * settle;
    out[i + 1]! += m[4]! * side + ny * settle;
    out[i + 2]! += m[8]! * side + nz * settle;
    return;
  }
}
