// A dense resident chunk keeps its eligible anchors in a balanced spatial tree. It is built as a chunk enters reach or its shape changes.
// Capture searches only three points along the view, with a fixed node budget for each.
import type { ChunkTable } from "../../../shared/world/structures.ts";
export class ReceiverIndex {
  readonly shape: number;
  private readonly slots: Uint16Array;
  private readonly axes: readonly Float32Array[];
  constructor(t: ChunkTable, priority: Float32Array) {
    this.shape = t.shape;
    this.axes = [t.x, t.y, t.z];
    const eligible: number[] = [];
    for (let slot = 0; slot < t.high; slot++) if (priority[t.kind[slot]!]! > 0) eligible.push(slot);
    this.slots = Uint16Array.from(eligible);
    this.partition(0, this.slots.length, 0);
  }
  private partition(lo: number, hi: number, axis: number): void {
    if (hi-lo < 2) return;
    const coords = this.axes[axis]!;
    this.slots.subarray(lo,hi).sort((a,b) => coords[a]! - coords[b]! || a-b);
    const mid = (lo+hi) >>> 1, next = (axis+1)%3;
    this.partition(lo,mid,next);
    this.partition(mid+1,hi,next);
  }
  private x = 0;
  private y = 0;
  private z = 0;
  private best = 0;
  private slot = -1;
  private visits = 0;
  nearest(x: number, y: number, z: number): number {
    this.x = x; this.y = y; this.z = z;
    this.best = 20*20; this.slot = -1; this.visits = 0;
    this.search(0,this.slots.length,0);
    return this.slot;
  }
  private search(lo: number, hi: number, axis: number): void {
    if (lo >= hi || this.visits >= 48) return;
    this.visits++;
    const mid = (lo+hi) >>> 1, slot = this.slots[mid]!;
    const dx = this.x-this.axes[0]![slot]!, dy = this.y-this.axes[1]![slot]!, dz = this.z-this.axes[2]![slot]!;
    const d2 = dx*dx+dy*dy+dz*dz;
    if (d2 < this.best) { this.best = d2; this.slot = slot; }
    const delta = axis === 0 ? dx : axis === 1 ? dy : dz, next = (axis+1)%3;
    this.search(delta < 0 ? lo : mid+1,delta < 0 ? mid : hi,next);
    if (delta*delta <= this.best) this.search(delta < 0 ? mid+1 : lo,delta < 0 ? hi : mid,next);
  }
}
