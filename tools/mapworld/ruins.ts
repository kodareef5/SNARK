import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RUIN_SHAPES, type RuinFinish, type RuinShape } from "../../content/miami-ruins.ts";
import { readLabels, resolveLabels, type Facts, type PublicPlace } from "./labels.ts";
import { S } from "./ground.ts";
import { frameOf, Mason, tilesOf, worldPoint, type Frame } from "./ruin-geometry.ts";
import { layout } from "./ruin-layouts.ts";
import { ruleFor, vocabulary, type Rule } from "./ruin-vocabulary.ts";
import { hash3 } from "./raster.ts";
import { readSurvey, surveyInventory } from "./survey.ts";
import type { Footprint, Site, StaticLayer, StaticPiece } from "./statics.ts";

interface NamedPlace { id: string; name: string; footprint: number; layout: string; recipe: string; retain: number; finish: RuinFinish; note: string; source: string; }
interface Planned { f: Footprint; frame: Frame; rule: Rule; named?: NamedPlace; square: string; facts: Facts; }
export interface RuinRecord {
  footprint: number; part: number; name: string | null; district: string; square: string; recipe: string; special: string | null;
  x: number; y: number; z: number; yaw: number; width: number; depth: number; height: number; blocks: number; detail: number;
  kind: string; sourceHeight: number; heightFrom: string; kindFrom: string; researchFrom: string | null; routes: Mason["routes"]; provisional: boolean; modifiers: string[]; lore: string | null;
}
const digest = (pieces: readonly StaticPiece[]): string => {
  const h = new Bun.CryptoHasher("sha256");
  for (const p of pieces) h.update(`${p.kind},${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)},${p.yaw.toFixed(4)}\n`);
  return h.digest("hex");
};

export function makeRuins(site: Site): StaticPiece[] {
  if (site.world.heaps !== false) return [];
  const v = vocabulary(site.source);
  const data = readLabels(site.source);
  const named = JSON.parse(readFileSync(join(site.source, "ruins/places.json"), "utf8")) as NamedPlace[];
  const size = (site.ground.n - 1) * 2; const chunks = size / 64;
  const frames = new Map(site.footprints.map((f) => [f.building.id, frameOf(f, site)]));
  const ownerIndex = new Map(site.footprints.map((f, i) => [f.building.id, i]));
  const primary = new Map<number, Footprint>();
  for (const f of site.footprints) {
    const id = Math.floor(f.building.id / 4);
    if ((primary.get(id)?.building.area ?? 0) < f.building.area) primary.set(id, f);
  }
  const facts = resolveLabels(primary, data, v);
  const planned: Planned[] = site.footprints.map((f) => {
    const id = Math.floor(f.building.id / 4); const b = f.building;
    const square = `r${String(Math.min(31, Math.max(0, Math.floor((size / 2 - b.n) / 254)))).padStart(2, "0")}c${String(Math.min(31, Math.max(0, Math.floor((b.e + size / 2) / 254)))).padStart(2, "0")}`;
    const n = primary.get(id) === f ? named.find((p) => p.footprint === id) : undefined;
    const resolved = facts.get(id)!;
    let rule = ruleFor(f, v, resolved);
    if (n) rule = { ...rule, recipe: n.recipe, height: Math.min(v.budgets.maxHeight, Math.max(4, Math.floor(resolved.height * n.retain / 4) * 4)), finish: n.finish, bay: 8 };
    return { f, frame: frames.get(b.id)!, rule, named: n, square, facts: resolved };
  }).sort((a, b) => Number(!!b.named) - Number(!!a.named) || Number(!!b.facts.label.name) - Number(!!a.facts.label.name) || b.rule.height - a.rule.height || a.f.building.id - b.f.building.id);
  const pieces: StaticPiece[] = [];
  const counts = new Uint32Array(chunks * chunks);
  const records: RuinRecord[] = [];
  const rejected: { part: number; reason: string }[] = [];
  const usedKinds: Record<string, number> = {};
  const ckey = (p: StaticPiece): number => Math.floor(p.z / 64) * chunks + Math.floor(p.x / 64);
  const accept = (m: Mason): boolean => {
    if (pieces.length + m.pieces.length > v.budgets.maxCity) return false;
    const local = new Map<number, number>();
    for (const p of m.pieces) {
      if (![p.x, p.y, p.z, p.yaw].every(Number.isFinite) || p.x < 0 || p.x >= size || p.z < 0 || p.z >= size || p.y < -64 || p.y > 2047) return false;
      const c = ckey(p); const num = (local.get(c) ?? 0) + 1; local.set(c, num);
      if (counts[c]! + num > v.budgets.maxChunk) return false;
    }
    for (const [c, num] of local) counts[c] = counts[c]! + num;
    for (const p of m.pieces) { pieces.push(p); usedKinds[p.kind] = (usedKinds[p.kind] ?? 0) + 1; }
    const side = (site.ground.n - 1) / 2;
    for (const r of m.clear) {
      const c0 = Math.max(0, Math.floor((size - r.x - r.radius) / 4)); const c1 = Math.min(side - 1, Math.floor((size - r.x + r.radius) / 4));
      const r0 = Math.max(0, Math.floor((size - r.z - r.radius) / 4)); const r1 = Math.min(side - 1, Math.floor((size - r.z + r.radius) / 4));
      for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) site.clearPlants[row * side + col] = 1;
    }
    return true;
  };
  for (const p of planned) {
    const { f, frame, rule } = p;
    const samples = tilesOf(frame, 4).map((t) => { const [x, z] = worldPoint(frame, t.u, t.v); return site.groundAt(x, z); }).sort((a, b) => a - b);
    const base = Math.round((samples[Math.floor(samples.length / 2)] ?? site.groundAt(frame.x, frame.z)) * 16) / 16;
    let built: Mason | null = null; let detail = 0;
    for (; detail < 4; detail++) {
      const m = new Mason(frame, base);
      const playable = Math.max(1, Math.floor(v.budgets.maxPlayableFloors / 2 ** detail));
      const r = detail === 3 ? { ...rule, height: Math.min(rule.height, 8), holes: .4, wall: 0 } : rule;
      layout(m, r, { seed: f.building.id ^ v.seed, playable, detail }, detail === 3 ? undefined : p.named?.layout);
      if (m.pieces.length > 0 && accept(m)) { built = m; break; }
      if (m.pieces.length === 0) break;
    }
    if (!built) { rejected.push({ part: f.building.id, reason: samples.length === 0 ? "no 4 m tile fits" : "budget or bounds" }); continue; }
    levelFloor(site, frame, ownerIndex.get(f.building.id)!, base);
    records.push({ footprint: Math.floor(f.building.id / 4), part: f.building.id, name: p.named?.name ?? p.facts.label.name ?? null,
      district: f.district?.name ?? "Unzoned", square: p.square, recipe: rule.recipe, special: p.named?.layout ?? null,
      x: frame.x, y: base, z: frame.z, yaw: frame.yaw, width: frame.width, depth: frame.depth,
      height: Math.max(...built.pieces.map((s) => s.y + RUIN_SHAPES[s.kind.split("_")[1] as RuinShape][1] / 2)) - base,
      blocks: built.pieces.length, detail, routes: built.routes, provisional: rule.provisional, modifiers: rule.matched, lore: p.facts.research?.lore ?? null, kind: p.facts.kind, sourceHeight: p.facts.height, heightFrom: p.facts.heightFrom, kindFrom: p.facts.kindFrom, researchFrom: p.facts.researchFrom ?? null });
  }
  const infrastructure = makeInfrastructure(site, accept);
  const publicPlaces = makePublicPlaces(site, data.places, accept);
  const folder = join(site.source, "reports/ruins1"); mkdirSync(folder, { recursive: true });
  const put = (name: string, value: unknown): void => writeFileSync(join(folder, name), `${JSON.stringify(value, null, 2)}\n`);
  const topChunks = [...counts.keys()].filter((i) => counts[i]! > 0).sort((a, b) => counts[b]! - counts[a]! || a - b).slice(0, 30).map((i) => ({ x: i % chunks, z: Math.floor(i / chunks), blocks: counts[i] }));
  const survey = readSurvey(join(site.source, "blocks"));
  const inventory = surveyInventory(survey);
  const categoriesByDistrict: Record<string, Record<string, number>> = {};
  for (const [id, f] of primary) {
    const row = categoriesByDistrict[f.district?.name ?? "Unzoned"] ??= {};
    const kind = facts.get(id)!.kind; row[kind] = (row[kind] ?? 0) + 1;
  }
  const all = [...facts];
  const supplied = Object.values(data.labels);
  put("labels.json", { fingerprint: data.fingerprint, footprints: primary.size, labels: supplied.length,
    named: supplied.filter((l) => l.name || l.also.length).length,
    suppliedKinds: tally(supplied.map((l) => l.kind ?? "missing")), suppliedHeights: tally(supplied.map((l) => l.height_from ?? "missing")),
    neither: supplied.filter((l) => !l.kind && !(l.height_m && l.height_m > 0)).length,
    resolvedKinds: tally(all.map(([, f]) => f.kindFrom)), resolvedHeights: tally(all.map(([, f]) => f.heightFrom)),
    categoriesByDistrict, places: tally(data.places.map((p) => p.kind)), enrichment: data.enrichment,
    inferred: all.filter(([, f]) => f.kindFrom !== "label" || !["osm", "usa_structures"].includes(f.heightFrom)).map(([id, f]) => ({ id, name: f.label.name, kind: f.kind, height: f.height, kindFrom: f.kindFrom, heightFrom: f.heightFrom, neighbours: f.neighbours })),
    famous: all.filter(([id, f]) => ["world", "city"].includes(f.research?.fame ?? "") || named.some((p) => p.footprint === id)).map(([id, f]) => ({ id, name: f.label.name, fame: f.research?.fame ?? "hand rule", research: f.researchFrom ?? null })),
    namedPlaces: all.filter(([, f]) => f.label.name).map(([id, f]) => ({ id, name: f.label.name, also: f.label.also, kind: f.kind, height: f.height, research: f.researchFrom ?? null, fame: f.research?.fame ?? null })),
    heightLevelConflicts: all.filter(([, f]) => f.label.levels && f.label.height_m && (f.label.height_m / f.label.levels < 2 || f.label.height_m / f.label.levels > 6)).map(([id, f]) => ({ id, height: f.label.height_m, levels: f.label.levels, kept: "height_m" })) });
  put("survey.json", { ...inventory, status: "stopped; enrichment by unambiguous name only", pending: [], unavailable: inventory.pending, enrichmentMatches: data.research.size });
  put("places.json", publicPlaces);
  put("buildings.json", records);
  put("generation.json", { version: v.version, seed: v.seed, labelsFingerprint: data.fingerprint, staticFingerprint: digest(pieces),
    blocks: pieces.length, buildings: records.length, footprints: site.footprints.length, rejected, kinds: usedKinds, topChunks,
    byRecipe: tally(records.map((r) => r.recipe)), byDistrict: tally(records.map((r) => r.district)),
    reduced: records.filter((r) => r.detail > 0).map((r) => ({ part: r.part, name: r.name, detail: r.detail })),
    routes: records.reduce((a, r) => a + r.routes.length, 0), infrastructure, publicPlaces: tally(publicPlaces.map((p) => p.status)), budgets: v.budgets });
  console.log(`ruins: ${records.length} buildings, ${pieces.length} blocks, peak chunk ${topChunks[0]?.blocks ?? 0}; ${supplied.length} direct labels, ${data.research.size} research matches`);
  return pieces;
}
const tally = (xs: string[]): Record<string, number> => {
  const out: Record<string, number> = {}; for (const x of xs) out[x] = (out[x] ?? 0) + 1; return out;
};

function makeInfrastructure(site: Site, accept: (m: Mason) => boolean): Record<string, number> {
  const { ground } = site; const size = (ground.n - 1) * 2;
  const at = (x: number, z: number): number => Math.max(0, Math.min(ground.n - 1, Math.round((size - z) / 2))) * ground.n + Math.max(0, Math.min(ground.n - 1, Math.round((size - x) / 2)));
  const f: Frame = { x: 0, z: 0, yaw: 0, c: 1, s: 0, rings: [], width: size, depth: size };
  let containers = 0; let parapets = 0;
  const port = site.world.districts.findIndex((d) => d.name === "The Port") + 1;
  for (let z = 16; z < size - 16; z += 16) for (let x = 16; x < size - 16; x += 16) {
    const i = at(x, z); const h = hash3(x, z, 7731);
    if (ground.surface[i] === S.DECK && h % 3 === 0) {
      for (const [dx, dz] of [[8, 0], [-8, 0], [0, 8], [0, -8]]) {
        if (ground.surface[at(x + dx!, z + dz!)] === S.DECK) continue;
        const m = new Mason(f, site.groundAt(x, z));
        m.put("sill8", x, .45, z, "concrete", dx === 0 ? 0 : 90);
        if (accept(m)) parapets++;
        break;
      }
    }
    if (ground.district[i] !== port || ground.surface[i] !== S.YARD || h % 5 > 2 || ground.shore[i]! < 16) continue;
    if (![-7, 0, 7].every((dx) => [-3, 0, 3].every((dz) => ground.surface[at(x + dx, z + dz)] === S.YARD))) continue;
    const m = new Mason(f, site.groundAt(x, z));
    const finish: RuinFinish = h % 3 === 0 ? "blue" : h % 3 === 1 ? "rust" : "mint";
    m.put("container", x, 1.3, z, finish); m.cover(x, z, 8);
    if (h % 4 === 0) m.put("container", x, 3.9, z, finish);
    if (accept(m)) containers++;
  }
  return { containerStacks: containers, causewayParapets: parapets };
}

export const RUINS: StaticLayer = { name: "Miami ruins", make: makeRuins };

function levelFloor(site: Site, frame: Frame, owner: number, base: number): void {
  const { n, height, heaps } = site.ground; const size = (n - 1) * 2;
  const pts = frame.rings[0]!.map(([u, v]) => worldPoint(frame, u, v));
  const minX = Math.min(...pts.map((p) => p[0])); const maxX = Math.max(...pts.map((p) => p[0]));
  const minZ = Math.min(...pts.map((p) => p[1])); const maxZ = Math.max(...pts.map((p) => p[1]));
  for (let row = Math.max(0, Math.floor((size - maxZ) / 2)); row <= Math.min(n - 1, Math.ceil((size - minZ) / 2)); row++) {
    for (let col = Math.max(0, Math.floor((size - maxX) / 2)); col <= Math.min(n - 1, Math.ceil((size - minX) / 2)); col++) {
      const i = row * n + col;
      if (heaps.owner[i] !== owner || site.ground.surface[i] !== S.FLOOR) continue;
      height[i] = base;
    }
  }
}

function makePublicPlaces(site: Site, places: PublicPlace[], accept: (m: Mason) => boolean): (PublicPlace & { status: string; blocks: number })[] {
  const size = (site.ground.n - 1) * 2;
  const out: (PublicPlace & { status: string; blocks: number })[] = [];
  for (const p of places) {
    const [x, z] = site.toEngine(p.e, p.n); const y = site.groundAt(x, z);
    const record = { ...p, status: "context only", blocks: 0 }; out.push(record);
    if (x < 20 || z < 20 || x >= size - 20 || z >= size - 20) { record.status = "outside usable map"; continue; }
    const i = Math.round((size - z) / 2) * site.ground.n + Math.round((size - x) / 2);
    if (p.in_footprint !== null || site.ground.surface[i] === S.FLOOR) { record.status = "building already represented"; continue; }
    if (p.kind === "bridge") { record.status = "ground causeway and parapet layer; point has no span"; continue; }
    if (p.kind === "pier") { record.status = "point has no pier length or orientation"; continue; }
    if (y < 0) { record.status = "submerged context"; continue; }
    if ([S.STREET, S.HIGHWAY, S.DECK].includes(site.ground.surface[i]! as typeof S.STREET)) { record.status = "road kept clear"; continue; }
    const frame: Frame = { x, z, c: 1, s: 0, yaw: 0, width: 24, depth: 24, rings: [[[-12, -12], [12, -12], [12, 12], [-12, 12], [-12, -12]]] };
    if (p.kind === "crane") {
      const directions = Array.from({ length: 8 }, (_, i) => i * Math.PI / 4);
      const angle = directions.sort((a, b) => site.groundAt(x + Math.cos(a) * 48, z - Math.sin(a) * 48) - site.groundAt(x + Math.cos(b) * 48, z - Math.sin(b) * 48) || a - b)[0]!;
      frame.c = Math.cos(angle); frame.s = Math.sin(angle); frame.yaw = angle * 180 / Math.PI;
    }
    const m = new Mason(frame, y);
    if (["monument", "artwork", "fountain", "viewpoint"].includes(p.kind)) {
      m.put("plinth", 0, .5, 0); m.put("crown", 0, 3, 0, "limestone");
    } else if (["park", "garden", "dog_park", "marina", "beach"].includes(p.kind)) {
      for (const side of [-1, 1]) { m.put("seat", 0, .4, side * 8); m.put("rubble", side * 10, .35, 0); }
    } else if (p.kind === "station") {
      for (const side of [-1, 1]) { m.put("floor8", side * 4, .2, 0); m.put("seat", side * 4, .8, 0); m.post(side * 8, 0, 0, 4); m.put("beam8", side * 4, 4, 0); }
    } else if (p.kind === "crane") {
      for (const du of [-6, 6]) for (const dv of [-4, 4]) { m.put("fin16", du, 8, dv, "rust"); m.put("fin8", du, 20, dv, "rust"); }
      for (let u = -8; u <= 24; u += 8) m.put("wall8", u, 24, 0, "rust");
      m.put("fin16", 26, 16, 0, "rust");
    } else continue;
    m.cover(0, 0, 6);
    if (accept(m)) { record.status = "built"; record.blocks = m.pieces.length; }
    else record.status = "budget or bounds";
  }
  return out;
}

