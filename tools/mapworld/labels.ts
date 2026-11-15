import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Footprint } from "./statics.ts";
import { readSurvey } from "./survey.ts";
import type { Vocabulary } from "./ruin-vocabulary.ts";

export interface BuildingLabel {
  name: string | null; also: string[]; kind: string | null; height_m: number | null; height_from: string | null;
  levels: number | null; address: string | null; use: string; primary_use: string; uses: Record<string, number>;
  area_m2: number; e: number; n: number;
}
/** `facing` is the compass bearing a board's face looks toward, where OpenStreetMap gives its direction. */
export interface PublicPlace { name: string | null; kind: string; e: number; n: number; in_footprint: number | null; facing?: number; }
export interface Research {
  style?: string; era?: string; materials?: string[]; built?: number; character?: string[]; lore?: string; fame?: string;
  features?: string[]; ruin?: string; estimated?: string[]; sources?: string[];
}
export interface Facts {
  label: BuildingLabel; kind: string; height: number; kindFrom: string; heightFrom: string; neighbours: number[];
  research?: Research; researchFrom?: string;
}
export interface LabelData {
  labels: Record<string, BuildingLabel>; places: PublicPlace[]; research: Map<number, Research>;
  researchFrom: Map<number, string>; fingerprint: string; enrichment: { name: string; ids: number[]; status: string }[];
}
const read = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const key = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, "");
export const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

export function readLabels(source: string): LabelData {
  const folder = join(source, "blocks");
  const labels = read(join(folder, "labels.json")) as Record<string, BuildingLabel>;
  const places = read(join(folder, "places.json")) as PublicPlace[];
  for (const [id, l] of Object.entries(labels)) {
    if (!/^\d+$/.test(id) || !Array.isArray(l.also) || !Number.isFinite(l.e) || !Number.isFinite(l.n) || (!Number.isFinite(l.area_m2) || l.area_m2 < 0)) throw new Error(`Invalid direct label ${id}`);
  }
  for (const p of places) if (!Number.isFinite(p.e) || !Number.isFinite(p.n) || typeof p.kind !== "string") throw new Error("Invalid positioned place");
  const research = new Map<number, Research>(); const researchFrom = new Map<number, string>();
  const names = new Map<string, Set<number>>();
  for (const [id, l] of Object.entries(labels)) for (const name of [l.name, ...l.also]) {
    if (name) { const k = key(name); if (!names.has(k)) names.set(k, new Set()); names.get(k)!.add(Number(id)); }
  }
  const survey = readSurvey(folder);
  const enrichment: LabelData["enrichment"] = [];
  for (const old of survey.labels) {
    const ids = [...(names.get(key(old.place.name)) ?? [])];
    const status = ids.length === 1 ? "name matched" : ids.length === 0 ? "name absent" : "ambiguous name";
    enrichment.push({ name: old.place.name, ids, status });
    if (ids.length !== 1 || research.has(ids[0]!)) continue;
    const p = old.place;
    // No old letter, position, category, height, storeys or neighbourhood guess enters the generator.
    research.set(ids[0]!, { style: p.style, materials: p.materials, built: p.built, lore: p.lore, fame: p.fame, estimated: p.estimated, sources: survey.squares.get(old.cell)?.sources });
    researchFrom.set(ids[0]!, `legacy name match ${old.cell}`);
  }
  const path = join(folder, "research.json");
  const incoming = existsSync(path) ? read(path) as Record<string, Research> : {};
  for (const [id, r] of Object.entries(incoming)) {
    if (!labels[id]) throw new Error(`Research has no direct footprint label: ${id}`);
    research.set(Number(id), { ...research.get(Number(id)), ...r }); researchFrom.set(Number(id), "footprint research");
  }
  const h = new Bun.CryptoHasher("sha256");
  h.update(JSON.stringify(labels)); h.update(JSON.stringify(places)); h.update(JSON.stringify([...research]));
  return { labels, places, research, researchFrom, fingerprint: h.digest("hex"), enrichment };
}

export function resolveLabels(primary: Map<number, Footprint>, data: LabelData, v: Vocabulary): Map<number, Facts> {
  const bins = new Map<string, number[]>();
  const cell = (e: number, n: number): string => `${Math.floor(e / 256)},${Math.floor(n / 256)}`;
  for (const [id, l] of Object.entries(data.labels)) {
    const k = cell(l.e, l.n); if (!bins.has(k)) bins.set(k, []); bins.get(k)!.push(Number(id));
  }
  const result = new Map<number, Facts>();
  for (const [id, f] of [...primary].sort((a, b) => a[0] - b[0])) {
    const b = f.building;
    const l = data.labels[id] ?? { name: null, also: [], kind: null, height_m: null, height_from: null, levels: null, address: null, uses: {}, use: b.use ?? "", primary_use: "", area_m2: b.area, e: b.e, n: b.n };
    const neighbours: { id: number; label: BuildingLabel; distance: number }[] = [];
    const c = Math.floor(l.e / 256); const r = Math.floor(l.n / 256);
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) for (const nid of bins.get(`${c + dx},${r + dz}`) ?? []) {
      if (nid === id || primary.get(nid)?.district?.name !== f.district?.name) continue;
      const other = data.labels[nid]!; const distance = Math.hypot(other.e - l.e, other.n - l.n);
      if (distance <= 500 && other.area_m2 / Math.max(1, l.area_m2) >= .25 && other.area_m2 / Math.max(1, l.area_m2) <= 4) neighbours.push({ id: nid, label: other, distance });
    }
    neighbours.sort((a, b) => a.distance - b.distance || a.id - b.id);
    let kind = l.kind; let kindFrom = "label"; const used: number[] = [];
    if (!kind) {
      const near = neighbours.filter((n) => n.label.kind && n.distance <= 300).slice(0, 5);
      if (near.length) {
        const weights = new Map<string, number>();
        for (const n of near) { weights.set(n.label.kind!, (weights.get(n.label.kind!) ?? 0) + 1 / Math.max(20, n.distance)); used.push(n.id); }
        kind = [...weights].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0]; kindFrom = "neighbours";
      } else {
        const district = v.districts[f.district?.name ?? ""] ?? v.districts.default!;
        const use = `${l.use} ${l.primary_use}`.toLowerCase();
        kind = /industrial|warehouse/.test(use) ? "warehouse" : /education/.test(use) ? "school" : /government/.test(use) ? "government" :
          positive(l.height_m) && l.height_m > 32 ? "tower" : l.area_m2 < 320 ? "house" : l.area_m2 > 7000 ? (district.fallback === "shed" ? "warehouse" : "shopping_mall") :
          district.fallback === "hotel" ? "hotel" : district.fallback === "shed" ? "warehouse" : "apartment_block";
        kindFrom = "district area use";
      }
    }
    let height = l.height_m; let heightFrom = l.height_from ?? "label";
    if (!positive(height)) {
      if (positive(l.levels)) { height = l.levels * 3.5; heightFrom = "levels"; }
      else {
        const recipe = v.categories[kind] ?? "fabric";
        const near = neighbours.filter((n) => positive(n.label.height_m) && (v.categories[n.label.kind ?? ""] ?? "fabric") === recipe).slice(0, 7);
        if (near.length) {
          const heights = near.map((n) => n.label.height_m!).sort((a, b) => a - b); height = heights[Math.floor(heights.length / 2)]!;
          heightFrom = "neighbours"; used.push(...near.map((n) => n.id));
        } else { height = v.recipes[recipe]!.height || 4; heightFrom = "recipe district area"; }
      }
    }
    result.set(id, { label: l, kind, height, kindFrom, heightFrom, neighbours: [...new Set(used)], research: data.research.get(id), researchFrom: data.researchFrom.get(id) });
  }
  return result;
}

if (import.meta.main) {
  const from = process.argv[2]; if (!from) throw new Error("bun tools/mapworld/labels.ts <blocks folder>");
  const to = resolve(process.argv[3] ?? (() => { throw new Error("Destination blocks folder required"); })()); mkdirSync(to, { recursive: true });
  for (const file of ["labels.json", "places.json"]) { const value = read(join(from, file)); writeFileSync(join(to, file), `${JSON.stringify(value, null, 2)}\n`); }
  const data = readLabels(resolve(to, ".."));
  console.log(`${Object.keys(data.labels).length} footprint labels, ${data.places.length} positioned places, ${data.research.size} name-matched research records`);
}
