// Nearby cold cars may refill the same node chunk many times in one host tick. Memoize only immutable map spots;
// depletion, HP, collision rows and retain/release lifetime still come from the ordinary NodeField/Harvest path.
import type { NodeSource, NodeSpot } from "../shared/world/nodes.ts";
// At the 256-slot map limit, sixteen reusable pages occupy 196 KiB including validity flags.
const CHUNKS = 16, STRIDE = 6;
interface Page { epoch: number; spots: Float64Array; valid: Uint8Array }
export class VehicleNodeCache implements NodeSource {
  readonly perChunk: number;
  private readonly source: NodeSource;
  private readonly pages = new Map<number, Page>();
  private tick = -1;
  private terrain = -1;
  private epoch = 0;
  constructor(source: NodeSource) { this.source = source; this.perChunk = source.perChunk; }
  begin(tick: number, terrain: number): void {
    if (tick !== this.tick || terrain !== this.terrain) { this.tick = tick; this.terrain = terrain; this.epoch++; }
  }
  at(chunk: number, index: number, out: NodeSpot): void {
    let page = this.pages.get(chunk);
    if (!page) {
      if (this.pages.size < CHUNKS) page = { epoch: -1, spots: new Float64Array(this.perChunk * STRIDE), valid: new Uint8Array(this.perChunk) };
      else { const oldest = this.pages.keys().next().value!; page = this.pages.get(oldest)!; this.pages.delete(oldest); page.epoch = -1; }
      this.pages.set(chunk, page);
    }
    const data = page.spots, at = index * STRIDE;
    if (page.epoch !== this.epoch) { page.valid.fill(0); page.epoch = this.epoch; }
    if (!page.valid[index]) {
      this.source.at(chunk, index, out); page.valid[index] = 1;
      data[at] = out.kind; data[at + 1] = out.form; data[at + 2] = out.x; data[at + 3] = out.y; data[at + 4] = out.z; data[at + 5] = out.yaw;
      return;
    }
    out.kind = data[at]!; out.form = data[at + 1]!; out.x = data[at + 2]!; out.y = data[at + 3]!; out.z = data[at + 4]!; out.yaw = data[at + 5]!;
  }
}
