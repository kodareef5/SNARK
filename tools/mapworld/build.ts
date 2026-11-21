// A playable map from a city's base layers: bun tools/mapworld/build.ts <name or folder> [--release]
//
// Reads the city's work folder (tools/maps/work.ts; tools/maps/city.ts runs this as its last stage), or a folder named by
// a path (its last part the map's name): base/ (its VALUES.md says what each layer holds) and world/world.json (the sea, the
// districts, where survivors arrive and where obelisks stand), writes the folder of layers tools/map.ts builds from to
// var/maps/<name>/layers, then the map file var/maps/<name>.snmap, and says what it holds. The same inputs give the same
// bytes. Its copies for the wire take a few seconds; --release writes the tightest, as a map that ships has (tools/map/pack.ts).

import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { SECTOR_CHUNKS, chunkCount, framed } from "../../shared/coords.ts";
import { MapStatics, mapHeightfield, mapNodes, mapTops, parseMap, resolveNodes, writeMap } from "../../shared/world/mapfile.ts";
import { obeliskStatics } from "../../shared/world/obelisks.ts";
import { describe } from "../map.ts";
import { readLayers, toYaw, waterLayer } from "../map/layers.ts";
import { partsTable, wireBytes, writeMapFile } from "../map/pack.ts";
import { lakeSquares } from "./lakes.ts";
import { writeGrey } from "../map/png.ts";
import { Base } from "./base.ts";
import type { BridgeRecord } from "./bridges.ts";
import { groundClasses, makeGround, S, type World } from "./ground.ts";
import { makeNodes, ZONE_CELL } from "./nodes.ts";
import { gradeTransferDecks, placeObelisks, placeRegions, placeSpawns, staticCover } from "./places.ts";
import { STATIC_LAYERS, siteOf, type StaticPiece } from "./statics.ts";
import { SPAWN_CLEAR, isFurniture } from "./street-furniture.ts";
import { streetGraph } from "./street-graph.ts";
import { cornersOf } from "./corners.ts";
import { roadFrame } from "./road-frame.ts";
import { makeTint } from "./tint.ts";
import { vocabulary } from "./ruin-vocabulary.ts";
import { helicopterSites, type HelicopterSite } from "../helicopter/sites.ts";
import { boatSites, HARBOURS, mappedBoatSites } from "../boat/sites.ts";
import { harbourWrecks, vehicleMeshes } from "../boat/wrecks.ts";
import type { BuildingLabel, PublicPlace } from "./labels.ts";
import { growRuins } from "./ruin-growth.ts";
import { landmarkDefs, landmarksOf, layLandmarkGround, placeLandmarks } from "./landmarks.ts";
import { workFolder } from "../maps/work.ts";

const ROOT = resolve(import.meta.dir, "../..");

export async function buildMap(named: string, release = false, output = join(ROOT, "var/maps")): Promise<{ file: string; stats: Record<string, unknown> }> {
  const t0 = performance.now();
  // Each step with the process's memory as it ends it and the most it has held: what a machine of 32 GB can build is
  // read here (/proc, so Linux alone; elsewhere the time alone).
  const memory = (): string => {
    try {
      const status = readFileSync("/proc/self/status", "utf8");
      const gb = (key: string): string => (Number(new RegExp(`${key}:\\s+(\\d+)`).exec(status)?.[1] ?? 0) / 1048576).toFixed(1);
      return `  [${gb("VmRSS")} GB, most ${gb("VmHWM")}]`;
    } catch { return ""; }
  };
  const lap = (what: string): void => console.log(`${((performance.now() - t0) / 1000).toFixed(1).padStart(5)} s  ${what}${memory()}`);
  const source = named.includes("/") ? resolve(named) : workFolder(named);
  const name = basename(source);
  const base = new Base(source);
  const world = JSON.parse(readFileSync(join(source, "world/world.json"), "utf8")) as World;
  const { grid } = base;
  const { nx, nz, sizeX, sizeZ, x0, z0, x1, z1 } = grid;
  const [chunksX, chunksZ] = [sizeX / 64, sizeZ / 64];
  // The build places things in lattice metres (Grid, base.ts); the layers hold the map's own.
  const engine = <T extends { x: number; z: number }>(p: T): T => ({ ...p, x: p.x - x0, z: p.z - z0 });
  const toSample = (lon: number, lat: number): [number, number] => base.toSample(lon, lat);
  // The core's content and what the map's landmarks bring.
  const sited = landmarksOf(world.landmarks ?? [], toSample, grid);
  const compiled = compileContent([...CORE_CONTENT, ...landmarkDefs(sited)]);
  if (!compiled.registry) throw new Error(compiled.errors.join("\n"));
  const reg = compiled.registry;

  // Where two streets meet the corner is rounded (corners.ts): on the ground here, and by a curb return the walks set down.
  const returns = world.heaps === false ? vocabulary(source).street.walks?.returns : undefined;
  const corners = returns ? cornersOf({ source, toLattice: (e, n) => [grid.east + x0 - e, n - (grid.south - z0)] }, returns) : [];
  const ground = makeGround(base, world, lap, corners);
  // A step's own working arrays let go before the next takes its own: the ground's are some 26 full-frame arrays, the
  // ruins' their whole city's plans, and without a collection between them the next step's peak was laid on theirs.
  Bun.gc(true);
  lap("ground");
  const site = siteOf(world, ground, source);
  const layered: StaticPiece[] = [];
  for (const layer of STATIC_LAYERS) {
    const pieces = layer.make(site, layered);
    Bun.gc(true);
    lap(`${pieces.length} static pieces of ${layer.name}`);
    for (const p of pieces) layered.push(p);
  }
  // A kind the content does not have would load nowhere: say so here, not when a server or a picture opens the map.
  const unknown = [...new Set(layered.map((p) => p.kind))].filter((kind) => !reg.index.has(kind));
  if (unknown.length) throw new Error(`static pieces of kinds the content does not have: ${unknown.join(", ")}`);
  // The obelisks come last, so every other piece keeps its slot in its chunk.
  const occupied = staticCover(layered, reg, grid);
  const budget = world.heaps === false ? vocabulary(source).budgets.maxChunk : Infinity;
  const pieceCounts = new Uint32Array(chunksX * chunksZ);
  for (const p of layered) pieceCounts[Math.floor((p.z - z0) / 64) * chunksX + Math.floor((p.x - x0) / 64)]!++;
  for (let k = 0; k < pieceCounts.length; k++) if (pieceCounts[k]! > budget - 4) {
    const x = k % chunksX; const z = Math.floor(k / chunksX);
    for (let row = Math.max(0, nz - 1 - (z + 1) * 32); row <= Math.min(nz - 1, nz - 1 - z * 32); row++) for (let col = Math.max(0, nx - 1 - (x + 1) * 32); col <= Math.min(nx - 1, nx - 1 - x * 32); col++) occupied[row * nx + col] = 1;
  }
  for (const route of site.growthRoutes) for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1]!; const b = route.points[i]!; const length = Math.hypot(b.x - a.x, b.z - a.z);
    for (let d = 0; d <= length; d += 1) {
      const t = length ? d / length : 0; const x = a.x + (b.x - a.x) * t; const z = a.z + (b.z - a.z) * t;
      const row = Math.round((z1 - z) / 2); const col = Math.round((x1 - x) / 2);
      if (row >= 0 && col >= 0 && row < nz && col < nx) occupied[row * nx + col] = 1;
    }
  }
  const obelisks = placeObelisks(ground, world, toSample, occupied);
  gradeTransferDecks(ground, obelisks, world.minY, world.stepY);
  // Then the landmarks, on the ground they ask for, so no piece before them changes its slot.
  const berths = layLandmarkGround(ground, sited, 0);
  const brought = placeLandmarks(sited, reg, 0);
  const statics = [...layered, ...obelisks.flatMap((o) => obeliskStatics(reg, o, site.groundAt).map((p) => ({ ...p, yaw: (p.yaw * 360) / 65536 }))), ...brought.statics.map((p) => ({ ...p, yaw: (p.yaw * 360) / 65536 }))];
  pieceCounts.fill(0);
  for (const p of statics) pieceCounts[Math.floor((p.z - z0) / 64) * chunksX + Math.floor((p.x - x0) / 64)]!++;
  // The harbours' wrecks, in the water by their marinas and piers, before the found vessels, which keep clear of them.
  const harbours = world.heaps === false ? vocabulary(source).harbours : HARBOURS;
  const waterfrontPlaces = JSON.parse(readFileSync(join(source, "blocks/places.json"), "utf8")) as PublicPlace[];
  const waterfrontLabels = JSON.parse(readFileSync(join(source, "blocks/labels.json"), "utf8")) as Record<string, BuildingLabel>;
  // A harbour's district is the one its water looks onto: the nearest district within 200 m of the place.
  const districtAt = (x: number, z: number): { name: string; style: string } | null => {
    for (let r = 0; r <= 200; r += 10) for (let a = 0; a < (r ? 16 : 1); a++) {
      const col = Math.round((x1 - x - Math.sin(a * Math.PI / 8) * r) / 2), row = Math.round((z1 - z - Math.cos(a * Math.PI / 8) * r) / 2);
      const d = col >= 0 && row >= 0 && col < nx && row < nz ? world.districts[ground.district[row * nx + col]! - 1] : undefined;
      if (d) return { name: d.name, style: d.style };
    }
    return null;
  };
  const chunkOf = (x: number, z: number): number => Math.floor((z - z0) / 64) * chunksX + Math.floor((x - x0) / 64);
  const meshes = vehicleMeshes();
  const wrecks = harbourWrecks(mappedBoatSites(waterfrontPlaces, waterfrontLabels, site.toLattice), harbours, reg, statics, {
    waterAt: site.waterAt, groundAt: site.groundAt, inside: (x, z, reach) => Math.min(x - x0, z - z0, x1 - x, z1 - z) > reach,
    room: (x, z) => pieceCounts[chunkOf(x, z)]! < budget - 1,
  }, districtAt, (mesh) => meshes.has(mesh));
  for (const w of wrecks) { statics.push({ kind: w.kind, x: w.x, y: w.y, z: w.z, yaw: w.yaw }); pieceCounts[chunkOf(w.x, w.z)]!++; }
  lap(`${wrecks.length} wrecks in the harbours`);
  const maxChunk = Math.max(...pieceCounts);
  if (maxChunk > budget) throw new Error(`Static chunk budget ${budget} exceeded after obelisks: ${maxChunk}`);
  lap(`${obelisks.length} obelisks`);
  const tint = makeTint(ground, world);
  lap("colour");
  const spawns = placeSpawns(ground, world, toSample);
  // A survivor arrives clear of the street's furniture, which stood before the spawn points were known.
  const furnished = statics.length;
  for (let i = statics.length - 1; i >= 0; i--) if (isFurniture(statics[i]!.kind) && spawns.some((s) => Math.hypot(s.x - statics[i]!.x, s.z - statics[i]!.z) < SPAWN_CLEAR)) statics.splice(i, 1);
  if (statics.length < furnished) lap(`${furnished - statics.length} pieces of street furniture taken from where survivors arrive`);
  const regions = placeRegions(ground, spawns, world.easyAroundSpawns ?? 0);
  lap(`${spawns.length} spawn points, ${regions.length} spawn regions`);
  // A parked car stands well off where survivors arrive and where they leave, so neither's walk meets it.
  const apart = world.heaps === false ? vocabulary(source).street.cars.parked.fromSpawn : 0;
  const nearArrival = (p: { x: number; z: number }) => spawns.some(s => Math.hypot(s.x - p.x, s.z - p.z) < apart)
    || obelisks.some(o => Math.hypot(o.x - p.x, o.z - p.z) < Math.max(apart, o.radius === undefined ? 0 : o.radius + 8));
  for (let i = statics.length - 1; i >= 0; i--) {
    const p = statics[i]!;
    if (p.kind === "core:box_trailer" && nearArrival(p)) statics.splice(i, 1);
  }
  const vehicles = [...site.vehicles.filter((c) => !nearArrival(c)), ...brought.vehicles.map((v) => ({ ...v, yaw: (v.yaw * 360) / 65536 }))];
  lap(`${vehicles.length} parked vehicles`);
  // Nothing grows within 8 m of a spawn point, so nobody arrives inside a tree, nor within 14 m of an obelisk's middle,
  // so none stands in it or before its terminal, nor within 6 m of a parked car.
  const clearings = [...spawns.map((s) => [(x1 - s.x) / 2, (z1 - s.z) / 2, 16] as const), ...obelisks.map((o) => [(x1 - o.x) / 2, (z1 - o.z) / 2, o.color ? (o.radius! / 2 + 2) ** 2 : 49] as const), ...vehicles.map((c) => [(x1 - c.x) / 2, (z1 - c.z) / 2, 9] as const)];
  const growth = world.heaps === false ? vocabulary(source).growth : undefined;
  const nodes = makeNodes(ground, world, (col, row) => (!growth && site.clearPlants[Math.floor(row / 2) * ((nx - 1) / 2) + Math.floor(col / 2)] === 1) || berths[row * nx + col] === 1 || clearings.some(([c, r, d2]) => (c - col) ** 2 + (r - row) ** 2 < d2), (col, row) => site.lowPlants[Math.floor(row / 2) * ((nx - 1) / 2) + Math.floor(col / 2)] === 1, growth);
  lap("nodes");

  const layers = join(output, name, "layers");
  rmSync(layers, { recursive: true, force: true });
  mkdirSync(layers, { recursive: true });
  const put = (file: string, data: string | Uint8Array): void => writeFileSync(join(layers, file), data);
  const sits = framed({ chunksX, chunksZ, frameX: base.info.frame[0], frameZ: base.info.frame[1] });
  const origin = [sits.originX + (world.room?.west ?? 0) * SECTOR_CHUNKS, sits.originZ + (world.room?.north ?? 0) * SECTOR_CHUNKS];
  const tideEyes = obelisks.flatMap(o => o.color ? [{ ...engine(o), color: o.color, radius: o.radius!, y: site.groundAt(o.x, o.z), yaw: o.yaw * 360 / 65536 }] : []);
  put("map.json", `${JSON.stringify({ id: world.id, chunks: [chunksX, chunksZ], frame: [sits.frameX, sits.frameZ], origin, ...(tideEyes.length ? { tideEyes } : {}), minY: world.minY, stepY: world.stepY, seaLevel: world.sea === false ? null : 0 }, null, 2)}\n`);
  const heights = new Uint8Array(nx * nz * 2);
  const view = new DataView(heights.buffer);
  let deepest = Infinity;
  let highest = -Infinity;
  let below = 0;
  for (let i = 0; i < nx * nz; i++) {
    const raw = Math.round((ground.height[i]! - world.minY) / world.stepY);
    // Above the top a hill would be cut flat, silently: the map's minY or stepY is wrong for its ground. Below the
    // floor is deep water's bed, held at the floor.
    if (raw > 65535) throw new Error(`ground at ${ground.height[i]!.toFixed(1)} m stands over the ${(world.minY + 65535 * world.stepY).toFixed(0)} m this map's minY and stepY reach`);
    if (raw < 0) below++;
    const v = Math.max(0, raw);
    view.setUint16(i * 2, v, true);
    const y = world.minY + v * world.stepY;
    if (y < -20 && process.env.DEBUG_LOW) console.log("low", i % nx, Math.floor(i / nx), ground.height[i], ground.surface[i]);
    deepest = Math.min(deepest, y);
    highest = Math.max(highest, y);
  }
  put("heights.u16", heights);
  put("tint.u8", tint);
  put("ground.u8", groundClasses(ground));
  put("plants.png", writeGrey(nodes.across, nodes.down, nodes.plants));
  put("stones.png", writeGrey(nodes.across, nodes.down, nodes.stones));
  put("sea.png", writeGrey(nodes.across, nodes.down, nodes.sea));
  put("nodes.json", `${JSON.stringify(nodes.layers, null, 2)}\n`);
  // One record a line, each turned into the map's metres as it is written.
  const lines = <T,>(rows: readonly T[], turn: (row: T) => unknown = (row) => row): string => `[\n${rows.map((r) => `  ${JSON.stringify(turn(r))}`).join(",\n")}\n]\n`;
  put("spawns.json", lines(spawns, engine));
  put("regions.json", lines(regions, engine));
  // The statics as `lines` writes them, a megabyte at a time: as one string they were 0.8 to 1.5 GB.
  if (statics.length > 0) {
    const fd = openSync(join(layers, "statics.json"), "w");
    let chunk = "[\n";
    statics.forEach((p, i) => {
      chunk += `${i > 0 ? ",\n" : ""}  ${JSON.stringify(engine(p))}`;
      if (chunk.length > 1 << 20) { writeSync(fd, chunk); chunk = ""; }
    });
    writeSync(fd, `${chunk}\n]\n`);
    closeSync(fd);
  }
  if (vehicles.length > 0) put("vehicles.json", lines(vehicles, engine));
  // Lakes above the sea as bodies of water, in squares of a sample.
  if (ground.lakes) {
    const water = waterLayer({ chunksX, chunksZ }, world.minY, world.stepY, 2, ground.lakes.bodies, lakeSquares(ground.lakes, grid, 2));
    put("water.json", water.json);
    put("water.png", water.png);
  }
  lap(`layers in ${layers}`);

  // The statics from memory as statics.json says them (readLayers), not read back from it.
  let map = readLayers(layers, statics.map((p) => ({ kind: p.kind, x: p.x - x0, y: p.y, z: p.z - z0, yaw: toYaw(p.yaw) })));
  map = { ...map, statics: MapStatics.of(map.dims, map.statics), ...(sited.length > 0 ? { content: { ...brought.content, landmarks: brought.content.landmarks.map(engine) } } : {}) };
  // The map holds the statics in columns now; the pieces as objects, 7 to 13 M of them, are let go for the rest of the
  // build, and only their count is kept for the numbers.
  const staticTotal = statics.length;
  statics.length = 0;
  layered.length = 0;
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
    const [lx, lz] = site.toLattice(building.e, building.n); const [x, z] = [lx - x0, lz - z0];
    const radius = Math.max(...building.rings[0]!.map(point => Math.hypot(point[0]! - building.e, point[1]! - building.n)));
    aircraftSites.push({ id: `building-${building.id}`, kind, x, z, radius });
  }
  // After the parked cars, which keep their places in the list, and clear of them; the boats clear of both.
  const parked = map.vehicles ?? [];
  const aircraft = helicopterSites(map, reg, aircraftSites);
  const berthed = boatSites({ ...map, vehicles: [...parked, ...aircraft] }, reg, mappedBoatSites(waterfrontPlaces, waterfrontLabels, (e, n) => { const [x, z] = site.toLattice(e, n); return [x - x0, z - z0]; }), harbours, (x, z) => districtAt(x + x0, z + z0));
  const boats = berthed.map(({ site: _site, district: _district, ...v }) => v);
  if (world.heaps === false) writeFileSync(join(source, "reports", world.ruins?.report ?? "ruins", "harbours.json"), JSON.stringify({
    vessels: berthed.map(({ id, kind, site: at, district, x, z, condition, fuel }) => ({ id, kind, site: at, district, x: Math.round(x), z: Math.round(z), condition, fuel })),
    wrecks: wrecks.map(({ kind, vessel, form, site: at, district, offshore, x, z }) => ({ kind, vessel, form, site: at, district, offshore, x: Math.round(x - x0), z: Math.round(z - z0) })),
  }, null, 1) + "\n");
  if (aircraft.length + boats.length > 0) {
    const all = [...parked, ...aircraft, ...boats];
    map = { ...map, vehicles: all };
    put("vehicles.json", lines(all.map(v => ({ ...v, yaw: v.yaw * 360 / 65536 }))));
  }
  lap(`${aircraft.length} found aircraft at surveyed service sites and industrial yards; ${boats.length} boats at mapped waterfronts`);
  map = { ...map, tops: mapTops(map, reg) };
  lap(`the far feed's cells of ${map.tops!.chunks.length} chunks, for the overviews' tops`);
  // The roads' frame, for drawing the wear of their lanes (road-frame.ts), from the street data's pieces.
  map = { ...map, road: roadFrame(streetGraph(site), nx, nz, x0, z0) };
  lap(`the roads' frame on ${map.road!.across.reduce((n, v) => n + (v > 0 ? 1 : 0), 0)} of its 4 m samples`);
  const bytes = writeMap(map);
  // The file is the map from here on (the numbers below read it back): the map as built is let go first.
  map = undefined as unknown as typeof map;
  Bun.gc(true);
  const file = join(output, `${name}.snmap`);
  const built = (performance.now() - t0) / 1000;
  const packed = await writeMapFile(file, bytes, release);
  lap(`map file ${file} and its parts' files with their copies for the wire`);
  for (const line of [...describe(bytes), ...partsTable(packed)]) console.log(`        ${line}`);

  // The numbers: nodes by kind, how much land is walkable, the deepest water and the tallest heap.
  const parsed = parseMap(bytes);
  if (world.heaps === false) {
    const bridges = JSON.parse(readFileSync(join(source, "reports", world.ruins?.report ?? "ruins", "bridges.json"), "utf8")) as BridgeRecord[];
    const entrances = bridges.flatMap(r => r.entrances.map(e => ({ ...engine(e), id: r.id, name: r.name, slabs: e.slabs.map(engine), runout: e.runout?.map(engine) })));
    writeFileSync(file.replace(/\.snmap$/, ".entrances.json"), JSON.stringify({ mapHash: parsed.hash, entrances }, null, 2) + "\n");
  }
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
    for (let i = 0; i < nx * nz; i++) if (ground.surface[i] === value) m++;
    surfaces[key.toLowerCase()] = Math.round(m * 4);
  }
  // The tallest ruins as they stand, and for each a place on a street 60 to 140 m off to see it from.
  const top = new Float32Array(ground.heaps.ruins.length);
  for (let i = 0; i < nx * nz; i++) {
    const o = ground.heaps.owner[i]!;
    if (o >= 0 && ground.surface[i] !== S.SPILL) top[o] = Math.max(top[o]!, ground.heaps.lift[i]!);
  }
  const order = [...top.keys()].sort((a, b) => top[b]! - top[a]!);
  const landmarks = order.slice(0, 8).map((k) => {
    const b = ground.heaps.ruins[k]!.building;
    const [c0, r0] = [(b.e - grid.west) / 2, (grid.north - b.n) / 2];
    let best: [number, number] | null = null;
    for (let r = Math.round(r0) - 70; r <= r0 + 70 && !best; r++) {
      for (let c = Math.round(c0) - 70; c <= c0 + 70; c++) {
        const d = Math.hypot(c - c0, r - r0) * 2;
        const i = r * nx + c;
        if (d < 60 || d > 140 || r < 0 || c < 0 || r >= nz || c >= nx) continue;
        // Seen from where a person would stand: a sidewalk or a plaza, else the street.
        if ([S.SIDEWALK, S.PLAZA, S.STREET, S.HIGHWAY].includes(ground.surface[i]! as typeof S.STREET)) {
          best = [sizeX - c * 2, sizeZ - r * 2];
          break;
        }
      }
    }
    return { top: Number(top[k]!.toFixed(1)), x: Math.round(sizeX - c0 * 2), z: Math.round(sizeZ - r0 * 2), district: world.districts[ground.heaps.ruins[k]!.district - 1]?.name ?? "", from: best };
  });
  const stats = {
    id: world.id,
    bytes: bytes.length,
    firstFrameBrotli: packed.first.br,
    handOverBrotli: packed.first.city.br,
    brotli: wireBytes(packed, "br"),
    release,
    buildSeconds: Number(built.toFixed(1)),
    totalSeconds: Number(((performance.now() - t0) / 1000).toFixed(2)),
    peakResidentMiB: Number((process.resourceUsage().maxRSS / 1024).toFixed(1)),
    staticTotal,
    staticMaxChunk: packedMax,
    staticMaxChunkBeforePacking: maxChunk,
    vehicles: vehicles.length,
    deepestWater: Number(deepest.toFixed(2)),
    bedHeldAtFloor: below,
    highestGround: Number(highest.toFixed(2)),
    landmarks: staticTotal === 0 ? landmarks : [],
    ruins: ground.heaps.ruins.length,
    landShareWalkable: Number((walkable / land).toFixed(4)),
    landSquareMetres: land * 4,
    bridges: ground.bridges,
    ...(ground.lakes ? { lakes: ground.lakes.made.map((m) => ({ ...m, squareMetres: m.water * 4 })) } : {}),
    nodes: Object.fromEntries([...byKind.entries()].sort((a, b) => b[1] - a[1])),
    nodeTotal: [...byKind.values()].reduce((a, b) => a + b, 0),
    nodeSlotsTaken: taken,
    zoneCell: ZONE_CELL,
    spawns: spawns.map(engine),
    obelisks: obelisks.map((o) => ({ ...engine(o), yaw: Math.round((o.yaw * 360) / 65536), ground: Number(site.groundAt(o.x, o.z).toFixed(2)) })),
    regions: { count: regions.length, creaturesAt1x: regions.reduce((a, r) => a + r.count, 0), beach: regions.filter((r) => r.spawns === "core:spawns_beach").reduce((a, r) => a + r.count, 0) },
    surfaceSquareMetres: surfaces,
  };
  writeFileSync(join(output, name, "stats.json"), `${JSON.stringify(stats, null, 2)}\n`);
  lap("numbers");
  return { file, stats };
}

if (import.meta.main) {
  const words = process.argv.slice(2);
  const { stats } = await buildMap(words.find((w) => w !== "--release") ?? (() => { throw new Error("Map name required"); })(), words.includes("--release"));
  console.log(JSON.stringify({ ...stats, spawns: undefined, surfaceSquareMetres: undefined }, null, 2));
}
