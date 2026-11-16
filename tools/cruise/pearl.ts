// Manual bounded Pearl geometry audit: bun tools/cruise/pearl.ts [source-directory] [report.json].
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { surfaceError } from "../pack/error.ts";
import type { SourceLod } from "../pack/write.ts";

type RawLod = { positions: number[]; indices: number[] };
type Row = { cell: string; authoredLevel: number; triangles: number; badEdges: number; signedVolume: number; fine: RawLod; coarse: RawLod };
const root = resolve(import.meta.dir, "../.."), source = resolve(process.argv[2] ?? join(root, "assets/source/landmarks/cruise"));
const out = resolve(process.argv[3] ?? join(root, "var/cruise-preview/pearl.json"));
const dir = mkdtempSync(join(tmpdir(), "snark-pearl-"));
try {
  const raw = join(dir, "geometry.json"), helper = join(root, "assets/source/landmarks/cruise/model_far_pearl.py");
  const run = Bun.spawnSync([process.env.BLENDER ?? "blender", "--background", "--factory-startup", "--disable-autoexec", "--python-exit-code", "1",
    "--python", join(import.meta.dir, "pearl.py"), "--", source, helper, raw], { stdout: "pipe", stderr: "pipe" });
  if (run.exitCode !== 0) throw new Error(new TextDecoder().decode(run.stdout) + new TextDecoder().decode(run.stderr));
  const data = JSON.parse(readFileSync(raw, "utf8")) as { sources: Record<string, string>; rows: Row[] };
  const lod = (v: RawLod): SourceLod => ({ positions: Float32Array.from(v.positions), colors: new Uint8Array(v.positions.length / 3), indices: Uint32Array.from(v.indices) });
  const rows = data.rows.map(({ fine, coarse, ...row }) => ({ ...row, p95SurfaceError: surfaceError(lod(fine), lod(coarse)) }));
  const report = { scope: "Pearl only; actual fine source solids and fitted candidates 4/5, clipped independently to authored 16 m cells and Blender-triangulated. Native bidirectional surfaceError samples all corners and triangle centroids at P95. Does not certify the surrounding cell triangle budget or a final packed artifact.",
    sources: data.sources, portal: "64 rays at authored portal radius minus 3 mm, after simulated signed 16-bit cell quantization; both stages clear.", rows };
  mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  if (rows.length !== 8 || rows.some(row => row.p95SurfaceError > .13 || row.triangles > 220 || row.badEdges || row.signedVolume <= 0)) throw new Error(`Pearl diagnostic failed; see ${out}`);
  console.log(JSON.stringify({ out, cells: rows.length / 2, maxTriangles: Math.max(...rows.map(row => row.triangles)), maxP95: Math.max(...rows.map(row => row.p95SurfaceError)) }));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
