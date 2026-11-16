// Rotor presentation only: two native cards per helicopter, independent of frame rate, with the real rotor plane/radius.
import { quatRotate } from "../../../shared/math/quat.ts";
import type { VehicleRotor } from "../../../shared/sim/vehicle.ts";
import type { Camera } from "./camera.ts";
import { BONE_FLOATS, DETAIL, DETAIL_FLOATS, DETAIL_LIT, DETAIL_ROTOR, type FramePacket } from "./packet.ts";

/** A dense flight scene has a bounded cost. Beyond this, ordinary authored blades remain visible. */
export const MAX_ROTOR_CARDS = 256;
const BLADE_EPSILON = 1e-6;
const DARK = 0xff39352f, TIP = 0xff6dbcd6;

/** Passage frequency, not display FPS: a tail rotor reaches the blurred regime sooner than the main rotor. */
export function rotorPassages(rotor: VehicleRotor, rpm: number): number {
  return rotor.blur ? Math.abs(rpm * rotor.ratio) * rotor.blur.blades / 60 : 0;
}

export class RotorBlur {
  count = 0;
  private frame = 0;
  private readonly previous = new Map<number, { frame: number; blurred: boolean }>();
  private readonly cards = new Float32Array(MAX_ROTOR_CARDS * DETAIL_FLOATS);
  private readonly words = new Uint32Array(this.cards.buffer);
  private readonly order = new Uint16Array(MAX_ROTOR_CARDS);
  private readonly point = new Float64Array(3);

  begin(): void {
    this.count = 0;
    this.frame++;
    for (const [id, state] of this.previous) if (state.frame < this.frame - 2) this.previous.delete(id);
  }

  /** Add only after the body's bones are posed, and only for bodies the frame actually draws. */
  add(p: FramePacket, bone: number, key: number, rotor: VehicleRotor, rpm: number, q: Float64Array, x: number, y: number, z: number, size: number): boolean {
    const authored = rotor.blur, hz = rotorPassages(rotor, rpm);
    if (!authored || hz <= 6 || this.count === MAX_ROTOR_CARDS) return false;
    const previous = this.previous.get(key);
    // Hysteresis keeps an interpolated RPM near the transition from blinking the discrete blades on and off.
    const blurred = hz >= (previous?.blurred ? 10 : 12);
    this.previous.set(key, { frame: this.frame, blurred });
    const n = this.count++, o = n * DETAIL_FLOATS;
    this.order[n] = n;
    const out = this.cards, r = rotor.radius * size;
    quatRotate(q, 0, rotor.at[0] * size, rotor.at[1] * size, rotor.at[2] * size, this.point, 0);
    out[o] = this.point[0]! + x; out[o + 1] = this.point[1]! + y; out[o + 2] = this.point[2]! + z;
    // Pick a stable basis of the local rotor plane, then turn it with the full vehicle attitude.
    const [nx, ny, nz] = rotor.axis;
    const [tx, ty, tz] = Math.abs(ny) < .9 ? [-nz, 0, nx] : [ny, -nx, 0];
    const length = Math.hypot(tx!, ty!, tz!), ax = tx! / length, ay = ty! / length, az = tz! / length;
    quatRotate(q, 0, ax * r, ay * r, az * r, this.point, 0);
    out.set(this.point, o + DETAIL.across);
    quatRotate(q, 0, (ny * az - nz * ay) * r, (nz * ax - nx * az) * r, (nx * ay - ny * ax) * r, this.point, 0);
    out.set(this.point, o + DETAIL.along);
    out[o + DETAIL.floor] = 0;
    this.words[o + DETAIL.colourA] = DARK;
    this.words[o + DETAIL.colourB] = TIP;
    const ramp = Math.min(1, (hz - 6) / 6), shows = Math.round(ramp * ramp * (3 - 2 * ramp) * 255);
    const density = Math.max(1, Math.round(authored.blades * authored.chord / (Math.PI * 2 * rotor.radius) * 255));
    this.words[o + DETAIL.misc] = ((density << 24) | (shows << 16) | ((DETAIL_LIT | DETAIL_ROTOR) << 8)) >>> 0;
    if (blurred) {
      // Collapse immediately at the transition, never animate blades shrinking. Epsilon retains finite transformed
      // normals in the surface program, unlike zero scale. Chassis-weighted hubs and mast remain full size.
      const b = bone * BONE_FLOATS;
      for (let row = 0; row < 3; row++) {
        const i = b + row * 4;
        const pivot = p.bones[i]! * rotor.at[0] + p.bones[i + 1]! * rotor.at[1] + p.bones[i + 2]! * rotor.at[2] + p.bones[i + 3]!;
        for (let col = 0; col < 3; col++) p.bones[i + col]! *= BLADE_EPSILON;
        p.bones[i + 3] = pivot - p.bones[i]! * rotor.at[0] - p.bones[i + 1]! * rotor.at[1] - p.bones[i + 2]! * rotor.at[2];
      }
    }
    return blurred;
  }

  /** The caller reserves `count` entries before cosmetic particles; cards are kept far to near. */
  write(p: FramePacket): void {
    const cards = this.cards, order = this.order.subarray(0, this.count);
    const distance = (i: number) => { const o = i * DETAIL_FLOATS; return cards[o]! ** 2 + cards[o + 1]! ** 2 + cards[o + 2]! ** 2; };
    order.sort((a, b) => distance(b) - distance(a));
    for (const n of order) {
      const o = n * DETAIL_FLOATS;
      p.details.set(cards.subarray(o, o + DETAIL_FLOATS), p.detailCount++ * DETAIL_FLOATS);
    }
  }

  /** Cards can be seen past the near depth range, including a rotor straddling the split. */
  passes(cam: Camera): number {
    let from = Infinity, to = -Infinity;
    for (let n = 0; n < this.count; n++) {
      const o = n * DETAIL_FLOATS, f = this.cards;
      const d = cam.depth(f[o]!, f[o + 1]!, f[o + 2]!);
      const reach = Math.abs(cam.depth(f[o + DETAIL.along]!, f[o + DETAIL.along + 1]!, f[o + DETAIL.along + 2]!)) + Math.abs(cam.depth(f[o + DETAIL.across]!, f[o + DETAIL.across + 1]!, f[o + DETAIL.across + 2]!));
      from = Math.min(from, d - reach); to = Math.max(to, d + reach);
    }
    return cam.passesOf(from, to);
  }
}
