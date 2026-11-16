/** Measure reused rails with the exact native placement frame, independently of the Python author. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { frameAxes, HALF_SIDE } from "../../../../../shared/world/frame.ts";

type Point = readonly number[];
interface Layout {
  prototypes: { id: string; art: { ends: Point[] } }[];
  instances: { id: string; prototype: string; at: Point; yaw: number }[];
  guardRuns: { id: string; a: Point; b: Point; instances: string[]; reused: boolean }[];
}
const source = readFileSync(new URL("../../../../../content/landmarks/cruise-layout.json", import.meta.url));
const layout = JSON.parse(source.toString()) as Layout;
const prototypes = new Map(layout.prototypes.map(p => [p.id, p]));
const instances = new Map(layout.instances.map(i => [i.id, i]));
const axes = new Int32Array(4);
let lateral = 0, endpoint = 0, gap = 0, extension = 0, panels = 0;
let witness: { run: string; instance: string; point: number[] } | undefined;
for (const run of layout.guardRuns) {
  if (!run.reused) continue;
  const a = run.a, b = run.b, dx = b[0]! - a[0]!, dz = b[2]! - a[2]!;
  const length = Math.hypot(dx, dz), ux = dx / length, uz = dz / length;
  const points: number[][] = [], ranges: number[][] = [];
  for (const id of run.instances) {
    const instance = instances.get(id)!, prototype = prototypes.get(instance.prototype)!;
    frameAxes(Math.round(instance.yaw * 65536 / 360) & 65535, axes);
    const cx = Math.round(instance.at[0]! * 512) / 512, cz = Math.round(instance.at[2]! * 512) / 512;
    const pair = prototype.art.ends.map(v => [cx + (axes[0]! * v[0]! + axes[2]! * v[2]!) / HALF_SIDE,
      cz + (axes[1]! * v[0]! + axes[3]! * v[2]!) / HALF_SIDE]);
    points.push(...pair);
    const projected: number[] = [];
    for (const point of pair) {
      const x = point[0]! - a[0]!, z = point[1]! - a[2]!, side = Math.abs(x * uz - z * ux);
      if (side > lateral) { lateral = side; witness = { run: run.id, instance: id, point }; }
      projected.push(x * ux + z * uz);
    }
    ranges.push([Math.min(...projected), Math.max(...projected)]); panels++;
  }
  endpoint = Math.max(endpoint, ...[a, b].map(q => Math.min(...points.map(p => Math.hypot(q[0]! - p[0]!, q[2]! - p[1]!)))));
  ranges.sort((a, b) => a[0]! - b[0]!);
  let end = 0;
  for (const range of ranges) { gap = Math.max(gap, range[0]! - end); end = Math.max(end, range[1]!); }
  gap = Math.max(gap, length - end);
  extension = Math.max(extension, -ranges[0]![0]!, end - length);
}
const report = {
  layoutSha256: createHash("sha256").update(source).digest("hex"),
  scope: "XZ rail endpoints under real native frameAxes and 1/512 origins; packed vertex quantization is reserved separately. This does not replace native route-width, body or rendered-join review.",
  logicalRuns: layout.guardRuns.length, reusedPanels: panels,
  maxLateralMetres: lateral, maxEndpointDistanceMetres: endpoint,
  maxAlongGapMetres: gap, maxAlongExtensionMetres: extension,
  packedVertexReserveMetres: .003, tubeRadiusMetres: .025, witness,
};
if (Math.max(lateral, endpoint, gap) + .003 > .025 || extension > .003) throw new Error(JSON.stringify(report));
writeFileSync(new URL("ref/guard-reuse.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
