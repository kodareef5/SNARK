// A playable map from a painted map's base layers: bun tools/mapworld/build.ts <name> [--release]
//
// Reads assets/source/maps/<name>/base (its VALUES.md says what each layer holds) and world/world.json (the sea, the
// districts, where survivors arrive and where obelisks stand), writes the folder of layers tools/map.ts builds from to
// var/maps/<name>/layers, then the map file var/maps/<name>.snmap, and says what it holds. The same inputs give the same
// bytes. Its copies for the wire take a few seconds; --release writes the tightest, as a map that ships has (tools/map/pack.ts).

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { SECTOR_CHUNKS, chunkCount, framed } from "../../shared/coords.ts";
import { MapStatics, mapHeightfield, mapNodes, mapTops, parseMap, resolveNodes, writeMap } from "../../shared/world/mapfile.ts";
import { obeliskStatics } from "../../shared/world/obelisks.ts";
import { describe } from "../map.ts";
import { readLayers, waterLayer } from "../map/layers.ts";
import { partsTable, wireBytes, writeMapFile } from "../map/pack.ts";
import { lakeSquares } from "./lakes.ts";
import { writeGrey } from "../map/png.ts";
import { Base } from "./base.ts";
import { makeGround, S, type World } from "./ground.ts";
import { makeNodes, ZONE_CELL } from "./nodes.ts";
import { placeObelisks, placeRegions, placeSpawns, staticCover } from "./places.ts";
import { STATIC_LAYERS, siteOf } from "./statics.ts";
import { makeTint } from "./tint.ts";
import { vocabulary } from "./ruin-vocabulary.ts";
import { helicopterSites, type HelicopterSite } from "../helicopter/sites.ts";
import { boatSites, mappedBoatSites } from "../boat/sites.ts";
import type { BuildingLabel, PublicPlace } from "./labels.ts";
import { growRuins } from "./ruin-growth.ts";
import { landmarkDefs, landmarksOf, layLandmarkGround, placeLandmarks } from "./landmarks.ts";

const ROOT = resolve(import.meta.dir, "../..");

export async function buildMap(name: string, release = false): Promise<{ file: string; stats: Record<string, unknown> }> {
  const t0 = performance.now();
  const lap = (what: string): void => console.log(`${((performance.now() - t0) / 1000).toFixed(1).padStart(5)} s  ${what}`);
  const source = join(ROOT, "assets/source/maps", name);
  const base = new Base(source);
  const world = JSON.parse(readFileSync(join(source, "world/world.json"), "utf8")) as World;
  const n = base.n;
  const size = base.info.size_m;
  const chunks = base.info.chunks;
  const half = size / 2;
  const toSample = (lon: number, lat: number): [number, number] => {
    const [e, no] = base.tm.forward(lon, lat);
    return [(e + half) / 2, (half - no) / 2];
  };
  // The core's content and what the map's landmarks bring.
  const sited = landmarksOf(world.landmarks ?? [], toSample, size);
  const compiled = compileContent([...CORE_CONTENT, ...landmarkDefs(sited)]);
  if (!compiled.registry) throw new Error(compiled.errors.join("\n"));
  const reg = compiled.registry;

  const ground = makeGround(base, world, lap);
  lap("ground");
  const site = siteOf(world, ground, size, source);
  const layered = STATIC_LAYERS.flatMap((layer) => {
    const pieces = layer.make(site);
    lap(`${pieces.length} static pieces of ${layer.name}`);
    return pieces;
  });
  // A kind the content does not have would load nowhere: say so here, not when a server or a picture opens the map.
  const unknown = [...new Set(layered.map((p) => p.kind))].filter((kind) => !reg.index.has(kind));
  if (unknown.length) throw new Error(`static pieces of kinds the content does not have: ${unknown.join(", ")}`);
  // The obelisks come last, so every other piece keeps its slot in its chunk.
  const occupied = staticCover(layered, reg, n, size);
  const budget = world.heaps === false ? vocabulary(source).budgets.maxChunk : Infinity;
  const pieceCounts = new Uint32Array(chunks * chunks);
  for (const p of layered) pieceCounts[Math.floor(p.z / 64) * chunks + Math.floor(p.x / 64)]!++;
  for (let k = 0; k < pieceCounts.length; k++) if (pieceCounts[k]! > budget - 4) {
    const x = k % chunks; const z = Math.floor(k / chunks);
    for (let row = Math.max(0, n - 1 - (z + 1) * 32); row <= Math.min(n - 1, n - 1 - z * 32); row++) for (let col = Math.max(0, n - 1 - (x + 1) * 32); col <= Math.min(n - 1, n - 1 - x * 32); col++) occupied[row * n + col] = 1;
  }
  for (const route of site.growthRoutes) for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1]!; const b = route.points[i]!; const length = Math.hypot(b.x - a.x, b.z - a.z);
    for (let d = 0; d <= length; d += 1) {
      const t = length ? d / length : 0; const x = a.x + (b.x - a.x) * t; const z = a.z + (b.z - a.z) * t;
      const row = Math.round((size - z) / 2); const col = Math.round((size - x) / 2);
      if (row >= 0 && col >= 0 && row < n && col < n) occupied[row * n + col] = 1;
    }
  }
  const obelisks = placeObelisks(ground, world, toSample, size, occupied);
  // Then the landmarks, on the ground they ask for, so no piece before them changes its slot.
  const berths = layLandmarkGround(ground, sited, size, 0);
  const brought = placeLandmarks(sited, reg, 0);
  const statics = [...layered, ...obelisks.flatMap((o) => obeliskStatics(reg, o, site.groundAt).map((p) => ({ ...p, yaw: (p.yaw * 360) / 65536 }))), ...brought.statics.map((p) => ({ ...p, yaw: (p.yaw * 360) / 65536 }))];
  pieceCounts.fill(0);
  for (const p of statics) pieceCounts[Math.floor(p.z / 64) * chunks + Math.floor(p.x / 64)]!++;
  const maxChunk = Math.max(...pieceCounts);
  if (maxChunk > budget) throw new Error(`Static chunk budget ${budget} exceeded after obelisks: ${maxChunk}`);
  lap(`${obelisks.length} obelisks`);
  const tint = makeTint(ground, world);
  lap("colour");
  const spawns = placeSpawns(ground, world, toSample, size);
  const regions = placeRegions(ground, size, spawns, world.easyAroundSpawns ?? 0);
  lap(`${spawns.length} spawn points, ${regions.length} spawn regions`);
  // A parked car stands well off where survivors arrive and where they leave, so neither's walk meets it.
  const apart = world.heaps === false ? vocabulary(source).street.cars.parked.fromSpawn : 0;
  const vehicles = [...site.vehicles.filter((c) => ![...spawns, ...obelisks].some((s) => Math.hypot(s.x - c.x, s.z - c.z) < apart)), ...brought.vehicles.map((v) => ({ ...v, yaw: (v.yaw * 360) / 65536 }))];
  lap(`${vehicles.length} parked vehicles`);
  // Nothing grows within 8 m of a spawn point, so nobody arrives inside a tree, nor within 14 m of an obelisk's middle,
  // so none stands in it or before its terminal, nor within 6 m of a parked car.
  const clearings = [...spawns.map((s) => [(size - s.x) / 2, (size - s.z) / 2, 16] as const), ...obelisks.map((o) => [(size - o.x) / 2, (size - o.z) / 2, 49] as const), ...vehicles.map((c) => [(size - c.x) / 2, (size - c.z) / 2, 9] as const)];
  const growth = world.heaps === false ? vocabulary(source).growth : undefined;
  const nodes = makeNodes(ground, world, (col, row) => (!growth && site.clearPlants[Math.floor(row / 2) * ((n - 1) / 2) + Math.floor(col / 2)] === 1) || berths[row * n + col] === 1 || clearings.some(([c, r, d2]) => (c - col) ** 2 + (r - row) ** 2 < d2), (col, row) => site.lowPlants[Math.floor(row / 2) * ((n - 1) / 2) + Math.floor(col / 2)] === 1, growth);
  lap("nodes");

  const layers = join(ROOT, "var/maps", name, "layers");
  rmSync(layers, { recursive: true, force: true });
  mkdirSync(layers, { recursive: true });
  const put = (file: string, data: string | Uint8Array): void => writeFileSync(join(layers, file), data);
  const sits = framed({ chunksX: chunks, chunksZ: chunks, ...(world.frame ? { frameX: world.frame[0], frameZ: world.frame[1] } : {}) });
  const origin = [sits.originX + (world.room?.west ?? 0) * SECTOR_CHUNKS, sits.originZ + (world.room?.north ?? 0) * SECTOR_CHUNKS];
  put("map.json", `${JSON.stringify({ id: world.id, chunks: [chunks, chunks], frame: [sits.frameX, sits.frameZ], origin, minY: world.minY, stepY: world.stepY, seaLevel: world.sea === false ? null : 0 }, null, 2)}\n`);
  const heights = new Uint8Array(n * n * 2);
  const view = new DataView(heights.buffer);
  let deepest = Infinity;
  let highest = -Infinity;
  for (let i = 0; i < n * n; i++) {
    const v = Math.max(0, Math.min(65535, Math.round((ground.height[i]! - world.minY) / world.stepY)));
    view.setUint16(i * 2, v, true);
    const y = world.minY + v * world.stepY;
    if (y < -20 && process.env.DEBUG_LOW) console.log("low", i % n, Math.floor(i / n), ground.height[i], ground.surface[i]);
    deepest = Math.min(deepest, y);
    highest = Math.max(highest, y);
  }
  put("heights.u16", heights);
  put("tint.u8", tint);
  put("plants.png", writeGrey(nodes.side, nodes.side, nodes.plants));
  put("stones.png", writeGrey(nodes.side, nodes.side, nodes.stones));
  put("sea.png", writeGrey(nodes.side, nodes.side, nodes.sea));
  put("nodes.json", `${JSON.stringify(nodes.layers, null, 2)}\n`);
  const lines = (rows: readonly unknown[]): string => `[\n${rows.map((r) => `  ${JSON.stringify(r)}`).join(",\n")}\n]\n`;
  put("spawns.json", lines(spawns));
  put("regions.json", lines(regions));
  if (statics.length > 0) put("statics.json", lines(statics));
  if (vehicles.length > 0) put("vehicles.json", lines(vehicles));
  // Lakes above the sea as bodies of water, in squares of a sample.
  if (ground.lakes) {
    const water = waterLayer({ chunksX: chunks, chunksZ: chunks }, world.minY, world.stepY, 2, ground.lakes.bodies, lakeSquares(ground.lakes, n, 2));
    put("water.json", water.json);
    put("water.png", water.png);
  }
  lap(`layers in ${layers}`);

  let map = readLayers(layers);
  map = { ...map, statics: MapStatics.of(map.dims, map.statics), ...(sited.length > 0 ? { content: brought.content } : {}) };
  Bun.gc(true);
  // Whether each slot's node stands, and as what, is decided here once, and the file says so.
  const taken = { water: 0, slope: 0, footing: 0, other: 0 };
  map = resolveNodes(map, reg, taken);
  lap(`nodes resolved: ${taken.water} slots empty for water, ${taken.slope} for slope, ${taken.footing} for a footing; ${taken.other} stand as their footing's other kind`);
  if (growth) {
    const grown = growRuins(map, compiled.registry, site, growth);
    map = { ...map, nodes: grown.layers };
    writeFileSync(join(source, "reports", world.ruins?.report ?? "ruins", "growth.json"), JSON.stringify(grown.summary, null, 2) + "\n");
    lap("growth placed around structures and routes");
  }
  // Surveyed hospitals and emergency-service sites receive matching liveries. Industrial yards receive civilian craft.
  const facts = JSON.parse(readFileSync(join(source, "base/buildings_attributes.json"), "utf8")) as { fields: string[]; rows: (string | number | null)[][] };
  const idAt = facts.fields.indexOf("OBJECTID"), primaryAt = facts.fields.indexOf("PRIM_OCC"), classAt = facts.fields.indexOf("OCC_CLS");
  const uses = new Map(facts.rows.map(row => [Number(row[idAt]), `${row[classAt] ?? ""} ${row[primaryAt] ?? ""}`.toLowerCase()]));
  const aircraftSites: HelicopterSite[] = [];
  for (const { building } of site.footprints) {
    const use = uses.get(Math.floor(building.id / 4)) ?? "";
    const kind = /hospital/.test(use) ? "hospital" : /police|emergency response/.test(use) ? "police" : /industrial/.test(use) && building.area > 1200 ? "civilian" : null;
    if (!kind) continue;
    const [x, z] = site.toEngine(building.e, building.n);
    const radius = Math.max(...building.rings[0]!.map(point => Math.hypot(point[0]! - building.e, point[1]! - building.n)));
    aircraftSites.push({ id: `building-${building.id}`, kind, x, z, radius });
  }
  // After the parked cars, which keep their places in the list, and clear of them; the boats clear of both.
  const parked = map.vehicles ?? [];
  const aircraft = helicopterSites(map, reg, aircraftSites);
  const waterfrontPlaces = JSON.parse(readFileSync(join(source, "blocks/places.json"), "utf8")) as PublicPlace[];
  const waterfrontLabels = JSON.parse(readFileSync(join(source, "blocks/labels.json"), "utf8")) as Record<string, BuildingLabel>;
  const boats = boatSites({ ...map, vehicles: [...parked, ...aircraft] }, reg, mappedBoatSites(waterfrontPlaces, waterfrontLabels, site.toEngine));
  if (aircraft.length + boats.length > 0) {
    const all = [...parked, ...aircraft, ...boats];
    map = { ...map, vehicles: all };
    put("vehicles.json", lines(all.map(v => ({ ...v, yaw: v.yaw * 360 / 65536 }))));
  }
  lap(`${aircraft.length} found aircraft at surveyed service sites and industrial yards; ${boats.length} boats at mapped waterfronts`);
  map = { ...map, tops: mapTops(map, reg) };
  lap(`the far feed's cells of ${map.tops!.chunks.length} chunks, for the overviews' tops`);
  const bytes = writeMap(map);
  const file = join(ROOT, "var/maps", `${name}.snmap`);
  const built = (performance.now() - t0) / 1000;
  const packed = await writeMapFile(file, bytes, release);
  lap(`map file ${file} and its parts' files with their copies for the wire`);
  for (const line of [...describe(bytes), ...partsTable(packed)]) console.log(`        ${line}`);

  // The numbers: nodes by kind, how much land is walkable, the deepest water and the tallest heap.
  const parsed = parseMap(bytes);
  const packedMax = Math.max(...parsed.statics.first.slice(1).map((end, i) => end - parsed.statics.first[i]!));
  if (packedMax > budget) throw new Error(`Packed static chunk budget ${budget} exceeded: ${packedMax}`);
  const hf = mapHeightfield(parsed);
  const placed = mapNodes(parsed, hf, reg)!;
  const byKind = new Map<string, number>();
  const spot = { kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 };
  for (let c = 0; c < chunkCount(parsed.dims); c++) {
    for (let s = 0; s < placed.perChunk; s++) {
      placed.at(c, s, spot);
      if (spot.kind === 0) continue;
      const id = reg.defs[spot.kind]!.id;
      byKind.set(id, (byKind.get(id) ?? 0) + 1);
    }
  }
  let land = 0;
  let walkable = 0;
  // Walkable as the survivor's own limit has it (ARK's 44.8 degrees, D483).
  const cosLimit = reg.move[reg.index.get("core:survivor")!]!.slopeCos;
  for (let j = 0; j + 1 < hf.nz; j++) {
    for (let i = 0; i + 1 < hf.nx; i++) {
      const h = hf.sample(i, j);
      if (h < hf.waterAt(i * hf.cell + 1, j * hf.cell + 1)) continue;
      land++;
      const gx = (hf.sample(i + 1, j) - h) / hf.cell;
      const gz = (hf.sample(i, j + 1) - h) / hf.cell;
      if (1 / Math.sqrt(1 + gx * gx + gz * gz) >= cosLimit) walkable++;
    }
  }
  const surfaces: Record<string, number> = {};
  for (const [key, value] of Object.entries(S)) {
    let m = 0;
    for (let i = 0; i < n * n; i++) if (ground.surface[i] === value) m++;
    surfaces[key.toLowerCase()] = Math.round(m * 4);
  }
  // The tallest ruins as they stand, and for each a place on a street 60 to 140 m off to see it from.
  const top = new Float32Array(ground.heaps.ruins.length);
  for (let i = 0; i < n * n; i++) {
    const o = ground.heaps.owner[i]!;
    if (o >= 0 && ground.surface[i] !== S.SPILL) top[o] = Math.max(top[o]!, ground.heaps.lift[i]!);
  }
  const order = [...top.keys()].sort((a, b) => top[b]! - top[a]!);
  const landmarks = order.slice(0, 8).map((k) => {
    const b = ground.heaps.ruins[k]!.building;
    const [c0, r0] = [(b.e + half) / 2, (half - b.n) / 2];
    let best: [number, number] | null = null;
    for (let r = Math.round(r0) - 70; r <= r0 + 70 && !best; r++) {
      for (let c = Math.round(c0) - 70; c <= c0 + 70; c++) {
        const d = Math.hypot(c - c0, r - r0) * 2;
        const i = r * n + c;
        if (d < 60 || d > 140 || r < 0 || c < 0 || r >= n || c >= n) continue;
        if (ground.surface[i] === S.STREET || ground.surface[i] === S.HIGHWAY) {
          best = [size - c * 2, size - r * 2];
          break;
        }
      }
    }
    return { top: Number(top[k]!.toFixed(1)), x: Math.round(size - c0 * 2), z: Math.round(size - r0 * 2), district: world.districts[ground.heaps.ruins[k]!.district - 1]?.name ?? "", from: best };
  });
  const stats = {
    id: world.id,
    bytes: bytes.length,
    firstFrameBrotli: packed.first.br,
    brotli: wireBytes(packed, "br"),
    release,
    buildSeconds: Number(built.toFixed(1)),
    totalSeconds: Number(((performance.now() - t0) / 1000).toFixed(2)),
    peakResidentMiB: Number((process.resourceUsage().maxRSS / 1024).toFixed(1)),
    staticTotal: statics.length,
    staticMaxChunk: packedMax,
    staticMaxChunkBeforePacking: maxChunk,
    vehicles: vehicles.length,
    deepestWater: Number(deepest.toFixed(2)),
    highestGround: Number(highest.toFixed(2)),
    landmarks: statics.length === 0 ? landmarks : [],
    ruins: ground.heaps.ruins.length,
    landShareWalkable: Number((walkable / land).toFixed(4)),
    landSquareMetres: land * 4,
    bridges: ground.bridges,
    ...(ground.lakes ? { lakes: ground.lakes.made.map((m) => ({ ...m, squareMetres: m.water * 4 })) } : {}),
    nodes: Object.fromEntries([...byKind.entries()].sort((a, b) => b[1] - a[1])),
    nodeTotal: [...byKind.values()].reduce((a, b) => a + b, 0),
    nodeSlotsTaken: taken,
    zoneCell: ZONE_CELL,
    spawns,
    obelisks: obelisks.map((o) => ({ ...o, yaw: Math.round((o.yaw * 360) / 65536), ground: Number(site.groundAt(o.x, o.z).toFixed(2)) })),
    regions: { count: regions.length, creaturesAt1x: regions.reduce((a, r) => a + r.count, 0), beach: regions.filter((r) => r.spawns === "core:spawns_beach").reduce((a, r) => a + r.count, 0) },
    surfaceSquareMetres: surfaces,
  };
  writeFileSync(join(ROOT, "var/maps", name, "stats.json"), `${JSON.stringify(stats, null, 2)}\n`);
  lap("numbers");
  return { file, stats };
}

if (import.meta.main) {
  const words = process.argv.slice(2);
  const { stats } = await buildMap(words.find((w) => w !== "--release") ?? (() => { throw new Error("Map name required"); })(), words.includes("--release"));
  console.log(JSON.stringify({ ...stats, spawns: undefined, surfaceSquareMetres: undefined }, null, 2));
}
