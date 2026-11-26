// A harbour for the marina tests: a quay to the west 0.6 m over a sea that falls to 8 m deep, a marina on its edge and a
// pier mapped from the quay out over the water, laid out as a city's build lays one (tools/boat/marinas.ts), its found
// vessels set in the slips held for them (tools/boat/sites.ts).

import { DOCK } from "../../content/docks.ts";
import { layMarinas, type MarinaLayout } from "../../tools/boat/marinas.ts";
import { boatSites, HARBOURS, type Berthed, type BoatSite, type Harbours } from "../../tools/boat/sites.ts";
import type { Box } from "../../tools/mapworld/ruin-obstacles.ts";
import type { StaticPiece } from "../../tools/mapworld/statics.ts";
import type { Path, Way } from "../../tools/mapworld/ways.ts";
import { Heightfield } from "../../shared/world/heightfield.ts";
import type { MapData } from "../../shared/world/mapfile.ts";
import type { Registry } from "../../shared/content/registry.ts";

export const QUAY = .6, EDGE = 200, DEEPEST = 8;
/** The ground: the quay, then the sea's bed falling from its edge. */
export const harbourGround = (x: number): number => x < EDGE ? QUAY : Math.max(-DEEPEST, QUAY - (x - EDGE) * .55);
export const MARINA: BoatSite = { id: "place/marina/Test_Marina@0,0", kind: "civilian", x: EDGE - 4, z: 256, radius: 120, waterfront: "marina" };

/** A pier way as ways.json gives one, from (x0, z0) to (x1, z1) in the map's metres. */
export function pierPath(id: number, points: [number, number][]): Path {
  const way: Way = { id, kind: "pier", name: null, class: null, lanes: null, layer: 1, width_m: null, closed: false, length_m: 0, points };
  return { way, points, width: 4, outline: false };
}

export interface Harbour { map: MapData; layout: MarinaLayout; found: Berthed[]; rules: Harbours }

/**
 * The harbour laid out by `rules`, its docks and moored boats among its statics and its found vessels among its vehicles;
 * `pieces` stand there first, and nothing stands in `keep`.
 */
export function marinaHarbour(reg: Registry, rules: Harbours = HARBOURS, docks: Path[] = [pierPath(1, [[EDGE - 6, 256], [EDGE + 96, 256]])], sites: BoatSite[] = [MARINA], pieces: StaticPiece[] = [], keep: Box[] = [], held?: Map<number, number>): Harbour {
  const hf = new Heightfield({ chunksX: 8, chunksZ: 8 }, 2, -32, 1 / 256);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) {
    hf.setSample(i, j, harbourGround(i * hf.cell));
    hf.tint[j * hf.nx + i] = i * hf.cell < EDGE + 4 ? 4 : 1;
  }
  const size = 8 * 64, chunk = (x: number, z: number): number => Math.floor(z / 64) * 8 + Math.floor(x / 64);
  const layout = layMarinas(sites, new Map([[MARINA.id, docks]]), [], rules, reg, pieces, {
    waterAt: () => 0, groundAt: (x) => harbourGround(x), inside: (x, z, r) => Math.min(x, z, size - x, size - z) > r,
    // `held`, where given, counts the pieces each chunk's room holds, as a city's build does.
    room: () => true, took: (x, z) => void held?.set(chunk(x, z), (held.get(chunk(x, z)) ?? 0) + 1), gave: (x, z) => void held?.set(chunk(x, z), held.get(chunk(x, z))! - 1), chunk,
  }, () => null, () => false, keep);
  const cleared = new Set(layout.cleared);
  const map: MapData = {
    id: "test:marina", dims: hf.dims, minY: hf.minY, stepY: hf.stepY, seaLevel: 0, heights: hf.heights, tint: hf.tint,
    statics: [...pieces.filter((_, i) => !cleared.has(i)), ...layout.pieces].map((p) => ({ kind: p.kind, x: p.x, y: p.y, z: p.z, yaw: Math.round(p.yaw * 65536 / 360) & 65535 })),
    nodes: [], spawns: [{ name: "Quay", x: 40, z: 256, yaw: 0 }],
  };
  const found = boatSites(map, reg, sites, rules, () => null, layout.slips);
  return { map: { ...map, vehicles: found.map(({ site: _s, district: _d, ...v }) => v) }, layout, found, rules };
}

/** The deck's height over the sea at the marina. */
export const DECK = DOCK.height;
