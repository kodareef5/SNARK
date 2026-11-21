// The particles of small details, in typed arrays, stepped once a frame. A particle flies by its effect's numbers, lands on
// the floor it was born over (the ground, or the floor a body stood on, kept as a plane), lies there, and fades. Nothing
// here is read by the simulation.

import type { DetailEffect } from "../../../shared/pack/details.ts";
import type { Heightfield } from "../../../shared/world/heightfield.ts";

const G = 9.81;
/** Metres a lying particle is lifted off the floor, so it does not flicker into it. */
const LIFT = 0.012;
/** Seconds over which a see-through particle comes in, so it is never seen to appear. */
export const FADE_IN = 0.08;

export class Pool {
  /** The most particles there is room for, and how many are alive: the first `count` of every array. */
  readonly room: number;
  count = 0;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly z: Float64Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly vz: Float32Array;
  /** Seconds since it was born, and the age at which it is gone. */
  readonly age: Float32Array;
  readonly end: Float32Array;
  /** The age it landed at, or -1 while it flies. */
  readonly landed: Float32Array;
  /** The floor it lands on: a height, or NaN to follow the ground. */
  readonly plane: Float64Array;
  readonly size: Float32Array;
  /** Fraction of the authored card width, for foam drawn out along the hull wash. */
  readonly widthScale: Float32Array;
  /** Its heading, its pitch, and the phases of its rocking and its sway, in radians, and the way it sways. */
  readonly heading: Float32Array;
  readonly pitch: Float32Array;
  readonly phase: Float32Array;
  readonly swayTo: Float32Array;
  /** Lying, the axes of its card: along its length, then across, each of length 1. */
  readonly lying: Float32Array;
  readonly effect: Uint16Array;
  /** Its atlas cell, shape and flags, grey of 255, and its two colours as packed words (packet.ts DETAIL). */
  readonly cell: Uint8Array;
  readonly flags: Uint8Array;
  readonly grey: Uint8Array;
  readonly colourA: Uint32Array;
  readonly colourB: Uint32Array;
  /** Every array of one number a particle, for moving one into another's place. */
  private readonly columns: (Float64Array | Float32Array | Uint32Array | Uint16Array | Uint8Array)[];

  constructor(room: number) {
    this.room = room;
    const f64 = (): Float64Array => new Float64Array(room);
    const f32 = (): Float32Array => new Float32Array(room);
    this.x = f64();
    this.y = f64();
    this.z = f64();
    this.plane = f64();
    this.vx = f32();
    this.vy = f32();
    this.vz = f32();
    this.age = f32();
    this.end = f32();
    this.landed = f32();
    this.size = f32();
    this.widthScale = f32();
    this.heading = f32();
    this.pitch = f32();
    this.phase = f32();
    this.swayTo = f32();
    this.lying = new Float32Array(room * 6);
    this.effect = new Uint16Array(room);
    this.cell = new Uint8Array(room);
    this.flags = new Uint8Array(room);
    this.grey = new Uint8Array(room);
    this.colourA = new Uint32Array(room);
    this.colourB = new Uint32Array(room);
    this.columns = [this.x, this.y, this.z, this.plane, this.vx, this.vy, this.vz, this.age, this.end, this.landed, this.size, this.widthScale, this.heading, this.pitch, this.phase, this.swayTo, this.effect, this.cell, this.flags, this.grey, this.colourA, this.colourB];
  }

  /** Room for one more, its index, or -1. */
  take(): number {
    return this.count < this.room ? this.count++ : -1;
  }

  /** Moves the last particle into `i`'s place. */
  private drop(i: number): void {
    const last = --this.count;
    if (i === last) return;
    for (const a of this.columns) a[i] = a[last]!;
    this.lying.copyWithin(i * 6, last * 6, last * 6 + 6);
  }

  /** The floor under (x, z) for particle `i`: its plane, or the ground, never under the water. */
  floor(i: number, x: number, z: number, hf: Heightfield): number {
    const p = this.plane[i]!;
    return p === p ? p : Math.max(hf.heightAt(x, z), hf.waterAt(x, z));
  }

  /**
   * Moves every particle on by `dt` seconds in the wind (wx, wz), metres a second. One that lands lies for its effect's
   * `settle` times `rest`, a share that falls as the pool fills.
   */
  step(dt: number, effects: readonly DetailEffect[], hf: Heightfield, wx: number, wz: number, rest: number): void {
    for (let i = 0; i < this.count; ) {
      const e = effects[this.effect[i]!]!;
      const age = (this.age[i]! += dt);
      if (age >= this.end[i]!) {
        this.drop(i);
        continue;
      }
      if (this.landed[i]! >= 0) {
        i++;
        continue;
      }
      let vx = this.vx[i]!;
      let vy = this.vy[i]!;
      let vz = this.vz[i]!;
      const k = Math.min(1, e.drag * dt);
      vx += (wx * e.wind - vx) * k;
      vz += (wz * e.wind - vz) * k;
      vy += -vy * k - G * e.gravity * dt;
      if (e.fall > 0 && vy < -e.fall) vy = -e.fall;
      this.vx[i] = vx;
      this.vy[i] = vy;
      this.vz[i] = vz;
      // A falling feather sways as it falls, more the nearer it is to falling at its fastest.
      let sx = 0;
      let sz = 0;
      if (e.sway > 0 && vy < 0) {
        const falling = e.fall > 0 ? Math.min(1, -vy / e.fall) : 1;
        const w = 2 * Math.PI * e.swayHz;
        const s = e.sway * w * Math.cos(w * age + this.phase[i]!) * falling * dt;
        sx = Math.cos(this.swayTo[i]!) * s;
        sz = Math.sin(this.swayTo[i]!) * s;
      }
      const x = (this.x[i]! += vx * dt + sx);
      const z = (this.z[i]! += vz * dt + sz);
      let y = (this.y[i]! += vy * dt);
      const floor = this.floor(i, x, z, hf);
      if (e.settle > 0 && y <= floor + LIFT && vy <= 0) {
        this.y[i] = floor + LIFT;
        this.landed[i] = age;
        this.end[i] = age + e.settle * rest + e.fade;
        this.lie(i, x, z, hf);
      } else if (e.settle <= 0) {
        // One that never lands hovers: a puff a quarter of its size over the floor, a flat ring just on it.
        const over = e.face === "flat" ? LIFT : this.size[i]! * 0.25;
        if (y < floor + over) {
          y = this.y[i] = floor + over;
          if (this.vy[i]! < 0) this.vy[i] = 0;
        }
      }
      i++;
    }
  }

  /** Lays particle `i` on the floor at (x, z), its length along its heading, its card on the ground's slope. */
  private lie(i: number, x: number, z: number, hf: Heightfield): void {
    const p = this.plane[i]!;
    let nx = 0, ny = 1, nz = 0;
    if (p !== p && hf.heightAt(x, z) > hf.waterAt(x, z)) {
      const d = 0.25;
      nx = hf.heightAt(x - d, z) - hf.heightAt(x + d, z);
      nz = hf.heightAt(x, z - d) - hf.heightAt(x, z + d);
      ny = 2 * d;
      const l = Math.hypot(nx, ny, nz);
      nx = nx / l;
      ny = ny / l;
      nz = nz / l;
    }
    const h = this.heading[i]!;
    let ax = Math.cos(h), ay = 0, az = Math.sin(h);
    // Along the slope: the heading less its part along the normal.
    const dot = ax * nx + ay * ny + az * nz;
    ax = ax - nx * dot;
    ay = ay - ny * dot;
    az = az - nz * dot;
    const l = Math.hypot(ax, ay, az) || 1;
    ax = ax / l;
    ay = ay / l;
    az = az / l;
    const o = i * 6;
    const lying = this.lying;
    lying[o] = ax;
    lying[o + 1] = ay;
    lying[o + 2] = az;
    lying[o + 3] = ny * az - nz * ay;
    lying[o + 4] = nz * ax - nx * az;
    lying[o + 5] = nx * ay - ny * ax;
  }

  /** How much of particle `i` shows, 0 to 1: coming in when it is see-through, and going over its effect's fade. */
  shows(i: number, e: DetailEffect): number {
    const age = this.age[i]!;
    const out = e.fade > 0 ? Math.min(1, (this.end[i]! - age) / e.fade) : 1;
    return e.pass === "blend" ? Math.min(out, age / FADE_IN) : out;
  }
}
