// Manual authoring evidence, outside the routine native gate. Requires Blender's Python/mathutils.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { buildPack, unpackMeshes, type SourceLod } from "../pack/write.ts";
import { surfaceError } from "../pack/error.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";

interface Level { level: number; authoredLevel: number; file: string; clearFile: string; triangles: number }
interface Cell { id: string; origin: number[]; levels: Level[] }
interface Index { layoutSHA256: string; meshes: Cell[] }
const root = resolve(import.meta.dir, "../.."), options = new Map<string, string>();
const allowed = new Set(["raw", "candidate", "source", "layout", "out", "blender", "cells", "census"]);
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i]!, value = process.argv[i + 1];
  if (!key.startsWith("--") || !allowed.has(key.slice(2)) || !value) throw new Error("usage: bun tools/cruise/dome-error.ts [--raw DIR] [--candidate DIR] [--source DIR] [--layout FILE] [--out FILE] [--blender EXE] [--census FILE | --cells id,id]");
  options.set(key.slice(2), value);
}
const path = (key: string, fallback: string) => resolve(root, options.get(key) ?? fallback);
const raw = path("raw", "assets/source/landmarks/cruise/ref/raw-cells"), candidate = options.has("candidate") ? path("candidate", "") : raw;
const source = path("source", "assets/source/landmarks/cruise"), layout = path("layout", "content/landmarks/cruise-layout.json");
const out = path("out", "var/cruise-preview/dome-error.json");
if (options.has("cells") && options.has("census")) throw new Error("Choose a complete census or an explicit diagnostic subset, not both");
const hash = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const rawBytes = readFileSync(join(raw, "index.json")), candidateBytes = readFileSync(join(candidate, "index.json"));
const rawIndex = JSON.parse(rawBytes.toString()) as Index, index = JSON.parse(candidateBytes.toString()) as Index;
const layoutHash = hash(readFileSync(layout));
if (rawIndex.layoutSHA256 !== layoutHash || index.layoutSHA256 !== layoutHash) throw new Error("Raw/candidate/layout identities differ");
// Complete acceptance consumes the separately reproducible native scan. Explicit
// --cells remains available for a bounded investigation, and is labelled as such.
const censusFile = path("census", "var/cruise-preview/dome-census.json");
const censusBytes = options.has("cells") ? null : readFileSync(censusFile);
const census = censusBytes ? JSON.parse(censusBytes.toString()) as { layoutSHA256: string; rawIndexSHA256: string; threshold: number; declaredCells: number; selectedCells: string[]; rows: { cell: string; requiresVisibleCertificate: boolean }[] } : null;
if (census && (candidate !== raw || census.layoutSHA256 !== layoutHash || census.rawIndexSHA256 !== hash(rawBytes) || census.threshold !== .06 ||
    census.declaredCells !== census.rows.length || JSON.stringify(census.selectedCells) !== JSON.stringify(census.rows.filter(r => r.requiresVisibleCertificate).map(r => r.cell))))
  throw new Error("Dome census does not select the complete measured set for this raw snapshot");
const cells = census ? census.selectedCells : options.get("cells")!.split(",");
const selection = census ? { scope: "Complete native dome-cell census", file: censusFile, sha256: hash(censusBytes!), scannedCells: census.declaredCells, selectedCells: cells } :
  { scope: "Explicit bounded diagnostic subset; not complete dome coverage", selectedCells: cells };
if (!cells.length || new Set(cells).size !== cells.length || cells.some(id => !index.meshes.some(c => c.id === id))) throw new Error("Target cells must be distinct candidate IDs");
mkdirSync(dirname(out), { recursive: true });
const temporary = mkdtempSync(join(dirname(out), "dome-error-native-")), wholeCell: object[] = [], ordered = createHash("sha256");
const overlays = candidate === raw ? index.meshes.filter(c => cells.includes(c.id)) : index.meshes;
for (const cell of overlays) {
  const lods: SourceLod[] = [], owners: Uint32Array[] = [], clearFiles: Uint8Array[] = [];
  for (const level of cell.levels) {
    const bytes = readFileSync(join(candidate, level.file)), clear = readFileSync(join(candidate, level.clearFile));
    if (bytes.length !== level.triangles * 40 || clear.length !== level.triangles) throw new Error(`Raw geometry/material length: ${level.file}`);
    ordered.update(level.file).update(bytes).update(level.clearFile).update(clear);
    const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), positions = new Float32Array(level.triangles * 9), owner = new Uint32Array(level.triangles);
    for (let t = 0; t < level.triangles; t++) {
      owner[t] = data.getUint32(t * 40, true);
      for (let a = 0; a < 9; a++) {
        const v = data.getFloat32(t * 40 + 4 + a * 4, true);
        if (!Number.isFinite(v)) throw new Error(`Nonfinite geometry: ${level.file}`);
        positions[t * 9 + a] = v;
      }
    }
    owners.push(owner); clearFiles.push(clear);
    lods.push({ positions, indices: Uint32Array.from({ length: level.triangles * 3 }, (_, i) => i), colors: new Uint8Array(level.triangles * 3), error: 0 });
  }
  // Every retained position supplies the native shared bounds; placeholder colors make this geometry evidence only.
  const pack = parsePack(buildPack([{ id: cell.id, lods }], defaultPalette())), native = unpackMeshes(pack)[0]!;
  for (let i = 0; i < cell.levels.length; i++) {
    const level = cell.levels[i]!, lod = native.lods[i]!, bytes = new Uint8Array(level.triangles * 40), data = new DataView(bytes.buffer);
    if (!lod.indices.every((v, n) => v === n)) throw new Error("Native conversion changed triangle ownership order");
    for (let t = 0; t < level.triangles; t++) {
      data.setUint32(t * 40, owners[i]![t]!, true);
      for (let a = 0; a < 9; a++) data.setFloat32(t * 40 + 4 + a * 4, lod.positions[t * 9 + a]!, true);
    }
    writeFileSync(join(temporary, level.file), bytes); writeFileSync(join(temporary, level.clearFile), clearFiles[i]!);
  }
  const at = cell.levels.findLastIndex(l => l.authoredLevel <= 3);
  if (at < 0) throw new Error(`${cell.id} has no representation at stage3`);
  wholeCell.push({ cell: cell.id, origin: cell.origin, p95: surfaceError(native.lods[0]!, native.lods[at]!), half: pack.header.meshes[0]!.half });
}
writeFileSync(join(temporary, "index.json"), JSON.stringify({ ...index, meshes: overlays }));
const identities = {
  selection,
  layoutSHA256: layoutHash, rawIndexSHA256: hash(rawBytes), candidateIndexSHA256: hash(candidateBytes), candidateFilesSHA256: ordered.digest("hex"),
  nativeSources: Object.fromEntries(["tools/pack/write.ts", "tools/pack/error.ts", "tools/art/check.ts"].map(p => [p, hash(readFileSync(join(root, p)))])),
  diagnosticSources: Object.fromEntries(["dome-error.ts", "dome-error.py"].map(p => [p, hash(readFileSync(join(import.meta.dir, p)))])),
  modelSourcesObserved: Object.fromEntries(readdirSync(source).filter(p => /^model.*\.py$/.test(p) || p === "parts.py" || p === "asset.ts").sort().map(p => [p, hash(readFileSync(join(source, p)))])),
  modelScope: "Observed source hashes, not a claim the frozen raw was regenerated from current source. Source may have evolved after the frozen census; raw hashes identify the measured geometry.",
};
const config = join(temporary, "config.json"), reportPath = join(temporary, "report.json");
writeFileSync(config, JSON.stringify({ raw, native: temporary, layout, out: reportPath, cells, wholeCell, identities }));
const child = Bun.spawn([options.get("blender") ?? process.env.BLENDER ?? "blender", "--background", "--factory-startup", "--python-exit-code", "1", "--python", join(import.meta.dir, "dome-error.py"), "--", config], { cwd: root, stdout: "inherit", stderr: "inherit" });
if (await child.exited !== 0) throw new Error("Blender diagnostic failed");
if (hash(readFileSync(join(raw, "index.json"))) !== identities.rawIndexSHA256 || hash(readFileSync(join(candidate, "index.json"))) !== identities.candidateIndexSHA256) throw new Error("Raw snapshot changed during diagnostic");
const reportBytes = readFileSync(reportPath), report = JSON.parse(reportBytes.toString());
writeFileSync(out, reportBytes); // A failed new run can never reuse an earlier report as success.
if (report.identities?.candidateFilesSHA256 !== identities.candidateFilesSHA256 || !report.supportsSampledP95) throw new Error("Diagnostic did not establish the sampled P95 bound; inspect the report");
console.log(JSON.stringify({ out, supportsSampledP95: report.supportsSampledP95, bounds: report.bounds, reverse: report.reverse, elapsedSeconds: report.elapsedSeconds }));
