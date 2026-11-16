// Bounded geometry-only native audit: bun tools/cruise/lifeboat.ts [source-directory] [report.json].
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parsePack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { measureSurface } from "../art/check.ts";
import { surfaceError } from "../pack/error.ts";
import { buildPack, unpackMeshes, type SourceLod } from "../pack/write.ts";

type Raw = { positions: number[]; indices: number[] };
type Row = { stage: number; fine: Raw; envelope: Raw; full: Raw };
const root = resolve(import.meta.dir, "../.."), source = resolve(process.argv[2] ?? join(root, "assets/source/landmarks/cruise"));
const out = resolve(process.argv[3] ?? join(root, "var/cruise-preview/lifeboat.json"));
const dir = mkdtempSync(join(tmpdir(), "snark-lifeboat-"));
try {
  const raw = join(dir, "geometry.json"), helper = join(root, "assets/source/landmarks/cruise/model_far_lifeboat.py");
  const run = Bun.spawnSync([process.env.BLENDER ?? "blender", "--background", "--factory-startup", "--disable-autoexec", "--python-exit-code", "1",
    "--python", join(import.meta.dir, "lifeboat.py"), "--", source, helper, raw], { stdout: "pipe", stderr: "pipe" });
  if (run.exitCode !== 0) throw new Error(run.stdout.toString() + run.stderr.toString());
  const data = JSON.parse(readFileSync(raw, "utf8")) as { sources: Record<string, string>; rows: Row[] };
  const lod = (v: Raw): SourceLod => ({ positions: Float32Array.from(v.positions), colors: new Uint8Array(v.positions.length / 3), indices: Uint32Array.from(v.indices), error: 0 });
  const rows = data.rows.map(row => {
    const native = unpackMeshes(parsePack(buildPack([{ id: "cruise:lifeboat-audit", lods: [lod(row.fine), lod(row.envelope), lod(row.full)] }], defaultPalette())))[0]!;
    return { stage: row.stage, triangles: native.lods[2]!.indices.length / 3, p95Envelope: surfaceError(native.lods[0]!, native.lods[1]!), ...measureSurface(native.lods[2]!) };
  });
  const report = { scope: "Actual original lifeboat hull/canopy compared with near stage1 and fitted stages2–5 after ordinary native geometry serialization. Reports full-model topology and triangle count. Narrow fittings are separate from the envelope comparison. Cell clipping, surrounding-cell budgets, material appearance and final packed artifact still require ordinary export/review.", sources: data.sources, rows };
  mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  if (rows.some(row => row.p95Envelope > [0, .0125, .025, .06, .13, .25][row.stage]! || row.holes || row.flipped || row.insideOut || row.collapsed)) throw new Error(`Lifeboat diagnostic failed; see ${out}`);
  console.log(JSON.stringify({ out, rows }));
} finally { rmSync(dir, { recursive: true, force: true }); }
