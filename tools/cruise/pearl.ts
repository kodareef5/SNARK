// Manual bounded Pearl geometry audit: bun tools/cruise/pearl.ts [source-directory] [report.json].
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parsePack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { measureSurface } from "../art/check.ts";
import { surfaceError } from "../pack/error.ts";
import { buildPack, unpackMeshes, type SourceLod } from "../pack/write.ts";

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
  const data = JSON.parse(readFileSync(raw, "utf8")) as { sources: Record<string, string>; rows: Row[];
    exterior: { authoredLevel: number; fine: RawLod; coarse: RawLod }[]; pairedInternalCaps: number };
  const lod = (v: RawLod): SourceLod => ({ positions: Float32Array.from(v.positions), colors: new Uint8Array(v.positions.length / 3), indices: Uint32Array.from(v.indices) });
  const rows = data.rows.map(({ fine, coarse, ...row }) => {
    const native = unpackMeshes(parsePack(buildPack([{ id: row.cell, lods: [lod(fine), lod(coarse)] }], defaultPalette())))[0]!;
    return { ...row, p95SurfaceError: surfaceError(native.lods[0]!, native.lods[1]!), nativeTopology: measureSurface(native.lods[1]!) };
  });
  const exterior = data.exterior.map(({ fine, coarse, authoredLevel }) => {
    const native = unpackMeshes(parsePack(buildPack([{ id: "cruise:pearl-exterior", lods: [lod(fine), lod(coarse)] }], defaultPalette())))[0]!;
    return { authoredLevel, p95SurfaceError: surfaceError(native.lods[0]!, native.lods[1]!) };
  });
  const report = { scope: "Pearl only; actual fine source solids and fitted candidates 3/4/5, clipped independently to authored 16 m cells, Blender-triangulated and serialized through the native geometry format. Bidirectional surfaceError samples all corners and triangle centroids at P95. Does not certify the surrounding cell triangle budget or a final packed artifact.",
    sources: data.sources, portal: "64 rays at authored portal radius minus 3 mm, after simulated signed 16-bit cell quantization; all three stages clear.",
    exteriorScope: "Whole inner/outer shell including both portal rims; only radial sector caps with proven adjoining sectors are excluded. Whole-shell native quantization is supplemented by 0.5 mm error reserve for the independently quantized cells. Per-cell cap-inclusive distances remain in rows.",
    pairedInternalCaps: data.pairedInternalCaps, exterior, rows };
  mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  if (rows.length !== 12 || rows.some(row => !Number.isFinite(row.p95SurfaceError) || row.authoredLevel >= 4 && row.p95SurfaceError > .13 ||
    row.triangles > (row.authoredLevel === 3 ? 1150 : 220) || row.badEdges || row.signedVolume <= 0 ||
    row.nativeTopology.holes || row.nativeTopology.flipped || row.nativeTopology.insideOut || row.nativeTopology.collapsed)) throw new Error(`Pearl diagnostic failed; see ${out}`);
  if (exterior.length !== 3 || exterior.some(row => !Number.isFinite(row.p95SurfaceError) ||
    row.p95SurfaceError + .0005 > (row.authoredLevel === 3 ? .06 : .13))) throw new Error(`Pearl exterior diagnostic failed; see ${out}`);
  console.log(JSON.stringify({ out, cells: rows.length / 3, exterior, rows }));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
