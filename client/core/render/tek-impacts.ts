import { TEK_WALL as wall } from "../../../content/building/tek-wall.ts";
import { frame, frameOf } from "../../../shared/world/frame.ts";
import { Found, type StructureStore } from "../../../shared/world/structures.ts";
import type { Camera } from "./camera.ts";
import { DETAIL, DETAIL_GLOW, DETAIL_TEK, GLOW_STEPS } from "./packet.ts";
import { fieldWord, inField, RIPPLE_MS, RIPPLE_SPEED } from "./tek-ripple.ts";
import { VehicleCards } from "./vehicle-cards.ts";

const MAX_IMPACTS = 4;
export const TEK_IMPACT_REACH = 48;
const OFFSET = 0.003;
const FLASH_MS = 135;

interface Impact {
  ref: number; x: number; y: number; z: number; yaw: number; tw: number;
  u: number; v: number; c: number; s: number; face: number; side: number;
  adjacent: number; born: number;
}

export class TekImpacts extends VehicleCards {
  private readonly active: Impact[] = [];
  private readonly near = new Found(8);

  readonly kind: number;

  constructor(kind: number) {
    super(MAX_IMPACTS * 2);
    this.kind = kind;
  }

  /** A field and its neighbour must share a whole upright edge in the same base. */
  private neighbour(store: StructureStore, h: Impact): number {
    const x = h.x + h.c * wall.width * h.side, z = h.z - h.s * wall.width * h.side;
    const n = store.query(x, z, x, z, this.near, h.y - 0.01, h.y + 0.01);
    for (let i = 0; i < n; i++) {
      const ref = this.near.refs[i]!;
      if (this.adjoins(store, ref, h)) return ref;
    }
    return -1;
  }

  hit(store: StructureStore, ref: number, x: number, y: number, z: number, nx: number, nz: number, dx: number, dy: number, dz: number, now: number): void {
    const t = store.chunks[ref >>> 16], slot = ref & 65535;
    if (!t || this.kind < 1 || t.kind[slot] !== this.kind) return;
    const yaw = t.yaw[slot]!, tw = t.twAt(slot);
    frameOf(yaw, tw);
    const c = frame.cos, s = frame.sin, normal = nx * s + nz * c;
    if (Math.abs(normal) < 0.995) return;
    const face = Math.sign(normal), slope = dx * s + dz * c;
    if (slope * face >= -0.0001) return;
    const wx = t.x[slot]!, wy = t.y[slot]!, wz = t.z[slot]!;
    if (!inField((x - wx) * c - (z - wz) * s, y - wy)) return;
    // The collider encloses the frame. Continue the arriving ray to the recessed face.
    const travel = (face * wall.panelZ - (x - wx) * s - (z - wz) * c) / slope;
    const u = (x + dx * travel - wx) * c - (z + dz * travel - wz) * s;
    const v = y + dy * travel - wy;
    if (!inField(u, v)) return;
    if (this.active.some((h) => h.ref === ref && h.born === now && h.face === face)) return;
    const h: Impact = { ref, x: wx, y: wy, z: wz, yaw, tw, c, s, u, v, face, side: u < 0 ? -1 : 1, adjacent: -1, born: now };
    h.adjacent = this.neighbour(store, h);
    if (this.active.length === MAX_IMPACTS) this.active.shift();
    this.active.push(h);
  }

  build(store: StructureStore, cam: Camera, now: number): void {
    this.begin();
    let kept = 0;
    for (const h of this.active) {
      const age = now - h.born, t = store.chunks[h.ref >>> 16], slot = h.ref & 65535;
      if (age >= RIPPLE_MS || age < 0 || !t || t.kind[slot] !== this.kind || t.yaw[slot] !== h.yaw || t.twAt(slot) !== h.tw ||
          t.x[slot] !== h.x || t.y[slot] !== h.y || t.z[slot] !== h.z) continue;
      this.active[kept++] = h;
      const vx = cam.x - h.x, vy = cam.y - h.y, vz = cam.z - h.z;
      if (vx * vx + vy * vy + vz * vz > TEK_IMPACT_REACH ** 2 || (vx * h.s + vz * h.c) * h.face < wall.panelZ) continue;
      const radius = 0.025 + age * RIPPLE_SPEED, extent = radius + 0.12;
      const left = Math.max(-wall.panelX, h.u - extent), right = Math.min(wall.panelX, h.u + extent);
      const bottom = Math.max(-wall.panelY, h.v - extent), top = Math.min(wall.panelY, h.v + extent);
      const u = (left + right) * 0.5, v = (bottom + top) * 0.5;
      const o = this.card(h, cam, u, v, wall.panelZ, (right - left) * 0.5, (top - bottom) * 0.5);
      this.cards[o + DETAIL.floor] = radius;
      this.words[o + DETAIL.colourA] = fieldWord(u, v);
      this.words[o + DETAIL.colourB] = fieldWord(h.u, h.v);
      const fade = Math.min(1, (RIPPLE_MS - age) / 200);
      this.words[o + DETAIL.misc] = (DETAIL_TEK << 8) | (Math.round(245 * fade) << 16);
      const railV = Math.max(-wall.railY + 0.32, Math.min(wall.railY - 0.32, h.v));
      const arrival = Math.hypot(h.side * wall.railX - h.u, railV - h.v) / RIPPLE_SPEED;
      const flash = age - arrival;
      if (h.adjacent < 0 || flash < 0 || flash > FLASH_MS || !this.adjoins(store, h.adjacent, h)) continue;
      const rail = this.card(h, cam, h.side * (wall.width - wall.railX), railV, wall.railZ, wall.railHalfWidth * 2.5, 0.32);
      this.words[rail + DETAIL.colourA] = 0xffffd196;
      const flicker = (1 - flash / FLASH_MS) * (flash > 43 && flash < 67 ? 0.2 : 1);
      this.words[rail + DETAIL.misc] = ((DETAIL_GLOW << 8) | (Math.round(255 * flicker) << 16) | (3 * GLOW_STEPS << 24)) >>> 0;
    }
    this.active.length = kept;
  }

  private adjoins(store: StructureStore, ref: number, h: Impact): boolean {
    const t = store.chunks[ref >>> 16], slot = ref & 65535;
    if (!t || t.kind[slot] !== this.kind || store.frameAt(h.ref) !== store.frameAt(ref)) return false;
    frameOf(t.yaw[slot]!, t.twAt(slot));
    return Math.abs(t.x[slot]! - h.x - h.side * wall.width * h.c) < 0.008 &&
      Math.abs(t.z[slot]! - h.z + h.side * wall.width * h.s) < 0.008 &&
      Math.abs(t.y[slot]! - h.y) < 0.005 && Math.abs(frame.cos * h.c + frame.sin * h.s) > 0.99999;
  }

  private card(h: Impact, cam: Camera, u: number, v: number, depth: number, w: number, height: number): number {
    const o = this.next(), f = this.cards, face = (depth + OFFSET) * h.face;
    f[o] = h.x - cam.x + h.c * u + h.s * face;
    f[o + 1] = h.y - cam.y + v;
    f[o + 2] = h.z - cam.z - h.s * u + h.c * face;
    f[o + DETAIL.across] = h.c * w;
    f[o + DETAIL.across + 2] = -h.s * w;
    f[o + DETAIL.along + 1] = height;
    return o;
  }
}
