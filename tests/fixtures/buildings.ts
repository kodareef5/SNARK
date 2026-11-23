import { CHUNK_SIZE, YAW_UNITS } from "../../shared/coords.ts";
import { TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import type { Buildings } from "../../shared/world/buildings.ts";
import type { MapData, MapStatic } from "../../shared/world/mapfile.ts";
import { knownPlaces, mapBuildings, orderPieces, type KnownPlaces, type SiteBuilding } from "../../tools/mapworld/buildings.ts";
import { knownOf, own, type Known } from "../../tools/mapworld/known.ts";
import { Mason, compactWalls, reserveRoutes, type Frame } from "../../tools/mapworld/ruin-geometry.ts";
import { layout } from "../../tools/mapworld/ruin-layouts.ts";
import type { Rule } from "../../tools/mapworld/ruin-vocabulary.ts";
import type { StaticPiece } from "../../tools/mapworld/statics.ts";

/** A small city: its map, and what its maker knew of each static in the map's order. */
export interface BuiltCity {
  readonly map: MapData & { readonly buildings: Buildings };
  readonly buildings: readonly SiteBuilding[];
  /** The statics as the map lists them, and for each its building's place among `buildings` or -1, its storey, and what the layout knew. */
  readonly statics: readonly MapStatic[];
  readonly of: Int32Array;
  readonly storey: Uint8Array;
  readonly known: readonly (Known | null)[];
  /** The same by chunk and slot, as the build keeps it beside a map. */
  readonly places: KnownPlaces;
}

const frame = (x: number, z: number, degrees: number, width: number, depth: number): Frame => ({
  x, z, yaw: degrees, c: Math.cos((degrees * Math.PI) / 180), s: Math.sin((degrees * Math.PI) / 180), width, depth,
  rings: [[[-width / 2, -depth / 2], [width / 2, -depth / 2], [width / 2, depth / 2], [-width / 2, depth / 2], [-width / 2, -depth / 2]]],
});
const rule = (recipe: string, height: number, bay: number): Rule => ({ recipe, height, finish: "concrete", feature: "frame", holes: 0.35, wall: 0.35, bay, matched: [], provisional: true });

/**
 * Three buildings the ruins' own layouts made, on flat ground of 6 by 3 chunks that two sectors hold: a tower of six
 * storeys, a block of flats turned 30 degrees that stands across the sectors' edge, and a house on the 4 m grid; with
 * street pieces before, between and after them that are no building's. The pieces are in the order a city's build writes
 * them (tools/mapworld/buildings.ts).
 */
export function builtCity(): BuiltCity {
  const dims = { chunksX: 6, chunksZ: 3, frameX: 2044, frameZ: 2048 };
  const [nx, nz] = [(dims.chunksX * CHUNK_SIZE) / TERRAIN_CELL + 1, (dims.chunksZ * CHUNK_SIZE) / TERRAIN_CELL + 1];
  const plans = [
    { frame: frame(128, 96, 0, 40, 40), rule: rule("tower", 24, 8), kind: "tower_office", name: "Bâoli Tower", address: "5700 Northwest 10th Avenue", seed: 7 },
    { frame: frame(256, 96, 30, 48, 24), rule: rule("apartment", 12, 8), kind: "apartment_block", name: null, address: "Ocean Drive", seed: 11 },
    { frame: frame(330, 60, 75, 13, 9), rule: rule("house", 8, 4), kind: "house", name: null, address: null, seed: 13 },
  ];
  const loose = (x: number, z: number): StaticPiece => ({ kind: "core:crate", x, y: 0, z, yaw: 0 });
  const pieces: StaticPiece[] = [loose(100, 80)];
  const buildings: SiteBuilding[] = [];
  plans.forEach((p, k) => {
    const m = new Mason(p.frame, 0.5);
    layout(m, p.rule, { seed: p.seed, playable: 8, detail: 0 });
    reserveRoutes(m);
    compactWalls(m);
    for (const piece of m.pieces) own(piece, k);
    pieces.push(...m.pieces, loose(140 + k * 60, 100));
    buildings.push({
      id: 1000 + k * 2 ** 33, kind: p.kind, recipe: p.rule.recipe, form: p.rule.recipe, district: k === 2 ? "Unzoned" : "Downtown", collapse: "shear", storeys: m.floors, playable: m.walked, roof: m.roof,
      named: k === 0, name: p.name, address: p.address, x: p.frame.x, z: p.frame.z, yaw: p.frame.yaw, bay: m.bay, cols: m.cols, rows: m.rows, width: p.frame.width, depth: p.frame.depth, base: 0.5, stairs: m.stairsAt,
    });
  });
  const ordered = orderPieces(pieces, buildings);
  const statics = ordered.pieces.map((p): MapStatic => ({ kind: p.kind, x: p.x, y: p.y, z: p.z, yaw: Math.round((p.yaw / 360) * YAW_UNITS) & (YAW_UNITS - 1) }));
  const map = {
    id: "test:built",
    dims,
    minY: -32,
    stepY: 1 / 256,
    seaLevel: -Infinity,
    heights: new Uint16Array(nx * nz).fill(32 * 256),
    tint: new Uint8Array(nx * nz).fill(1),
    statics,
    nodes: [],
    spawns: [{ name: "Middle", x: 190, z: 20, yaw: 0 }],
    buildings: mapBuildings(dims, buildings, ordered, 0, 0),
  };
  return { map, buildings, statics, of: ordered.of, storey: ordered.storey, known: ordered.pieces.map((p) => knownOf(p)), places: knownPlaces(dims, ordered, 0, 0) };
}
