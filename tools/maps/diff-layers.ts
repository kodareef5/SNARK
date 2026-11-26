// Two cuts of one city compared layer by layer where both hold the ground, away from the smaller's edge:
//
//   bun tools/maps/diff-layers.ts <work folder a> <work folder b> [--margin 600] [--layers height,biome,…]
//
// A work folder is one of tools/maps/city.ts (var/mapdata/<city>/<cut>/<city>). Both cuts share the city's projection,
// whose centre never moves, and their bounds lie on chunk edges, so a 2 m sample of one is a sample of the other. For each
// 2 m layer of base/ it counts the samples that differ more than --margin metres inside the edge of the ground both hold,
// and the nearest of them to that edge. It exits 1 when any does: a wider cut must leave the ground inside alone.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readGrey } from "../map/png.ts";

interface Frame {
  readonly bounds: readonly number[];
  readonly spacing_m: number;
}

/** Per layer: samples compared, samples that differ, and the least distance in metres of one of them inside the shared edge. */
export interface LayerDiff {
  readonly layer: string;
  readonly compared: number;
  readonly differ: number;
  readonly nearestEdge: number;
}

/** What differs between the layers `names` of the work folders `a` and `b`, more than `margin` metres inside their shared ground. */
export function diffLayers(a: string, b: string, names: readonly string[], margin: number): LayerDiff[] {
  const fa = JSON.parse(readFileSync(join(a, "map.json"), "utf8")) as Frame;
  const fb = JSON.parse(readFileSync(join(b, "map.json"), "utf8")) as Frame;
  if (fa.spacing_m !== fb.spacing_m) throw new Error("the cuts' samples are not the same size");
  const step = fa.spacing_m;
  const [w, s, e, n] = [Math.max(fa.bounds[0]!, fb.bounds[0]!), Math.max(fa.bounds[1]!, fb.bounds[1]!), Math.min(fa.bounds[2]!, fb.bounds[2]!), Math.min(fa.bounds[3]!, fb.bounds[3]!)];
  if (w >= e || s >= n) throw new Error("the cuts hold no ground in common");
  return names.map((layer) => {
    const ga = readGrey(new Uint8Array(readFileSync(join(a, "base", `${layer}.png`))), layer);
    const gb = readGrey(new Uint8Array(readFileSync(join(b, "base", `${layer}.png`))), layer);
    let compared = 0, differ = 0, nearestEdge = Infinity;
    // Sample (c, r) of a cut stands at east = west + step c and north = north - step r, its edges included.
    for (let north = n - margin; north >= s + margin; north -= step) {
      const ra = Math.round((fa.bounds[3]! - north) / step), rb = Math.round((fb.bounds[3]! - north) / step);
      for (let east = w + margin; east <= e - margin; east += step) {
        const ca = Math.round((east - fa.bounds[0]!) / step), cb = Math.round((east - fb.bounds[0]!) / step);
        compared++;
        if (ga.data[ra * ga.width + ca] === gb.data[rb * gb.width + cb]) continue;
        differ++;
        nearestEdge = Math.min(nearestEdge, east - w, e - east, north - s, n - north);
      }
    }
    return { layer, compared, differ, nearestEdge };
  });
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const opt = (flag: string): string | undefined => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const folders = args.filter((x, k) => !x.startsWith("--") && !args[k - 1]?.startsWith("--"));
  if (folders.length !== 2) {
    console.error("bun tools/maps/diff-layers.ts <work folder a> <work folder b> [--margin 600] [--layers height,biome,…]");
    process.exit(2);
  }
  const both = (f: string): string[] => readdirSync(join(f, "base")).filter((x) => x.endsWith(".png") && !x.endsWith("_fine.png")).map((x) => x.slice(0, -4));
  const names = opt("--layers")?.split(",") ?? both(folders[0]!).filter((x) => existsSync(join(folders[1]!, "base", `${x}.png`)));
  const rows = diffLayers(folders[0]!, folders[1]!, names, Number(opt("--margin") ?? 600));
  for (const r of rows) console.log(`${r.layer}: ${r.differ} of ${r.compared} samples differ${r.differ ? `, the nearest ${r.nearestEdge} m inside the edge` : ""}`);
  process.exit(rows.every((r) => r.differ === 0) ? 0 : 1);
}
