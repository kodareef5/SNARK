// A short cosmetic fall of the existing tree mesh. It owns no collision or node state and can be revoked on correction.
import type { TreePresentationEvent } from "./vehicle-trees.ts";
const MOST_FALLS = 16, LIFE_MS = 1400;
interface Fall { event: TreePresentationEvent; start: number }
export class TreeFalls {
  private readonly active = new Map<number, Fall>();
  private readonly pose = new Float64Array(12);
  get count(): number { return this.active.size; }
  add(event: TreePresentationEvent, now: number): void {
    if (event.action === "revoke") { this.active.delete(event.ref); return; }
    if (event.action !== "break" || this.active.has(event.ref)) return;
    if (this.active.size >= MOST_FALLS) this.active.delete(this.active.keys().next().value!);
    this.active.set(event.ref, { event: { ...event }, start: now });
  }
  frame(now: number, draw: (event: TreePresentationEvent, pose: Float64Array) => void): void {
    for (const [ref, fall] of this.active) {
      const age = Math.max(0, now - fall.start) / LIFE_MS;
      if (age >= 1) { this.active.delete(ref); continue; }
      const event = fall.event, length = Math.hypot(event.dx, event.dz), dx = length > .01 ? event.dx / length : 0, dz = length > .01 ? event.dz / length : 1;
      const t = Math.min(1, age / .7), angle = 1.25 * t * t, c = Math.cos(angle), s = Math.sin(angle), v = 1 - c;
      const ax = dz, az = -dx, yaw = event.yaw * Math.PI * 2 / 65536, cy = Math.cos(yaw), sy = Math.sin(yaw);
      const fade = age < .65 ? 1 : Math.max(0, (1 - age) / .35), m = this.pose;
      const xx = c + ax * ax * v, xy = -az * s, xz = ax * az * v;
      const yx = az * s, yy = c, yz = -ax * s;
      const zx = ax * az * v, zy = ax * s, zz = c + az * az * v;
      m[0] = (xx * cy - xz * sy) * fade; m[1] = xy * fade; m[2] = (xx * sy + xz * cy) * fade; m[3] = event.x + dx * age * .5;
      m[4] = (yx * cy - yz * sy) * fade; m[5] = yy * fade; m[6] = (yx * sy + yz * cy) * fade; m[7] = event.y - age * .08;
      m[8] = (zx * cy - zz * sy) * fade; m[9] = zy * fade; m[10] = (zx * sy + zz * cy) * fade; m[11] = event.z + dz * age * .5;
      draw(event, m);
    }
  }
}
