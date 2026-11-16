// Manual bounded replay. Add --capacity only when the final fixture placement is authored.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { surfaceError } from "../pack/error.ts";
import type { SourceLod } from "../pack/write.ts";

type Raw = { positions: number[]; indices: number[] };
type Cell = { id: string; triangles: number[]; retained: number[] };
const root = resolve(import.meta.dir, "../.."), source = resolve(process.argv[2] ?? join(root, "assets/source/landmarks/cruise"));
const out = resolve(process.argv[3] ?? join(root, "var/cruise-preview/aquatheater"));
mkdirSync(out, { recursive: true });
const helper = join(root, "assets/source/landmarks/cruise/model_far_aquatheater.py");
const run = Bun.spawnSync([process.env.BLENDER ?? "blender", "--background", "--factory-startup", "--disable-autoexec", "--python-exit-code", "1",
  "--python", join(import.meta.dir, "aquatheater.py"), "--", source, helper, out, "--visibility"], { stdout: "pipe", stderr: "pipe" });
writeFileSync(join(out, "replay.log"), Buffer.concat([run.stdout, run.stderr]));
if (run.exitCode !== 0) throw new Error(`AquaTheater Blender replay failed; see ${out}/replay.log`);
const data = JSON.parse(readFileSync(join(out, "forms.json"), "utf8")) as { sources: Record<string, string>; forms: Record<string, Record<string, Raw>> };
const lod = (r: Raw): SourceLod => ({ positions: Float32Array.from(r.positions), indices: Uint32Array.from(r.indices), colors: new Uint8Array(r.positions.length / 3) });
const rows = Object.entries(data.forms).flatMap(([fixture, stages]) => [2, 3, 4, 5].map(stage => {
  const error = surfaceError(lod(stages["0"]!), lod(stages[String(stage)]!));
  const visibleCertificate = fixture.startsWith("aquadome_pod") && stage === 3;
  const threshold = [0, .0125, .025, .06, .13, .25][stage]!;
  return { fixture, stage, triangles: stages[String(stage)]!.indices.length / 3, wholeObjectP95: error, quantizationReserve: .0005, threshold,
    test: visibleCertificate ? "See placement-bound visible certificate" : "Native whole-object P95 plus0.5mm reserve", pass: visibleCertificate || error + .0005 <= threshold };
}));
const cells = (JSON.parse(readFileSync(join(out, "diagnostic-report.json"), "utf8")) as { cells: Cell[] }).cells;
const budgets = [4000, 1250, 300, 300];
const capacity = cells.map(c => ({ cell: c.id, triangles: c.triangles, pass: c.triangles.every((n, i) => n <= budgets[i]!) }));
const visibility = JSON.parse(readFileSync(join(out, "visibility.json"), "utf8")) as { layoutSHA256: string; rows: { directions: Record<string, { sampledVisibleP95Pass: boolean }> }[] };
if (visibility.layoutSHA256 !== data.sources.layout) throw new Error("Visibility/layout identity mismatch");
const geometryPass = rows.every(r => r.pass) && visibility.rows.length === 6 && visibility.rows.every(r => Object.values(r.directions).every(d => d.sampledVisibleP95Pass));
const capacityPass = capacity.every(c => c.pass);
const report = { scope: "Original native source forms0/1 unchanged. Exact helper2..5, authored bounds, native bidirectional whole-object surfaceError plus0.5mm cell quantization reserve. Stage3 pod uses the separate finite exterior-visible certificate. Capacity is the complete affected16m cells with current ship surroundings; final normal export/artcheck and native visual review remain required.", sources: data.sources, geometryPass, capacityPass, rows, capacity, visibility };
writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
if (!geometryPass || (process.argv.includes("--capacity") && !capacityPass)) throw new Error(`AquaTheater gate failed; see ${out}/report.json`);
console.log(JSON.stringify({ out, geometryPass, capacityPass, peaks: budgets.map((_, i) => Math.max(...capacity.map(c => c.triangles[i]!))) }));
