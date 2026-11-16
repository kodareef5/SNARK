import type { Registry } from "../../shared/content/registry.ts";
import { chunkCount } from "../../shared/coords.ts";
import { MapStatics, mapHeightfield, mapNodes, type MapData, type NodeLayer } from "../../shared/world/mapfile.ts";
import { nodeForms } from "../../shared/world/nodes.ts";
import { corridorIndex } from "./bridges.ts";
import { S } from "./ground.ts";
import type { Site } from "./statics.ts";
import type { Vocabulary } from "./ruin-vocabulary.ts";

/** The map's scattered layers with every slot taken out whose node would stand in a structure, a route or a canopy's way. */
export function growRuins(map: MapData, reg: Registry, site: Site, growth: Vocabulary["growth"]): { layers: NodeLayer[]; summary: Record<string, unknown> } {
  const hf = mapHeightfield(map); const source = mapNodes(map, hf, reg)!; const forms = nodeForms(reg);
  const layers = map.nodes.map((layer) => {
    if ("first" in layer) throw new Error("growth takes slots out of scattered layers, and this map lists its nodes");
    return { ...layer, out: new Uint8Array(Math.ceil((chunkCount(map.dims) * layer.perChunk) / 8)) };
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
  const grid = new Map<number, number[]>();
  const key = (x: number, z: number): number => Math.floor(x / 64) + Math.floor(z / 64) * 1024;
  for (let i = 0; i < statics.length; i++) {
    const k = kindsOf[statics.kind[i]!]!; const r = Math.hypot(reg.halfX[k]!, reg.halfZ[k]!);
    for (let z = Math.floor((statics.z[i]! - r) / 64); z <= Math.floor((statics.z[i]! + r) / 64); z++) for (let x = Math.floor((statics.x[i]! - r) / 64); x <= Math.floor((statics.x[i]! + r) / 64); x++) {
      const k = x + z * 1024; if (!grid.has(k)) grid.set(k, []); grid.get(k)!.push(i);
    }
  }
  const routes = corridorIndex(site.growthRoutes.flatMap((r) => r.points.slice(1).map((b, i) => ({ a: [r.points[i]!.x, r.points[i]!.z] as const, b: [b.x, b.z] as const, width: r.width, low: Math.min(r.points[i]!.y, b.y) - .1, high: Math.max(r.points[i]!.y, b.y) + 2.3 }))));
  const spot = { kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 };
  const rejected = { structure: 0, route: 0, sight: 0, canopyStructure: 0, spawn: 0 }; const byDistrict: Record<string, number> = {}; const bySurface: Record<string, number> = {};
  const woodChunks = new Set<number>(); let candidates = 0; let admitted = 0;
  for (let chunk = 0; chunk < chunkCount(map.dims); chunk++) {
    for (let slot = 0; slot < source.perChunk; slot++) {
      source.at(chunk, slot, spot); if (!spot.kind) continue; candidates++;
      const { form, x: px, y: py, z: pz } = spot;
      const radius = Math.hypot(forms.halfX[form]!, forms.halfZ[form]!); const top = py + forms.halfY[form]!;
      if (map.spawns.some((s) => Math.hypot(px - s.x, pz - s.z) < 8 + radius)) { rejected.spawn++; takeOut(chunk, slot); continue; }
      let blocked = false;
      for (let zz = pz - radius; zz <= pz + radius + 64 && !blocked; zz += 64) for (let xx = px - radius; xx <= px + radius + 64 && !blocked; xx += 64) for (const i of grid.get(key(xx, zz)) ?? []) {
        const k = kindsOf[statics.kind[i]!]!;
        if (py + .15 >= statics.y[i]! + reg.halfY[k]! || top <= statics.y[i]! - reg.halfY[k]!) continue;
        const c = cosines[statics.yaw[i]!]!; const s = sines[statics.yaw[i]!]!;
        const dx = px - statics.x[i]!; const dz = pz - statics.z[i]!;
        if (Math.abs(dx * c - dz * s) < reg.halfX[k]! + radius + .2 && Math.abs(dx * s + dz * c) < reg.halfZ[k]! + radius + .2) { blocked = true; break; }
      }
      if (blocked) { rejected.structure++; takeOut(chunk, slot); continue; }
      const near = routes({ x: px, z: pz, width: radius * 2 + 2, depth: radius * 2 + 2, c: 1, s: 0, yaw: 0, rings: [] });
      if (near.some((r) => {
        if (top < r.low || py > r.high) return false;
        const dx = r.b[0] - r.a[0]; const dz = r.b[1] - r.a[1]; const t = Math.max(0, Math.min(1, ((px - r.a[0]) * dx + (pz - r.a[1]) * dz) / (dx * dx + dz * dz || 1)));
        return Math.hypot(px - r.a[0] - dx * t, pz - r.a[1] - dz * t) < radius + r.width / 2;
      })) { rejected.route++; takeOut(chunk, slot); continue; }
      const id = reg.defs[spot.kind]!.id;
      const canopy = growth.canopy[id];
      if (canopy) {
        const reach = canopy[0] * forms.size[form]! / 64; const height = canopy[1] * forms.size[form]! / 64;
        const bottom = py + height * (growth.canopyBase[id] ?? .2);
        for (let zz = pz - reach; zz <= pz + reach + 64 && !blocked; zz += 64) for (let xx = px - reach; xx <= px + reach + 64 && !blocked; xx += 64) for (const i of grid.get(key(xx, zz)) ?? []) {
          const k = kindsOf[statics.kind[i]!]!;
          if (bottom >= statics.y[i]! + reg.halfY[k]! || py + height <= statics.y[i]! - reg.halfY[k]!) continue;
          const c = cosines[statics.yaw[i]!]!; const s = sines[statics.yaw[i]!]!;
          const dx = px - statics.x[i]!; const dz = pz - statics.z[i]!;
          const u = Math.max(0, Math.abs(dx * c - dz * s) - reg.halfX[k]!);
          const v = Math.max(0, Math.abs(dx * s + dz * c) - reg.halfZ[k]!);
          if (u * u + v * v < (reach + .5) ** 2) { blocked = true; break; }
        }
        if (blocked) { rejected.canopyStructure++; takeOut(chunk, slot); continue; }
        if (routes({ x: px, z: pz, width: reach * 2, depth: reach * 2, c: 1, s: 0, yaw: 0, rings: [] }).some((r) => {
          if (py + height < r.low || py > r.high) return false;
          const dx = r.b[0] - r.a[0]; const dz = r.b[1] - r.a[1]; const t = Math.max(0, Math.min(1, ((px - r.a[0]) * dx + (pz - r.a[1]) * dz) / (dx * dx + dz * dz || 1)));
          return Math.hypot(px - r.a[0] - dx * t, pz - r.a[1] - dz * t) < reach + r.width / 2;
        })) { rejected.sight++; takeOut(chunk, slot); continue; }
      }
      admitted++;
      const groundIndex = Math.round((map.dims.chunksZ * 64 - pz) / 2) * site.ground.n + Math.round((map.dims.chunksX * 64 - px) / 2);
      const district = site.world.districts[site.ground.district[groundIndex]! - 1]?.name ?? "Unzoned";
      const surface = Object.entries(S).find(([, v]) => v === site.ground.surface[groundIndex])?.[0] ?? "unknown";
      byDistrict[district] = (byDistrict[district] ?? 0) + 1; bySurface[surface] = (bySurface[surface] ?? 0) + 1;
      if (["core:tree", "core:palm", "core:fig", "core:banyan", "core:oak", "core:mangrove"].includes(id)) woodChunks.add(chunk);
    }
  }
  const urban = [...grid.keys()].filter((k) => { const x = k % 1024; const z = Math.floor(k / 1024); return x >= 0 && z >= 0 && x < map.dims.chunksX && z < map.dims.chunksZ; });
  const urbanWood = urban.filter((k) => {
    const x = k % 1024; const z = Math.floor(k / 1024);
    return [-1, 0, 1].some((dz) => [-1, 0, 1].some((dx) => x + dx >= 0 && x + dx < map.dims.chunksX && z + dz >= 0 && z + dz < map.dims.chunksZ && woodChunks.has((z + dz) * map.dims.chunksX + x + dx)));
  }).length;
  return { layers, summary: { candidates, admitted, rejected, byDistrict, bySurface, woodChunks: woodChunks.size, developedChunks: urban.length, developedChunksWithWoodWithinOneChunk: urbanWood, roofResources: 0, roofPlants: { shrubs: statics.filter((p) => p.kind.includes("_zshrub_")).length, trees: statics.filter((p) => p.kind.includes("_zrooftree_")).length }, roofLimitation: "Resource nodes have no elevation; roof shrubs are statics until the map format supports raised nodes." } };
}
