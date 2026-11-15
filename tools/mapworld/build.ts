// A playable map from a painted map's base layers: bun tools/mapworld/build.ts [name]
//
// Reads assets/source/maps/<name>/base (its VALUES.md says what each layer holds) and world/world.json (the sea, the
// districts, where survivors arrive and where obelisks stand), writes the folder of layers tools/map.ts builds from to
// var/maps/<name>/layers, then the map file var/maps/<name>.snmap, and says what it holds. The same inputs give the same
// bytes.

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { chunkCount } from "../../shared/coords.ts";
import { mapHeightfield, mapNodes, parseMap, writeMap } from "../../shared/world/mapfile.ts";
import { obeliskStatics } from "../../shared/world/obelisks.ts";
import { describe } from "../map.ts";
import { readLayers, waterLayer } from "../map/layers.ts";
import { lakeSquares } from "./lakes.ts";
import { writeGrey } from "../map/png.ts";
import { Base } from "./base.ts";
import { makeGround, S, type World } from "./ground.ts";
import { makeNodes, ZONE_CELL } from "./nodes.ts";
import { placeObelisks, placeRegions, placeSpawns, staticCover } from "./places.ts";
import { STATIC_LAYERS, siteOf } from "./statics.ts";
import { makeTint } from "./tint.ts";
import { vocabulary } from "./ruin-vocabulary.ts";
import { growRuins } from "./ruin-growth.ts";

const ROOT = resolve(import.meta.dir, "../..");

export function buildMap(name: string): { file: string; stats: Record<string, unknown> } {
  const t0 = performance.now();
  const compiled = compileContent(CORE_CONTENT);
  if (!compiled.registry) throw new Error(compiled.errors.join("\n"));
  const reg = compiled.registry;
  const lap = (what: string): void => console.log(`${((performance.now() - t0) / 1000).toFixed(1).padStart(5)} s  ${what}`);
  const source = join(ROOT, "assets/source/maps", name);
  const base = new Base(source);
  const world = JSON.parse(readFileSync(join(source, "world/world.json"), "utf8")) as World;
  const n = base.n;
  const size = base.info.size_m;
  const chunks = base.info.chunks;

  const ground = makeGround(base, world, lap);
  lap("ground");
  const half = size / 2;
  const toSample = (lon: number, lat: number): [number, number] => {
    const [e, no] = base.tm.forward(lon, lat);
    return [(e + half) / 2, (half - no) / 2];
  };
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
  const obelisks = placeObelisks(ground, world, toSample, size, staticCover(layered, reg, n, size));
  const statics = [...layered, ...obelisks.flatMap((o) => obeliskStatics(reg, o, site.groundAt).map((p) => ({ ...p, yaw: (p.yaw * 360) / 65536 })))];
  lap(`${obelisks.length} obelisks`);
  const tint = makeTint(ground, world);
  lap("colour");
  const spawns = placeSpawns(ground, world, toSample, size);
  const regions = placeRegions(ground, size, spawns, world.easyAroundSpawns ?? 0);
  lap(`${spawns.length} spawn points, ${regions.length} spawn regions`);
  // Nothing grows within 8 m of a spawn point, so nobody arrives inside a tree, nor within 14 m of an obelisk's middle,
  // so none stands in it or before its terminal.
  const clearings = [...spawns.map((s) => [(size - s.x) / 2, (size - s.z) / 2, 16] as const), ...obelisks.map((o) => [(size - o.x) / 2, (size - o.z) / 2, 49] as const)];
  const growth = world.heaps === false ? vocabulary(source).growth : undefined;
  const nodes = makeNodes(ground, world, (col, row) => (!growth && site.clearPlants[Math.floor(row / 2) * ((n - 1) / 2) + Math.floor(col / 2)] === 1) || clearings.some(([c, r, d2]) => (c - col) ** 2 + (r - row) ** 2 < d2), (col, row) => site.lowPlants[Math.floor(row / 2) * ((n - 1) / 2) + Math.floor(col / 2)] === 1, growth);
  lap("nodes");

  const layers = join(ROOT, "var/maps", name, "layers");
  rmSync(layers, { recursive: true, force: true });
  mkdirSync(layers, { recursive: true });
  const put = (file: string, data: string | Uint8Array): void => writeFileSync(join(layers, file), data);
  put("map.json", `${JSON.stringify({ id: world.id, chunks: [chunks, chunks], minY: world.minY, stepY: world.stepY, seaLevel: world.sea === false ? null : 0 }, null, 2)}\n`);
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
  // Lakes above the sea as bodies of water, in squares of a sample.
  if (ground.lakes) {
    const water = waterLayer({ chunksX: chunks, chunksZ: chunks }, world.minY, world.stepY, 2, ground.lakes.bodies, lakeSquares(ground.lakes, n, 2));
    put("water.json", water.json);
    put("water.png", water.png);
  }
  lap(`layers in ${layers}`);

  let map = readLayers(layers);
  if (growth) {
    const grown = growRuins(map, compiled.registry, site, growth);
    map = { ...map, nodes: [grown.layer] };
    writeFileSync(join(source, "reports", world.ruins?.report ?? "ruins", "growth.json"), JSON.stringify(grown.summary, null, 2) + "\n");
    lap("growth placed around structures and routes");
  }
  const bytes = writeMap(map);
  const file = join(ROOT, "var/maps", `${name}.snmap`);
  writeFileSync(`${file}.tmp`, bytes);
  renameSync(`${file}.tmp`, file);
  const built = (performance.now() - t0) / 1000;
  lap(`map file ${file}`);
  for (const line of describe(bytes)) console.log(`        ${line}`);

  // The numbers: nodes by kind, how much land is walkable, the deepest water and the tallest heap.
  const parsed = parseMap(bytes);
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
    gzipped: Bun.gzipSync(bytes).length,
    buildSeconds: Number(built.toFixed(1)),
    totalSeconds: Number(((performance.now() - t0) / 1000).toFixed(2)),
    peakResidentMiB: Number((process.resourceUsage().maxRSS / 1024).toFixed(1)),
    staticTotal: statics.length,
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
  const { stats } = buildMap(process.argv[2] ?? (() => { throw new Error("Map name required"); })());
  console.log(JSON.stringify({ ...stats, spawns: undefined, surfaceSquareMetres: undefined }, null, 2));
}
