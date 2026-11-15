import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export interface Cell {
  id: string; row: number; col: number; east: [number, number]; north: [number, number]; footprints: number;
  largest: { key: string; id: number; lat: number; lon: number; area_m2: number }[];
}
export interface Place {
  name: string; category: string; kind: string; footprint: string | null; lat: number | null; lon: number | null;
  storeys: number; height_m: number; built: number; style: string; materials: string[]; features: string[];
  fame: string; confidence: string; estimated: string[]; lore: string; play: string;
}
export interface Survey {
  district: string; summary: string; character: string[]; shore: string | null; play: string;
  typical: { kind: string; storeys_low: number; storeys_high: number; era: string; style: string; materials: string[]; notes: string };
  places: Place[]; sources: string[];
}
export interface Label { cell: string; district: string; place: Place; footprintId: number | null; }
export interface SurveyData {
  cells: Cell[]; squares: Map<string, Survey>; labels: Label[]; warnings: string[]; fingerprint: string;
}
const read = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const count = (xs: string[]): Record<string, number> => Object.fromEntries([...new Set(xs)].sort().map((x) => [x, xs.filter((a) => a === x).length]));

export function readSurvey(folder: string): SurveyData {
  const cells = existsSync(join(folder, "cells.json")) ? read(join(folder, "cells.json")) as Cell[] : [];
  const squares = new Map<string, Survey>();
  const labels: Label[] = [];
  const warnings: string[] = [];
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(JSON.stringify(cells));
  for (const cell of [...cells].sort((a, b) => a.id.localeCompare(b.id))) {
    const path = join(folder, "out", `${cell.id}.json`);
    if (!existsSync(path)) continue;
    try {
      const row = read(path) as { survey?: Survey } & Survey;
      const s = row.survey ?? row;
      if (typeof s.district !== "string" || !Array.isArray(s.places) || !s.typical || !Array.isArray(s.character)) throw new Error("incomplete survey");
      for (const p of s.places) {
        if (typeof p.name !== "string" || typeof p.category !== "string" || !Number.isFinite(p.height_m) || !Number.isFinite(p.storeys) || !Array.isArray(p.materials) || !Array.isArray(p.estimated)) throw new Error("incomplete place");
      }
      squares.set(cell.id, s);
      hasher.update(cell.id + JSON.stringify(s));
      for (const p of s.places) {
        const letter = p.footprint?.trim().toUpperCase();
        const f = cell.largest.find((b) => b.key === letter);
        labels.push({ cell: cell.id, district: s.district, place: p, footprintId: f?.id ?? null });
        if (letter && !f) warnings.push(`${cell.id}: ${p.name}: unknown footprint ${letter}`);
      }
    } catch (error) {
      warnings.push(`${cell.id}: skipped: ${String(error)}`);
    }
  }
  return { cells, squares, labels, warnings, fingerprint: hasher.digest("hex") };
}

export function surveyInventory(data: SurveyData): Record<string, unknown> {
  const groups = new Map<number, Label[]>();
  for (const l of data.labels) if (l.footprintId !== null) groups.set(l.footprintId, [...(groups.get(l.footprintId) ?? []), l]);
  return {
    fingerprint: data.fingerprint, squares: data.cells.length, available: data.squares.size,
    pending: data.cells.filter((c) => !data.squares.has(c.id)).map((c) => c.id).sort(),
    categories: count(data.labels.map((l) => l.place.category)), districts: count([...data.squares.values()].map((s) => s.district)),
    placesByDistrict: count(data.labels.map((l) => l.district)),
    footprintClaims: data.labels.filter((l) => l.footprintId !== null).length, uniqueFootprintsClaimed: groups.size,
    estimatedFootprintClaims: data.labels.filter((l) => l.footprintId !== null && l.place.estimated.includes("footprint")).length,
    conflicts: [...groups].filter(([, ls]) => ls.length > 1).map(([id, ls]) => ({ id, places: ls.map((l) => l.place.name) })),
    famous: data.labels.filter((l) => l.place.fame === "world" || l.place.fame === "city").map((l) => ({ name: l.place.name, category: l.place.category, square: l.cell, footprint: l.footprintId, confidence: l.place.confidence, estimated: l.place.estimated })),
    styles: count(data.labels.map((l) => l.place.style)), materials: count(data.labels.flatMap((l) => l.place.materials)),
    character: count([...data.squares.values()].flatMap((s) => s.character)), warnings: data.warnings,
  };
}

// Import complete squares only. A growing or interrupted source never replaces a good local square with partial JSON.
export function importSurvey(from: string, to: string): void {
  const data = readSurvey(from);
  if (data.cells.length === 0) throw new Error(`No cells.json in ${from}`);
  mkdirSync(join(to, "out"), { recursive: true });
  const put = (file: string, value: unknown): void => {
    const path = join(to, file);
    writeFileSync(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
    renameSync(`${path}.tmp`, path);
  };
  put("cells.json", data.cells);
  if (existsSync(join(from, "schema.json"))) put("schema.json", read(join(from, "schema.json")));
  for (const [id, s] of data.squares) put(`out/${id}.json`, { square: id, survey: s });
  for (const warning of data.warnings) console.warn(warning);
  console.log(`Imported ${data.squares.size}/${data.cells.length} squares; kept ${readdirSync(join(to, "out")).filter((f) => f.endsWith(".json")).length} local squares.`);
}

if (import.meta.main) {
  const source = resolve("assets/source/maps/miami/blocks");
  const args = process.argv.slice(2);
  if (args[0] === "--import") {
    if (!args[1]) throw new Error("--import requires the survey folder");
    importSurvey(resolve(args[1]), source);
  }
  const inventory = surveyInventory(readSurvey(source));
  const out = resolve("assets/source/maps/miami/reports/ruins1/legacy-survey.json");
  mkdirSync(resolve(out, ".."), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ ...inventory, status: "stopped; historical claims only", unavailable: inventory.pending, pending: [] }, null, 2)}\n`);
  console.log(JSON.stringify({ ...inventory, pending: (inventory.pending as string[]).length, famous: (inventory.famous as unknown[]).length, styles: undefined, materials: undefined, character: undefined }, null, 2));
}
