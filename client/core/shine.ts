// A thing that holds loot shines for a moment, as a vehicle worth walking to does (shimmer.ts): as a survivor comes
// near it, and again when the aim comes to rest on it. Which hold loot is content's (StructureDef.holds) and whether
// they are searched the server's (OWN_RULES); one the server said was searched does not shine. How it is drawn is
// render/passes/near-store.ts (`shine`).

import type { Registry } from "../../shared/content/registry.ts";
import { holdIsVehicle } from "../../shared/sim/loot.ts";
import { Found, type StructureStore } from "../../shared/world/structures.ts";
import type { AppFrame, FramePart } from "./frame.ts";
import { SHIMMER_GAP_MS, SHIMMER_MOST, SHIMMER_MS } from "./shimmer.ts";

/** Metres within which a thing shines once as it is come upon, and milliseconds between two looks for such things. */
export const SHINE_NEAR = 14, SHINE_LOOK_MS = 250;

export class Shine implements FramePart {
  /** The things shining now, by ref, and how far each has come, 0 to 1 (render/passes/near-store.ts reads these). */
  count = 0;
  readonly refs = new Float64Array(SHIMMER_MOST);
  readonly phase = new Float32Array(SHIMMER_MOST);
  private readonly from = new Float64Array(SHIMMER_MOST);
  /** The things that shone for being come upon and have not been left since, and when each last began. */
  private readonly near = new Set<number>();
  private readonly last = new Map<number, number>();
  private readonly found = new Found();
  private readonly here = new Set<number>();
  private readonly asks: [ref: number, far: number][] = [];
  private lookAt = 0;
  /** The thing the prompt is on (Prompts.searchAimed), or -1; and whether one is known to have been searched. */
  aimed: () => number = () => -1;
  spent: (ref: number) => boolean = () => false;

  step(f: AppFrame): void {
    const s = f.session;
    // Seated, nothing is being looked for.
    if (!f.alive || f.car || f.passenger) this.count = 0;
    else this.update(f.nowMs, f.world.structs, s.registry, f.bx, f.by, f.bz, (tag) => (holdIsVehicle(tag) ? s.searchWrecks : s.searchStreet), this.aimed());
    f.scene.shine = this;
  }

  /**
   * The shines at `now` ms for a survivor at (x, y, z): those begun go on to their end, and each thing of `structs` that
   * holds loot `on` allows begins one where it has come within SHINE_NEAR, or is `aimed` at, if its last began
   * SHIMMER_GAP_MS ago or more and fewer than SHIMMER_MOST are going, the nearest first.
   */
  update(now: number, structs: StructureStore, reg: Registry, x: number, y: number, z: number, on: (tag: string) => boolean, aimed: number): void {
    let n = 0;
    for (let k = 0; k < this.count; k++) {
      const t = (now - this.from[k]!) / SHIMMER_MS;
      if (t >= 1) continue;
      this.refs[n] = this.refs[k]!;
      this.from[n] = this.from[k]!;
      this.phase[n++] = t;
    }
    this.count = n;
    if (now >= this.lookAt) {
      this.lookAt = now + SHINE_LOOK_MS;
      const { here, asks } = this;
      here.clear();
      asks.length = 0;
      const c = structs.query(x - SHINE_NEAR, z - SHINE_NEAR, x + SHINE_NEAR, z + SHINE_NEAR, this.found);
      for (let i = 0; i < c; i++) {
        const ref = this.found.refs[i]!, t = structs.chunks[ref >>> 16], slot = ref & 0xffff;
        if (!t || t.owner[slot] !== 0) continue;
        const tag = reg.holds[t.kind[slot]!];
        if (tag == null || !on(tag)) continue;
        const far = Math.hypot(t.x[slot]! - x, t.y[slot]! - y, t.z[slot]! - z);
        if (far > SHINE_NEAR) continue;
        here.add(ref);
        if (!this.near.has(ref)) asks.push([ref, far]);
      }
      for (const ref of this.near) if (!here.has(ref)) this.near.delete(ref);
      asks.sort((a, b) => a[1] - b[1]);
      // One there was no room for is asked again at the next look.
      for (const [ref] of asks) if (this.begin(ref, now)) this.near.add(ref);
      if (this.last.size > 512) for (const [ref, at] of this.last) if (now - at > SHIMMER_GAP_MS) this.last.delete(ref);
    }
    if (aimed >= 0) this.begin(aimed, now);
  }

  /** Begins the shine of `ref` if it may. False only where four are going already. */
  private begin(ref: number, now: number): boolean {
    if (this.spent(ref) || now - (this.last.get(ref) ?? -Infinity) < SHIMMER_GAP_MS) return true;
    if (this.count >= SHIMMER_MOST) return false;
    this.refs[this.count] = ref;
    this.from[this.count] = now;
    this.phase[this.count++] = 0;
    this.last.set(ref, now);
    return true;
  }
}
