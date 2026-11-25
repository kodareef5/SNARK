import type { Registry } from "../../shared/content/registry.ts";
import { chunkCount } from "../../shared/coords.ts";
import { MapStatics, mapHeightfield, mapNodes, type MapData, type NodeLayer } from "../../shared/world/mapfile.ts";
import { nodeForms } from "../../shared/world/nodes.ts";
import { corridorIndex } from "./bridges.ts";
import { CellLists, SLACK } from "./cell-lists.ts";
import { S } from "./ground.ts";
import type { Site } from "./statics.ts";
import type { Vocabulary } from "./ruin-vocabulary.ts";

/** The side of the cells growth lists the pieces in, in metres. */
const FINE = 8;

/**
 * The map's scattered layers, resolved (resolveNodes), with every slot taken out besides whose node would stand in a
 * structure, a route or a canopy's way.
 */
export function growRuins(map: MapData, reg: Registry, site: Site, growth: Vocabulary["growth"]): { layers: NodeLayer[]; summary: Record<string, unknown> } {
  const hf = mapHeightfield(map); const source = mapNodes(map, hf, reg)!; const forms = nodeForms(reg);
  const layers = map.nodes.map((layer) => {
    if ("first" in layer) throw new Error("growth takes slots out of scattered layers, and this map lists its nodes");
    if (!layer.out || !layer.other) throw new Error("growth takes slots out of resolved layers: resolveNodes first");
    return { ...layer, out: layer.out.slice() };
  });
  const takeOut = (chunk: number, slot: number): void => {
    for (const layer of layers) {
      if (slot < layer.perChunk) {
        const bit = chunk * layer.perChunk + slot;
        layer.out[bit >> 3]! |= 1 << (bit & 7);
        return;
      }
      slot -= layer.perChunk;
    }
  };
  const statics = MapStatics.of(map.dims, map.statics);
  const kindsOf = Uint16Array.from(statics.kinds, (id) => reg.index.get(id)!);
  const cosines = new Float64Array(65536); const sines = new Float64Array(65536);
  for (let i = 0; i < 65536; i++) { const a = i * Math.PI * 2 / 65536; cosines[i] = Math.cos(a); sines[i] = Math.sin(a); }
  // A slot's test reads the pieces listed in the 64 m squares its circle meets, as it always has. The pieces are listed
  // in the 8 m cells their circles meet, and a piece found there is read only if it is in one of those squares.
  const reachOf = Float64Array.from(reg.halfX, (hx, k) => Math.hypot(hx, reg.halfZ[k]!));
  const developed = new Uint8Array(map.dims.chunksX * map.dims.chunksZ);
  const fine = new CellLists(map.dims.chunksX * 64, map.dims.chunksZ * 64, FINE);
  for (let i = 0; i < statics.length; i++) {
    const x = statics.x[i]!; const z = statics.z[i]!; const r = reachOf[kindsOf[statics.kind[i]!]!]!;
    for (let bz = Math.max(0, Math.floor((z - r) / 64)); bz <= Math.min(map.dims.chunksZ - 1, Math.floor((z + r) / 64)); bz++) for (let bx = Math.max(0, Math.floor((x - r) / 64)); bx <= Math.min(map.dims.chunksX - 1, Math.floor((x + r) / 64)); bx++) developed[bz * map.dims.chunksX + bx] = 1;
    fine.count(x, z, r);
  }
  fine.lay();
  for (let i = 0; i < statics.length; i++) fine.put(statics.x[i]!, statics.z[i]!, reachOf[kindsOf[statics.kind[i]!]!]!, i);
  const xs: number[] = []; const zs: number[] = [];
  /** The 64 m squares the test of a slot at (px, pz) reaching `r` reads, by the steps it has always taken. */
  const squares = (px: number, pz: number, r: number): void => {
    xs.length = 0; zs.length = 0;
    for (let zz = pz - r; zz <= pz + r + 64; zz += 64) zs.push(Math.floor(zz / 64));
    for (let xx = px - r; xx <= px + r + 64; xx += 64) xs.push(Math.floor(xx / 64));
  };
  const listed = (i: number): boolean => {
    const x = statics.x[i]!; const z = statics.z[i]!; const r = reachOf[kindsOf[statics.kind[i]!]!]!;
    const bx0 = Math.floor((x - r) / 64), bx1 = Math.floor((x + r) / 64), bz0 = Math.floor((z - r) / 64), bz1 = Math.floor((z + r) / 64);
    return xs.some((b) => b >= bx0 && b <= bx1) && zs.some((b) => b >= bz0 && b <= bz1);
  };
  // The site's routes are in lattice metres (Grid, base.ts), the map's in its own.
  const { x0, z0 } = site.ground.grid;
  const routes = corridorIndex(site.growthRoutes.flatMap((r) => r.points.slice(1).map((b, i) => ({ a: [r.points[i]!.x - x0, r.points[i]!.z - z0] as const, b: [b.x - x0, b.z - z0] as const, width: r.width, low: Math.min(r.points[i]!.y, b.y) - .1, high: Math.max(r.points[i]!.y, b.y) + 2.3 }))));
  const spot = { kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 };
  // A surface's name as a search of S in order finds it: the first that has its value.
  const surfaceNames = new Map<number, string>();
  for (const [name, v] of Object.entries(S)) if (!surfaceNames.has(v)) surfaceNames.set(v, name);
  const rejected = { structure: 0, route: 0, sight: 0, canopyStructure: 0, spawn: 0 }; const byDistrict: Record<string, number> = {}; const bySurface: Record<string, number> = {};
  const woodChunks = new Set<number>(); let candidates = 0; let admitted = 0;
  for (let chunk = 0; chunk < chunkCount(map.dims); chunk++) {
    for (let slot = 0; slot < source.perChunk; slot++) {
      source.at(chunk, slot, spot); if (!spot.kind) continue; candidates++;
      const { form, x: px, y: py, z: pz } = spot;
      const radius = Math.hypot(forms.halfX[form]!, forms.halfZ[form]!); const top = py + forms.halfY[form]!;
      if (map.spawns.some((s) => Math.hypot(px - s.x, pz - s.z) < 8 + radius)) { rejected.spawn++; takeOut(chunk, slot); continue; }
      // A piece in the way has its middle within its circle of the slot's square widened by its radius, turned any way.
      squares(px, pz, radius);
      let blocked = fine.some(px, pz, Math.SQRT2 * (radius + .2) + SLACK, (i) => {
        const k = kindsOf[statics.kind[i]!]!;
        if (py + .15 >= statics.y[i]! + reg.halfY[k]! || top <= statics.y[i]! - reg.halfY[k]!) return false;
        const c = cosines[statics.yaw[i]!]!; const s = sines[statics.yaw[i]!]!;
        const dx = px - statics.x[i]!; const dz = pz - statics.z[i]!;
        return Math.abs(dx * c - dz * s) < reg.halfX[k]! + radius + .2 && Math.abs(dx * s + dz * c) < reg.halfZ[k]! + radius + .2 && listed(i);
      });
      if (blocked) { rejected.structure++; takeOut(chunk, slot); continue; }
      if (routes.some({ x: px, z: pz, width: radius * 2 + 2, depth: radius * 2 + 2, c: 1, s: 0, yaw: 0, rings: [] }, (r) => {
        if (top < r.low || py > r.high) return false;
        const dx = r.b[0] - r.a[0]; const dz = r.b[1] - r.a[1]; const t = Math.max(0, Math.min(1, ((px - r.a[0]) * dx + (pz - r.a[1]) * dz) / (dx * dx + dz * dz || 1)));
        return Math.hypot(px - r.a[0] - dx * t, pz - r.a[1] - dz * t) < radius + r.width / 2;
      })) { rejected.route++; takeOut(chunk, slot); continue; }
      const id = reg.defs[spot.kind]!.id;
      const canopy = growth.canopy[id];
      if (canopy) {
        const reach = canopy[0] * forms.size[form]! / 64; const height = canopy[1] * forms.size[form]! / 64;
        const bottom = py + height * (growth.canopyBase[id] ?? .2);
        squares(px, pz, reach);
        blocked = fine.some(px, pz, Math.SQRT2 * (reach + .5) + SLACK, (i) => {
          const k = kindsOf[statics.kind[i]!]!;
          if (bottom >= statics.y[i]! + reg.halfY[k]! || py + height <= statics.y[i]! - reg.halfY[k]!) return false;
          const c = cosines[statics.yaw[i]!]!; const s = sines[statics.yaw[i]!]!;
          const dx = px - statics.x[i]!; const dz = pz - statics.z[i]!;
          const u = Math.max(0, Math.abs(dx * c - dz * s) - reg.halfX[k]!);
          const v = Math.max(0, Math.abs(dx * s + dz * c) - reg.halfZ[k]!);
          return u * u + v * v < (reach + .5) ** 2 && listed(i);
        });
        if (blocked) { rejected.canopyStructure++; takeOut(chunk, slot); continue; }
        if (routes.some({ x: px, z: pz, width: reach * 2, depth: reach * 2, c: 1, s: 0, yaw: 0, rings: [] }, (r) => {
          if (py + height < r.low || py > r.high) return false;
          const dx = r.b[0] - r.a[0]; const dz = r.b[1] - r.a[1]; const t = Math.max(0, Math.min(1, ((px - r.a[0]) * dx + (pz - r.a[1]) * dz) / (dx * dx + dz * dz || 1)));
          return Math.hypot(px - r.a[0] - dx * t, pz - r.a[1] - dz * t) < reach + r.width / 2;
        })) { rejected.sight++; takeOut(chunk, slot); continue; }
      }
      admitted++;
      const groundIndex = Math.round((map.dims.chunksZ * 64 - pz) / 2) * site.ground.grid.nx + Math.round((map.dims.chunksX * 64 - px) / 2);
      const district = site.world.districts[site.ground.district[groundIndex]! - 1]?.name ?? "Unzoned";
      const surface = surfaceNames.get(site.ground.surface[groundIndex]!) ?? "unknown";
      byDistrict[district] = (byDistrict[district] ?? 0) + 1; bySurface[surface] = (bySurface[surface] ?? 0) + 1;
      if (["core:tree", "core:palm", "core:fig", "core:banyan", "core:oak", "core:mangrove"].includes(id)) woodChunks.add(chunk);
    }
  }
  const urban = [...developed.keys()].filter((k) => developed[k] === 1);
  const urbanWood = urban.filter((k) => {
    const x = k % map.dims.chunksX; const z = Math.floor(k / map.dims.chunksX);
    return [-1, 0, 1].some((dz) => [-1, 0, 1].some((dx) => x + dx >= 0 && x + dx < map.dims.chunksX && z + dz >= 0 && z + dz < map.dims.chunksZ && woodChunks.has((z + dz) * map.dims.chunksX + x + dx)));
  }).length;
  return { layers, summary: { candidates, admitted, rejected, byDistrict, bySurface, woodChunks: woodChunks.size, developedChunks: urban.length, developedChunksWithWoodWithinOneChunk: urbanWood, roofResources: 0, roofPlants: { shrubs: ofKinds(statics, "_zshrub_"), trees: ofKinds(statics, "_zrooftree_") }, roofLimitation: "Resource nodes have no elevation; roof shrubs are statics until the map format supports raised nodes." } };
}

/** How many of the pieces are of a kind whose id holds `part`. */
function ofKinds(statics: MapStatics, part: string): number {
  const count = new Uint32Array(statics.kinds.length);
  for (let i = 0; i < statics.length; i++) count[statics.kind[i]!]!++;
  return statics.kinds.reduce((n, id, k) => n + (id.includes(part) ? count[k]! : 0), 0);
}
