import type { Registry } from "../../shared/content/registry.ts";
import { chunkCount, chunkCx, chunkCz } from "../../shared/coords.ts";
import { mapHeightfield, mapNodes, type MapData, type NodeList } from "../../shared/world/mapfile.ts";
import { formOf, mix, nodeForms } from "../../shared/world/nodes.ts";
import { corridorIndex } from "./bridges.ts";
import { S } from "./ground.ts";
import type { Site } from "./statics.ts";
import type { Vocabulary } from "./ruin-vocabulary.ts";

/** Freeze only safe scatter candidates. Their listed form is tested, since changing layer changes the form hash. */
export function growRuins(map: MapData, reg: Registry, site: Site, growth: Vocabulary["growth"]): { layer: NodeList; summary: Record<string, unknown> } {
  const hf = mapHeightfield(map); const source = mapNodes(map, hf, reg)!; const forms = nodeForms(reg);
  const grid = new Map<number, number[]>();
  const key = (x: number, z: number): number => Math.floor(x / 64) + Math.floor(z / 64) * 1024;
  for (const [i, p] of map.statics.entries()) {
    const k = reg.index.get(p.kind)!; const r = Math.hypot(reg.halfX[k]!, reg.halfZ[k]!);
    for (let z = Math.floor((p.z - r) / 64); z <= Math.floor((p.z + r) / 64); z++) for (let x = Math.floor((p.x - r) / 64); x <= Math.floor((p.x + r) / 64); x++) {
      const k = x + z * 1024; if (!grid.has(k)) grid.set(k, []); grid.get(k)!.push(i);
    }
  }
  const routes = corridorIndex(site.growthRoutes.flatMap((r) => r.points.slice(1).map((b, i) => ({ a: [r.points[i]!.x, r.points[i]!.z] as const, b: [b.x, b.z] as const, width: r.width, low: Math.min(r.points[i]!.y, b.y) - .1, high: Math.max(r.points[i]!.y, b.y) + 2.3 }))));
  const spot = { kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 };
  const kinds: string[] = []; const kindIds = new Map<number, number>();
  const list: { k: number; x: number; z: number; yaw: number }[] = [];
  const first = new Uint32Array(chunkCount(map.dims) + 1);
  const rejected = { structure: 0, route: 0, sight: 0, spawn: 0 }; const byDistrict: Record<string, number> = {}; const bySurface: Record<string, number> = {};
  const woodChunks = new Set<number>(); let candidates = 0;
  for (let chunk = 0; chunk < chunkCount(map.dims); chunk++) {
    first[chunk] = list.length; const cx = chunkCx(map.dims, chunk) * 64; const cz = chunkCz(map.dims, chunk) * 64;
    for (let slot = 0; slot < source.perChunk; slot++) {
      source.at(chunk, slot, spot); if (!spot.kind) continue; candidates++;
      const x = Math.min(65535, Math.round((spot.x - cx) * 1024)); const z = Math.min(65535, Math.round((spot.z - cz) * 1024));
      const index = list.length - first[chunk]!; const form = formOf(forms, spot.kind, mix(chunk * 256 + index, x | (z << 16), spot.yaw));
      const px = cx + x / 1024; const pz = cz + z / 1024; const py = hf.heightAt(px, pz);
      const radius = Math.hypot(forms.halfX[form]!, forms.halfZ[form]!); const top = py + forms.halfY[form]!;
      if (map.spawns.some((s) => Math.hypot(px - s.x, pz - s.z) < 8 + radius)) { rejected.spawn++; continue; }
      let blocked = false;
      for (let zz = pz - radius; zz <= pz + radius + 64 && !blocked; zz += 64) for (let xx = px - radius; xx <= px + radius + 64 && !blocked; xx += 64) for (const i of grid.get(key(xx, zz)) ?? []) {
        const p = map.statics[i]!; const k = reg.index.get(p.kind)!;
        if (py + .15 >= p.y + reg.halfY[k]! || top <= p.y - reg.halfY[k]!) continue;
        const angle = p.yaw * Math.PI * 2 / 65536; const c = Math.cos(angle); const s = Math.sin(angle);
        const dx = px - p.x; const dz = pz - p.z;
        if (Math.abs(dx * c - dz * s) < reg.halfX[k]! + radius + .2 && Math.abs(dx * s + dz * c) < reg.halfZ[k]! + radius + .2) { blocked = true; break; }
      }
      if (blocked) { rejected.structure++; continue; }
      const near = routes({ x: px, z: pz, width: radius * 2 + 2, depth: radius * 2 + 2, c: 1, s: 0, yaw: 0, rings: [] });
      if (near.some((r) => {
        if (top < r.low || py > r.high) return false;
        const dx = r.b[0] - r.a[0]; const dz = r.b[1] - r.a[1]; const t = Math.max(0, Math.min(1, ((px - r.a[0]) * dx + (pz - r.a[1]) * dz) / (dx * dx + dz * dz || 1)));
        return Math.hypot(px - r.a[0] - dx * t, pz - r.a[1] - dz * t) < radius + r.width / 2;
      })) { rejected.route++; continue; }
      const id = reg.defs[spot.kind]!.id;
      const canopy = growth.canopy[id];
      if (canopy) {
        const reach = canopy[0] * forms.size[form]! / 64; const height = canopy[1] * forms.size[form]! / 64;
        if (routes({ x: px, z: pz, width: reach * 2, depth: reach * 2, c: 1, s: 0, yaw: 0, rings: [] }).some((r) => {
          if (py + height < r.low || py > r.high) return false;
          const dx = r.b[0] - r.a[0]; const dz = r.b[1] - r.a[1]; const t = Math.max(0, Math.min(1, ((px - r.a[0]) * dx + (pz - r.a[1]) * dz) / (dx * dx + dz * dz || 1)));
          return Math.hypot(px - r.a[0] - dx * t, pz - r.a[1] - dz * t) < reach + r.width / 2;
        })) { rejected.sight++; continue; }
      }
      let k = kindIds.get(spot.kind); if (k === undefined) { k = kinds.length; kindIds.set(spot.kind, k); kinds.push(id); }
      list.push({ k, x, z, yaw: spot.yaw });
      const groundIndex = Math.round((map.dims.chunksZ * 64 - pz) / 2) * site.ground.n + Math.round((map.dims.chunksX * 64 - px) / 2);
      const district = site.world.districts[site.ground.district[groundIndex]! - 1]?.name ?? "Unzoned";
      const surface = Object.entries(S).find(([, v]) => v === site.ground.surface[groundIndex])?.[0] ?? "unknown";
      byDistrict[district] = (byDistrict[district] ?? 0) + 1; bySurface[surface] = (bySurface[surface] ?? 0) + 1;
      if (["core:tree", "core:palm", "core:fig", "core:banyan", "core:oak", "core:mangrove"].includes(id)) woodChunks.add(chunk);
    }
  }
  first[chunkCount(map.dims)] = list.length;
  const urban = [...grid.keys()].filter((k) => { const x = k % 1024; const z = Math.floor(k / 1024); return x >= 0 && z >= 0 && x < map.dims.chunksX && z < map.dims.chunksZ; });
  const urbanWood = urban.filter((k) => {
    const x = k % 1024; const z = Math.floor(k / 1024);
    return [-1, 0, 1].some((dz) => [-1, 0, 1].some((dx) => x + dx >= 0 && x + dx < map.dims.chunksX && z + dz >= 0 && z + dz < map.dims.chunksZ && woodChunks.has((z + dz) * map.dims.chunksX + x + dx)));
  }).length;
  return { layer: { kinds, first, kind: Uint8Array.from(list, (r) => r.k), x: Uint16Array.from(list, (r) => r.x), z: Uint16Array.from(list, (r) => r.z), yaw: Uint16Array.from(list, (r) => r.yaw) }, summary: { candidates, admitted: list.length, rejected, byDistrict, bySurface, woodChunks: woodChunks.size, developedChunks: urban.length, developedChunksWithWoodWithinOneChunk: urbanWood, roofResources: 0, roofPlants: { shrubs: map.statics.filter((p) => p.kind.includes("_zshrub_")).length, trees: map.statics.filter((p) => p.kind.includes("_zrooftree_")).length }, roofLimitation: "Listed resource nodes have no elevation; roof shrubs and trees are statics until the map format supports raised nodes." } };
}
