// What the content should name for each plant kind, and what a full chunk of undergrowth costs at each level.
//
//   bun assets/source/core/nodes/plants/facts.ts [--plants 200] [--tier medium]
//
// Boxes: each holds the plant's mass (from the 5th to the 95th hundredth of its level 1's points across, and from the
// ground to the 95th hundredth up), leaving out what lies flat on the ground. Cost: the kinds mixed as dense undergrowth
// has them (ferns 4, palmetto 3, berry bushes 2, creeper 1, sea grape 1), and the distance each level holds on the tier,
// from the stated errors, in a 102 degree view to the tier's reach for bushes.

import { readFileSync } from "node:fs";
import { tierOf } from "../../../../../client/core/assets/tiers.ts";
import { parsePack } from "../../../../../shared/pack/pack.ts";
import { findAssets } from "../../../../../tools/art/assets.ts";
import { SOURCE } from "../../../../../tools/art/source.ts";
import { unpackMeshes } from "../../../../../tools/pack/write.ts";

const args = process.argv.slice(2);
const arg = (name: string, fallback: string): string => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1]! : fallback);
const asset = (await findAssets(SOURCE)).find((a) => a.id === "core:plants")!;
const pack = parsePack(new Uint8Array(readFileSync(asset.file)));
const meshes = unpackMeshes(pack);

const r2 = (n: number): number => Math.round(n * 100) / 100;
const at = (sorted: Float64Array, q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;

function box(id: string): string {
  const mesh = meshes.find((m) => m.id === id)!;
  const p = mesh.lods[Math.min(1, mesh.lods.length - 1)]!.positions;
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  for (let i = 0; i < p.length; i += 3) {
    if (p[i + 1]! < 0.06) continue;
    xs.push(p[i]!);
    ys.push(p[i + 1]!);
    zs.push(p[i + 2]!);
  }
  const sx = Float64Array.from(xs).sort();
  const sy = Float64Array.from(ys).sort();
  const sz = Float64Array.from(zs).sort();
  const [x0, x1, z0, z1, top] = [at(sx, 0.05), at(sx, 0.95), at(sz, 0.05), at(sz, 0.95), at(sy, 0.95)];
  return `{ at: [${r2((x0 + x1) / 2)}, ${r2(top / 2)}, ${r2((z0 + z1) / 2)}], half: [${r2((x1 - x0) / 2)}, ${r2(top / 2)}, ${r2((z1 - z0) / 2)}] }`;
}

const kinds = new Map<string, string[]>();
for (const m of meshes) {
  const name = m.id.slice(5);
  if (name.endsWith("_depleted")) continue;
  const kind = name.replace(/_\d+$/, "");
  kinds.set(kind, [...(kinds.get(kind) ?? []), name]);
}
for (const [kind, names] of kinds) {
  console.log(`core:${kind} variants:`);
  for (const n of names) console.log(`  { mesh: "core:${n}", boxes: [${box(`core:${n}`)}], depleted: { mesh: "core:${n}_depleted", boxes: [${box(`core:${n}_depleted`)}] } },`);
}

// Cost.
const MIX: Record<string, number> = { fern: 4, palmetto: 3, bush: 2, creeper: 1, seagrape: 1 };
const total = Object.values(MIX).reduce((a, b) => a + b, 0);
const plants = Number(arg("plants", "200"));
const tier = tierOf(arg("tier", "medium"));
const levels = Math.max(...meshes.map((m) => m.lods.length));
const tris = (id: string, l: number): number => meshes.find((m) => m.id === id)!.lods[l]!.indices.length / 3;
console.log(`\nTriangles a plant, the mean of each kind's individuals, at each level:`);
const mean: Record<string, number[]> = {};
for (const [kind, names] of kinds) {
  mean[kind] = Array.from({ length: levels }, (_, l) => names.reduce((s, n) => s + tris(`core:${n}`, l), 0) / names.length);
  console.log(`  ${kind.padEnd(9)} ${mean[kind]!.map((t) => String(Math.round(t)).padStart(5)).join("")}`);
}
const perPlant = Array.from({ length: levels }, (_, l) => Object.entries(MIX).reduce((s, [k, w]) => s + (mean[k]?.[l] ?? 0) * w, 0) / total);
console.log(`\nA chunk (64 m square) of ${plants} plants in that mix, every one at one level:`);
console.log(`  ${perPlant.map((t, l) => `level ${l}: ${Math.round(t * plants).toLocaleString("en")} triangles`).join(", ")}`);

// Where each level holds on the tier, from the bush's stated errors: the distance at which its error covers the tier's
// threshold on a 1,080-row screen with a 70 degree view.
const rows = tier.name === "lowpoly" ? 720 : 1080;
const scale = rows / (2 * Math.tan(1.2217 / 2));
const header = pack.header.meshes[pack.meshIndex.get("core:bush_1")!]!;
const from = header.lods.map((l) => (l.error * scale) / tier.threshold);
// The far layer's reach for bushes on each tier; the low setting draws only the chunks a client is sent, about 192 m.
const reach = Number(arg("reach", tier.name === "lowpoly" ? "192" : tier.name === "medium" ? "300" : tier.name === "high" ? "500" : "600"));
const view = 102 / 360;
const density = plants / (64 * 64);
console.log(`\nOn ${tier.name}, in a 102 degree view of such undergrowth to ${reach} m, each level from where it is first drawn:`);
let sum = 0;
for (let l = tier.finest; l < levels; l++) {
  const a = l === tier.finest ? 0 : (from[l] ?? 0);
  const b = l + 1 < levels ? Math.min(from[l + 1]!, reach) : reach;
  if (b <= a) continue;
  const area = view * Math.PI * (b * b - a * a);
  const n = area * density;
  sum += n * perPlant[l]!;
  console.log(`  level ${l}: ${a.toFixed(0)} to ${b.toFixed(0)} m, ${Math.round(n).toLocaleString("en")} plants, ${Math.round(n * perPlant[l]!).toLocaleString("en")} triangles`);
}
console.log(`  in all ${Math.round(sum).toLocaleString("en")} triangles`);
