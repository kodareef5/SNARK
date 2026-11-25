// A playable map from a city's base layers: bun tools/mapworld/build.ts <name or folder> [--release] [--out DIR]
//
// Reads the city's work folder (tools/maps/work.ts; tools/maps/city.ts runs this as its last stage), or a folder named by
// a path (its last part the map's name): base/ (its VALUES.md says what each layer holds) and world/world.json (the sea, the
// districts, where survivors arrive and where obelisks stand), writes the folder of layers tools/map.ts builds from to
// var/maps/<name>/layers, then the map file var/maps/<name>.snmap, and says what it holds. The same inputs give the same
// bytes. Its copies for the wire take a few seconds; --release writes the tightest, as a map that ships has (tools/map/pack.ts).

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { SECTOR_CHUNKS, chunkCount, framed } from "../../shared/coords.ts";
import { MapStatics, mapHeightfield, mapNodes, mapTops, parseMap, resolveNodes, writeMap } from "../../shared/world/mapfile.ts";
import { obeliskStatics } from "../../shared/world/obelisks.ts";
import { describe } from "../map.ts";
import { readLayers, toYaw, waterLayer, writeAttached, writeNodeLayers } from "../map/layers.ts";
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
import { planStreets } from "./streets/plan.ts";
import { makeTint } from "./tint.ts";
import { vocabulary } from "./ruin-vocabulary.ts";
import { helicopterSites, type HelicopterSite } from "../helicopter/sites.ts";
import { boatSites, HARBOURS, mappedBoatSites } from "../boat/sites.ts";
import { harbourWrecks, vehicleMeshes } from "../boat/wrecks.ts";
import { layMarinas, marinaDocks } from "../boat/marinas.ts";
import { pathsOf, readWays } from "./ways.ts";
import type { BuildingLabel, PublicPlace } from "./labels.ts";
import { growRuins } from "./ruin-growth.ts";
import { landmarkDefs, landmarksOf, layLandmarkGround, placeLandmarks } from "./landmarks.ts";
import { workFolder } from "../maps/work.ts";
import { encodeKnown, knownPlaces, mapBuildings, orderPieces, type KnownPlaces } from "./buildings.ts";
import type { Buildings } from "../../shared/world/buildings.ts";

const ROOT = resolve(import.meta.dir, "../..");

/** Which cut and build key made a map, beside it as `<name>/stamp.json`: tools/maps/city.ts builds again unless they are its own. */
export interface MapStamp { cut: string; key: string; bytes: number; mtimeMs: number }

export async function buildMap(named: string, release = false, output = join(ROOT, "var/maps"), options: { streets?: boolean; stamp?: { cut: string; key: string } } = {}): Promise<{ file: string; stats: Record<string, unknown> }> {
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
  // The map about to be written is no longer the one any stamp names, even if this build dies.
  const stampPath = join(output, name, "stamp.json");
  rmSync(stampPath, { force: true });
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
  // The streets as lines, fitted, typed by the rules and the city's overlay (streets/plan.ts): the ground is painted from
  // their sections, and the map carries them in its streets parts.
  // With `streets` false, as before them: no part, and the ground painted from the data's masks and the corners alone.
  const streets = options.streets === false ? null : planStreets(source, base, world, world.heaps === false ? (vocabulary(source) as Parameters<typeof planStreets>[3]) : null, join(source, "reports", world.ruins?.report ?? "ruins"), (line) => console.log(`        ${line}`));
  lap(`the streets: ${streets?.parts.length ?? 0} parts`);
  const ground = makeGround(base, world, lap, corners, streets?.held ?? null);
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
  const inside = (x: number, z: number, reach: number): boolean => Math.min(x - x0, z - z0, x1 - x, z1 - z) > reach;
  // The marinas' docks and what moors at them (tools/boat/marinas.ts), then the wrecks, which keep clear of both.
  const latticeSites = mappedBoatSites(waterfrontPlaces, waterfrontLabels, site.toLattice);
  const docks = marinaDocks(site, harbours.docks), docked = new Set([...docks.values()].flat().map((p) => p.way.id));
  const report = join(source, "reports", world.ruins?.report ?? "ruins");
  const records = existsSync(join(report, "bridges.json")) ? JSON.parse(readFileSync(join(report, "bridges.json"), "utf8")) as BridgeRecord[] : null;
  const piersBuilt = records ? new Set(records.filter((r) => r.kind === "pier" && r.status === "built").map((r) => r.id)) : null;
  const piers = pathsOf(readWays(source), grid).paths.filter((p) => p.way.kind === "pier" && !docked.has(p.way.id) && (piersBuilt?.has(p.way.id) ?? true));
  // The swim lanes under the bridges' decks, which the bridge walk swims: as the ruins deepen them (ruins.ts), 3 m either
  // side of the line and 2 m past each end, from 2.5 m under the water to a metre over it.
  const lanes = (records ?? []).flatMap((r) => r.swim.map((s) => ({ x: s.x, y: -.75, z: s.z, yaw: Math.atan2(s.dx, s.dz) * 180 / Math.PI, size: [6, 3.5, s.distance * 2 + 4] as const })));
  const marinas = layMarinas(latticeSites, docks, piers, harbours, reg, statics, {
    waterAt: site.waterAt, groundAt: site.groundAt, inside, chunk: chunkOf,
    room: (x, z) => pieceCounts[chunkOf(x, z)]! < budget - 2, took: (x, z) => { pieceCounts[chunkOf(x, z)]!++; },
  }, districtAt, (mesh) => meshes.has(mesh), lanes);
  // The street's furniture where a dock comes ashore is taken up, the last first so the others keep their places.
  for (const i of [...new Set(marinas.cleared)].sort((a, b) => b - a)) { pieceCounts[chunkOf(statics[i]!.x, statics[i]!.z)]!--; statics.splice(i, 1); }
  for (const p of marinas.pieces) statics.push(p);
  lap(`${marinas.runs.length} runs of dock and ${marinas.slips.length} boats moored at ${docks.size} marinas' mapped piers and ${marinas.slipped.size} marinas in all; ${marinas.pieces.length} pieces`);
  const wrecks = harbourWrecks(latticeSites, harbours, reg, statics, {
    waterAt: site.waterAt, groundAt: site.groundAt, inside, room: (x, z) => pieceCounts[chunkOf(x, z)]! < budget - 1,
  }, districtAt, (mesh) => meshes.has(mesh), undefined, marinas.slipped);
  for (const w of wrecks) { statics.push({ kind: w.kind, x: w.x, y: w.y, z: w.z, yaw: w.yaw }); pieceCounts[chunkOf(w.x, w.z)]!++; }
  wrecks.push(...marinas.wrecks);
  lap(`${wrecks.length} wrecks in the harbours, ${marinas.wrecks.length} of them in slips`);
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
  // Each building's pieces by storey, which only reorders them among themselves, and the runs of slots they will take.
  let buildings: Buildings | null = null;
  let known: KnownPlaces | null = null;
  {
    const ordered = orderPieces(statics, site.buildings);
    for (let i = 0; i < statics.length; i++) statics[i] = ordered.pieces[i]!;
    if (site.buildings.length > 0) buildings = mapBuildings({ chunksX, chunksZ, frameX: base.info.frame[0], frameZ: base.info.frame[1] }, site.buildings, ordered, x0, z0);
    if (buildings) known = knownPlaces({ chunksX, chunksZ }, ordered, x0, z0);
  }
  if (buildings) lap(`${site.buildings.length} buildings, ${buildings.count} rows of them in ${buildings.sectors.filter((t) => t).length} sectors`);
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
  const orbs = site.orbs.map((o) => ({ ...engine(o), y: o.y ?? site.groundAt(o.x, o.z) }));
  put("map.json", `${JSON.stringify({ id: world.id, chunks: [chunksX, chunksZ], frame: [sits.frameX, sits.frameZ], origin, ...(tideEyes.length ? { tideEyes } : {}), ...(orbs.length ? { orbs } : {}), minY: world.minY, stepY: world.stepY, seaLevel: world.sea === false ? null : 0 }, null, 2)}\n`);
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
      chunk += `${i > 0 ? ",\n" : ""}  ${JSON.stringify(engine(p.bend ? { ...p, bend: Array.from(p.bend) } : p))}`;
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
  let map = readLayers(layers, statics.map((p) => ({ kind: p.kind, x: p.x - x0, y: p.y, z: p.z - z0, yaw: toYaw(p.yaw), ...(p.bend ? { bend: p.bend } : {}) })));
  map = { ...map, statics: MapStatics.of(map.dims, map.statics), ...(buildings ? { buildings } : {}), ...(sited.length > 0 ? { content: { ...brought.content, landmarks: brought.content.landmarks.map(engine) } } : {}) };
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
  const slips = marinas.slips.map((s) => ({ ...s, x: s.x - x0, z: s.z - z0, dock: s.dock ? { ...s.dock, x: s.dock.x - x0, z: s.dock.z - z0 } : null }));
  const berthed = boatSites({ ...map, vehicles: [...parked, ...aircraft] }, reg, mappedBoatSites(waterfrontPlaces, waterfrontLabels, (e, n) => { const [x, z] = site.toLattice(e, n); return [x - x0, z - z0]; }), harbours, (x, z) => districtAt(x + x0, z + z0), slips);
  const boats = berthed.map(({ site: _site, district: _district, ...v }) => v);
  if (world.heaps === false) {
    writeFileSync(join(report, "harbours.json"), JSON.stringify({
      vessels: berthed.map(({ id, kind, site: at, district, x, z, condition, fuel }) => ({ id, kind, site: at, district, x: Math.round(x), z: Math.round(z), condition, fuel })),
      wrecks: wrecks.map(({ kind, vessel, form, site: at, district, offshore, x, z }) => ({ kind, vessel, form, site: at, district, offshore, x: Math.round(x - x0), z: Math.round(z - z0) })),
    }, null, 1) + "\n");
    // What the dock walk (tools/mapworld/dock-walk.ts) walks and boards: each run's deck points, and each slip with the
    // place on its dock a survivor boards from, in the map's metres; which slips' vessels are found, by their berth.
    const at = (p: { x: number; z: number }): [number, number] => [Math.round(p.x * 100) / 100, Math.round(p.z * 100) / 100];
    writeFileSync(join(report, "marinas.json"), JSON.stringify({
      refused: marinas.refused,
      runs: marinas.runs.map((r) => ({ ...r, points: r.points.map((p) => [...at({ x: p.x - x0, z: p.z - z0 }), Math.round(p.y * 64) / 64]) })),
      slips: slips.map((s) => ({ ...s, x: at(s)[0], z: at(s)[1], dock: s.dock ? [...at(s.dock), s.dock.y] : null, held: s.found ? berthed.find((b) => b.site === s.site && Math.hypot(b.x - s.x, b.z - s.z) < .01)?.id ?? null : undefined })),
    }) + "\n");
  }
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
  if (streets && streets.parts.length > 0) map = { ...map, streets: streets.parts };
  // What the map has that its layers did not when they were read: its streets' parts, its roads' frame, its landmarks
  // and, where they grew, its nodes, so the folder of layers builds this map (tools/map.ts build).
  writeAttached(map, layers);
  if (growth) writeNodeLayers(map, layers);
  const bytes = writeMap(map);
  // The file is the map from here on (the numbers below read it back): the map as built is let go first.
  map = undefined as unknown as typeof map;
  Bun.gc(true);
  const file = join(output, `${name}.snmap`);
  const built = (performance.now() - t0) / 1000;
  const packed = await writeMapFile(file, bytes, release);
  // The tile and storey each piece was placed at, which the map does not hold, for the check of its buildings (building-places.ts).
  if (known) writeFileSync(join(output, name, "known.bin"), encodeKnown(known));
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
    // The buildings section: its rows (a building in two sectors has two), its parts' bytes raw and on the wire, and the table a server holds.
    ...(parsed.buildings ? { buildings: { made: site.buildings.length, rows: parsed.buildings.count, bytes: packed.parts.filter((p) => p.kind === "buildings").reduce((n, p) => n + p.bytes.length, 0), brotli: packed.parts.filter((p) => p.kind === "buildings").reduce((n, p) => n + p.br.length, 0), memory: parsed.buildings.bytes } } : {}),
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
  if (options.stamp) {
    const made = statSync(file);
    const stamp: MapStamp = { ...options.stamp, bytes: made.size, mtimeMs: made.mtimeMs };
    writeFileSync(stampPath, `${JSON.stringify(stamp, null, 2)}\n`);
  }
  lap("numbers");
  return { file, stats };
}

if (import.meta.main) {
  // --out <folder> writes the map and its layers there, not var/maps: a cut's build (cut.ts) keeps out of the cities'.
  // --no-streets builds it as before the streets' lines, to compare.
  const words = process.argv.slice(2), out = words.indexOf("--out");
  const output = out >= 0 ? resolve(words[out + 1] ?? "") : join(ROOT, "var/maps");
  const named = words.filter((w, k) => !w.startsWith("--") && (out < 0 || k !== out + 1))[0];
  // tools/maps/city.ts names the cut and the build's key in SNARK_MAP_STAMP ({"cut", "key"}).
  const stamp = process.env.SNARK_MAP_STAMP ? (JSON.parse(process.env.SNARK_MAP_STAMP) as { cut: string; key: string }) : undefined;
  const { stats } = await buildMap(named ?? (() => { throw new Error("Map name required"); })(), words.includes("--release"), output, { streets: !words.includes("--no-streets"), stamp });
  console.log(JSON.stringify({ ...stats, spawns: undefined, surfaceSquareMetres: undefined }, null, 2));
}
