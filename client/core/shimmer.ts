// A vehicle worth walking to shimmers for a moment, so that it is told from the wrecks and hulls about it without being
// tried: as it first comes near in view, and again when the aim passes over it. Which are worth it is vehicle-ready.ts;
// how the shimmer is drawn is render/characters.ts (`glow`) and render/shimmer-glsl.ts.

import { MAX_VIEW } from "../../shared/net/view.ts";
import type { Registry } from "../../shared/content/registry.ts";
import type { AppFrame, FramePart } from "./frame.ts";
import type { RemoteSample } from "./session.ts";
import { usableVehicle } from "./vehicle-ready.ts";

/** Milliseconds a shimmer lasts, and the least between two of one vehicle's. */
export const SHIMMER_MS = 800, SHIMMER_GAP_MS = 6000;
/** Metres within which a vehicle coming into view shimmers once, past which it may do so again, and within which the aim sets it off. */
export const SHIMMER_NEAR = 40, SHIMMER_LEFT = 46, SHIMMER_AIM = 30;
/** Vehicles shimmering at once, the nearest first. */
export const SHIMMER_MOST = 4;
const bodyKey = (id: number, gen: number): number => id * 65536 + gen;

export class Shimmer implements FramePart {
  /** The vehicles shimmering now, by id, and how far each has come, 0 to 1 (render/characters.ts reads these). */
  count = 0;
  readonly ids = new Int32Array(SHIMMER_MOST);
  readonly phase = new Float32Array(SHIMMER_MOST);
  private readonly keys = new Float64Array(SHIMMER_MOST);
  private readonly rows = new Map<number, number>();
  private readonly occupied = new Map<number, number>();
  private readonly from = new Float64Array(SHIMMER_MOST);
  /** The vehicles that have shimmered for coming near and have not left since, and when each last began. */
  private readonly near = new Set<number>();
  private readonly last = new Map<number, number>();
  private readonly asks = new Uint16Array(MAX_VIEW);
  private readonly far = new Float32Array(MAX_VIEW);
  /** The id of the body the aim is on (Prompts.target), or -1. */
  aimed: () => number = () => -1;

  step(f: AppFrame): void {
    const s = f.session;
    // Seated, nothing is being looked for.
    if (!f.alive || f.car || f.passenger) this.count = 0;
    else this.update(f.nowMs, s.registry, f.remote, s.tribe.team, f.bx, f.by, f.bz, (r, i) => f.cam.boxVisible(r.x[i]! - f.cam.x - 4, r.y[i]! - f.cam.y - 1, r.z[i]! - f.cam.z - 4, r.x[i]! - f.cam.x + 4, r.y[i]! - f.cam.y + 3, r.z[i]! - f.cam.z + 4), this.aimed());
    f.scene.characters.glow = this;
  }

  /**
   * The shimmers at `now` ms for a viewer of tribe `team` standing at (x, y, z): those begun go on to their end, and each
   * usable vehicle of `r` begins one where it has come within SHIMMER_NEAR in view, or is `aimed` at within SHIMMER_AIM,
   * if its last began SHIMMER_GAP_MS ago or more and fewer than SHIMMER_MOST are going, the nearest first.
   */
  update(now: number, reg: Registry, r: RemoteSample, team: number, x: number, y: number, z: number, visible: (r: RemoteSample, i: number) => boolean, aimed: number): void {
    this.rows.clear();
    this.occupied.clear();
    for (let i = 0; i < r.count; i++) {
      if (reg.vehicle[r.kind[i]!]) this.rows.set(bodyKey(r.id[i]!, r.gen[i]!), i);
      if (!r.seat[i] || !r.seatSlot[i]) continue;
      const key = bodyKey(r.seat[i]! - 1, r.seatGen[i]!);
      this.occupied.set(key, (this.occupied.get(key) ?? 0) + 1);
    }
    for (const key of this.near) if (!this.rows.has(key)) this.near.delete(key);
    let n = 0;
    for (let k = 0; k < this.count; k++) {
      const key = this.keys[k]!, row = this.rows.get(key);
      const t = (now - this.from[k]!) / SHIMMER_MS;
      if (t >= 1 || t < 0 || row === undefined || !usableVehicle(reg, r, row, team, this.occupied.get(key) ?? 0)) continue;
      this.keys[n] = key;
      this.ids[n] = this.ids[k]!;
      this.from[n] = this.from[k]!;
      this.phase[n++] = t;
    }
    this.count = n;
    let asking = 0;
    for (const [key, i] of this.rows) {
      const id = r.id[i]!;
      const d = Math.hypot(r.x[i]! - x, r.y[i]! - y, r.z[i]! - z);
      if (d > SHIMMER_LEFT) { this.near.delete(key); continue; }
      if (!usableVehicle(reg, r, i, team, this.occupied.get(key) ?? 0)) {
        this.near.delete(key);
        continue;
      }
      const came = d < SHIMMER_NEAR && !this.near.has(key) && visible(r, i);
      if (came) this.near.add(key);
      if (!came && !(id === aimed && d < SHIMMER_AIM)) continue;
      if (now - (this.last.get(key) ?? -Infinity) < SHIMMER_GAP_MS) continue;
      this.asks[asking] = i;
      this.far[asking++] = d;
    }
    // The nearest first, while there is room.
    while (this.count < SHIMMER_MOST) {
      let best = -1;
      for (let k = 0; k < asking; k++) if (this.far[k]! >= 0 && (best < 0 || this.far[k]! < this.far[best]!)) best = k;
      if (best < 0) break;
      const i = this.asks[best]!, id = r.id[i]!, key = bodyKey(id, r.gen[i]!);
      this.far[best] = -1;
      this.keys[this.count] = key;
      this.ids[this.count] = id;
      this.from[this.count] = now;
      this.phase[this.count++] = 0;
      this.last.set(key, now);
    }
    if (this.last.size > 256) for (const [id, at] of this.last) if (now - at > 10 * SHIMMER_GAP_MS) this.last.delete(id);
  }
}
