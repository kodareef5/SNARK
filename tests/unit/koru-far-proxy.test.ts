import { expect, test } from "bun:test";
import { KORU_LAYOUT, koruStatics } from "../../content/landmarks/koru.ts";
import { CHUNK_SIZE, chunkAt, chunkCx, chunkCz } from "../../shared/coords.ts";
import { CityStatics, mergedPart, type CityPart } from "../../shared/world/city.ts";
import { Heightfield } from "../../shared/world/heightfield.ts";
import { coreRegistry } from "../fixtures/world.ts";

/** Intersect the actual generated far faces with a horizontal plane and one centre-line ray. */
function crossSection(part: CityPart, y: number, axis: 0 | 2, across: number): number[] {
  const hits: number[] = [], other = axis === 0 ? 2 : 0;
  for (let f = 0; f < part.faces; f++) {
    const points: number[][] = [];
    for (let i = 0; i < 4; i++) {
      const a = f * 12 + i * 3, b = f * 12 + ((i + 1) % 4) * 3, ay = part.pos[a + 1]!, by = part.pos[b + 1]!;
      if ((ay > y) === (by > y)) continue;
      const t = (y - ay) / (by - ay);
      points.push([part.pos[a]! + (part.pos[b]! - part.pos[a]!) * t, y, part.pos[a + 2]! + (part.pos[b + 2]! - part.pos[a + 2]!) * t]);
    }
    if (points.length !== 2) continue;
    const [a, b] = points as [number[], number[]], width = b[other]! - a[other]!;
    if (Math.abs(width) < 1e-9) continue;
    const t = (across - a[other]!) / width;
    if (t >= -1e-6 && t <= 1 + 1e-6) hits.push(a[axis]! + (b[axis]! - a[axis]!) * t);
  }
  return hits;
}

test("all three complete mast shafts survive both native look-proxy and lattice handover levels", () => {
  const reg = coreRegistry(), dims = { chunksX: 32, chunksZ: 32 }, hf = new Heightfield(dims, 2, -32, 1 / 256);
  const statics = koruStatics(1024, 0, 1024), mast = KORU_LAYOUT.modules.filter(m => /^core:koru_mast_(fore|main|mizzen)_\d$/.test(m.id));
  expect(mast).toHaveLength(9);
  for (const module of mast) {
    const placed = statics.find(s => s.kind === module.id)!, body = module.boxes[0]!;
    const city = new CityStatics(dims, [placed], reg), chunk = chunkAt(dims, placed.x, placed.z);
    const center = [placed.x - chunkCx(dims, chunk) * CHUNK_SIZE, placed.y, placed.z - chunkCz(dims, chunk) * CHUNK_SIZE];
    for (const least of [0, 2.1]) {
      const part = mergedPart(city, chunk, hf, () => null, least === 0 ? .01 : .5, least);
      for (const fraction of [-.9, -.5, 0, .5, .9]) for (const axis of [0, 2] as const) {
        const y = placed.y + body.at[1]! + body.half[1]! * fraction;
        const hits = crossSection(part, y, axis, center[axis === 0 ? 2 : 0]!);
        const label = `${module.id} ${least === 0 ? "look" : "lattice"} shaft atY${y} axis${axis}`;
        expect(hits.length, label).toBeGreaterThanOrEqual(2);
        expect(Math.min(...hits), label).toBeLessThanOrEqual(center[axis]! - body.half[axis]! * .95);
        expect(Math.max(...hits), label).toBeGreaterThanOrEqual(center[axis]! + body.half[axis]! * .95);
      }
    }
  }
});
