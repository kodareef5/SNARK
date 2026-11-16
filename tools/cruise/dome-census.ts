// Manual enumeration before dome-error.ts: discover every affected cell, not a hand-picked subset.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parsePack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { surfaceError } from "../pack/error.ts";
import { buildPack, unpackMeshes, type SourceLod } from "../pack/write.ts";

type Level = { level: number; authoredLevel: number; file: string; clearFile: string; triangles: number };
type Cell = { id: string; origin: number[]; levels: Level[] };
type Layout = { prototypes: { id: string; art: { kind: string } }[]; instances: { id: string; prototype: string }[]; cells: { id: string; members: { prototype: string }[] }[] };
const root = resolve(import.meta.dir, "../.."), options = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i]!, value = process.argv[i + 1];
  if (!["--raw", "--layout", "--out"].includes(key) || !value) throw new Error("usage: bun tools/cruise/dome-census.ts --raw DIR --layout FILE --out FILE");
  options.set(key, value);
}
const raw = resolve(options.get("--raw") ?? join(root, "assets/source/landmarks/cruise/ref/raw-cells"));
const layoutFile = resolve(options.get("--layout") ?? join(root, "content/landmarks/cruise-layout.json"));
const out = resolve(options.get("--out") ?? join(root, "var/cruise-preview/dome-census.json"));
const hash = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const indexBytes = readFileSync(join(raw, "index.json")), layoutBytes = readFileSync(layoutFile);
const index = JSON.parse(indexBytes.toString()) as { layoutSHA256: string; meshes: Cell[] }, layout = JSON.parse(layoutBytes.toString()) as Layout;
if (index.layoutSHA256 !== hash(layoutBytes)) throw new Error("Raw census belongs to another layout");
const kinds = new Set(layout.prototypes.filter(p => p.art.kind === "dome_dense").map(p => p.id));
const owners = new Set(layout.instances.flatMap((i, owner) => kinds.has(i.prototype) ? [owner] : []));
const declared = new Set(layout.cells.filter(c => c.members.some(m => kinds.has(m.prototype))).map(c => c.id));
if (!declared.size || declared.size > index.meshes.length) throw new Error("No coherent dome cell membership");
const ordered = createHash("sha256"), rows = [];
for (const cell of index.meshes.filter(c => declared.has(c.id))) {
  const lods: SourceLod[] = [], counts: number[] = [], domeFaces: number[][] = [];
  for (const level of cell.levels) {
    const bytes = readFileSync(join(raw, level.file)), clear = readFileSync(join(raw, level.clearFile));
    if (bytes.length !== level.triangles * 40 || clear.length !== level.triangles) throw new Error(`Invalid raw records: ${level.file}`);
    ordered.update(level.file).update(bytes).update(level.clearFile).update(clear);
    const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), positions = new Float32Array(level.triangles * 9);
    const faces: number[] = [];
    for (let t = 0; t < level.triangles; t++) {
      if (owners.has(data.getUint32(t * 40, true))) faces.push(t);
      for (let k = 0; k < 9; k++) {
        const v = data.getFloat32(t * 40 + 4 + k * 4, true);
        if (!Number.isFinite(v)) throw new Error(`Non-finite raw coordinate: ${level.file}`);
        positions[t * 9 + k] = v;
      }
    }
    counts.push(faces.length); domeFaces.push(faces);
    lods.push({ positions, indices: Uint32Array.from({ length: level.triangles * 3 }, (_, i) => i), colors: new Uint8Array(level.triangles * 3), error: 0 });
  }
  const at = cell.levels.findLastIndex(l => l.authoredLevel <= 3);
  if (at < 0 || cell.levels[0]?.authoredLevel !== 0) throw new Error(`${cell.id}: no near/middle representation`);
  const packed = parsePack(buildPack([{ id: cell.id, lods }], defaultPalette())), native = unpackMeshes(packed)[0]!;
  const p95 = surfaceError(native.lods[0]!, native.lods[at]!);
  // Subset only after native quantization, so owner-only error uses exactly the
  // same shared bounds as the delivered cell rather than tighter dome bounds.
  const dome = (level: number): SourceLod => {
    const lod = native.lods[level]!;
    if (!lod.indices.every((v, n) => v === n)) throw new Error("Native conversion changed triangle ownership order");
    const positions = new Float32Array(domeFaces[level]!.length * 9);
    domeFaces[level]!.forEach((face, i) => positions.set(lod.positions.subarray(face * 9, face * 9 + 9), i * 9));
    return { positions, indices: Uint32Array.from({ length: positions.length / 3 }, (_, i) => i), colors: new Uint8Array(positions.length / 3) };
  };
  const missingDomeRepresentation = !!counts[0] !== !!counts[at];
  const domeP95 = counts[0] && counts[at] ? surfaceError(dome(0), dome(at)) : null;
  rows.push({ cell: cell.id, origin: cell.origin, retainedStages: cell.levels.map(l => l.authoredLevel), stage3NativeLevel: at,
    nearDomeTriangles: counts[0]!, middleDomeTriangles: counts[at]!, wholeCellNativeP95: p95, domeOwnerNativeP95: domeP95,
    missingDomeRepresentation, nativeHalf: packed.header.meshes[0]!.half,
    requiresVisibleCertificate: !!(counts[0] || counts[at]) && (p95 > .06 || missingDomeRepresentation || (domeP95 ?? 0) > .06) });
}
if (rows.length !== declared.size || hash(readFileSync(join(raw, "index.json"))) !== hash(indexBytes)) throw new Error("Missing dome cells or changed raw snapshot");
const cells = rows.filter(r => r.requiresVisibleCertificate).map(r => r.cell);
const report = { scope: "Every declared dome_dense cell, with actual raw dome triangle ownership counted independently. All retained positions determine the shared bounds of a real serialized native pack. Whole-cell and dome-owner-only stage0-to-stage3 bidirectional P95 use those same quantized positions, including caps and clear faces. Either metric exceeding .06, or a missing dome representation, selects a cell for the separate finite clear-aware dome-only visible certificate. This enumeration is not a visible-error or final export acceptance claim.",
  layoutSHA256: index.layoutSHA256, rawIndexSHA256: hash(indexBytes), measuredRawAndClearSHA256: ordered.digest("hex"),
  toolSHA256: hash(readFileSync(import.meta.filename)), nativeSources: Object.fromEntries(["tools/pack/write.ts", "tools/pack/error.ts"].map(p => [p, hash(readFileSync(join(root, p)))])),
  declaredCells: declared.size, actualDomeCells: rows.filter(r => r.nearDomeTriangles || r.middleDomeTriangles).length, threshold: .06, selectedCells: cells, rows };
mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ out, declaredCells: declared.size, selectedCells: cells, argument: cells.join(",") }));
