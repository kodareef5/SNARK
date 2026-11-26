// Layers of static pieces a map's build sets down on its ground: the slot a ruin generator fills. A layer is a module
// that, given the site (the ground as built, every footprint with what is known of its building, and the districts),
// returns pieces as the folder's statics.json holds them. The build runs each layer of STATIC_LAYERS in order, after the
// ground and before the nodes, and writes their pieces, layer after layer, into statics.json.
//
// To add one: write a module exporting a StaticLayer and put it in STATIC_LAYERS. Its pieces must name content the core
// pack defines (a structure of class "static" for a block), and its shapes come from a hash of the footprint's id, as the
// heaps' do, so the same map file always gives the same city. Turn the heaps off in world.json ("heaps": false) when
// blocks stand in their place; each footprint is then left as a bare slab at the ground's own height.

import type { Building, Ruin } from "./heaps.ts";
import type { District, Ground, World } from "./ground.ts";
import type { SiteBuilding } from "./buildings.ts";
import { RUINS } from "./ruins.ts";
import { STRUCT_UNITS, YAW_UNITS } from "../../shared/coords.ts";
import { cellHeight } from "../../shared/world/heightfield.ts";
import { orbCollision } from "../../shared/world/orb.ts";
import { toYaw } from "../map/layers.ts";
import { own } from "./known.ts";
import { ROOF_PLANT } from "./roof-plant.ts";
import { STREET_FURNITURE } from "./street-furniture.ts";

/**
 * A piece as statics.json takes it: a content id, its centre in engine metres, and its turn in degrees from north toward
 * +x; a bent piece's bend as its eight numbers (shared/world/bends.ts packBend).
 */
export interface StaticPiece {
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly bend?: ArrayLike<number>;
}

export interface Footprint {
  /** The building as the base layers give it: rings in metres east and north of the map's centre, its area and perimeter. */
  readonly building: Building;
  /** What the heaps took it to be: storeys from its area and its district's height, and heap, hall or tank. */
  readonly ruin: Ruin;
  readonly district: District | null;
}

/**
 * An orb a layout asked for (shared/world/orb.ts), at lattice x and z, its heading in degrees as a piece's; `y` is the
 * ground under its axis once its shell is laid, and `building` its place's among the site's buildings, whose pieces
 * its shell's and its plinth's are.
 */
export interface SiteOrb { name: string; x: number; z: number; yaw: number; radius: number; centre: number; y?: number; building?: number }

export interface Site {
  /** The orbs the ruins' layouts asked for, which the map's head lists. */
  readonly orbs: SiteOrb[];
  readonly growthRoutes: { points: { x: number; y: number; z: number }[]; width: number }[];
  /** Drivable vehicles a new world parks, as the layers folder's vehicles.json takes them: yaw in degrees as a piece's. */
  readonly vehicles: { kind: string; x: number; z: number; yaw: number; condition?: readonly [number, number]; fuel?: readonly [number, number] }[];
  /** The buildings the ruins made, in the order of their records: a piece's owner (known.ts) is its place here. */
  readonly buildings: SiteBuilding[];
  readonly source: string;
  readonly world: World;
  readonly ground: Ground;
  readonly footprints: readonly Footprint[];
  /** Lattice x and z (Grid, base.ts) of a point given in metres east and north of the projection's centre. */
  toLattice(e: number, n: number): [number, number];
  /** The ground's height in metres above the sea at lattice x and z, between samples. */
  groundAt(x: number, z: number): number;
  /** The surface of the water nearest the sample at lattice x and z, in metres above the sea: a lake's in one, else the sea's. */
  waterAt(x: number, z: number): number;
  /** Per 4 m square, row by row from the north, (nx - 1) / 2 a row: no plants at all, or only low ones. */
  readonly clearPlants: Uint8Array;
  readonly lowPlants: Uint8Array;
}

export interface StaticLayer {
  readonly name: string;
  /** Its pieces, given those the layers before it set down. */
  make(site: Site, placed: readonly StaticPiece[]): StaticPiece[];
}

/**
 * Each orb's shell and plinth, on the ground under its axis as the ruins left it, where a Tide Eye's site takes its
 * height. It comes before the street's pieces, so they count it in a chunk and keep clear of it. Its pieces are its
 * place's building's, so a look at one names the place.
 */
export const ORB_SHELLS: StaticLayer = {
  name: "the orbs' shells",
  make(site) {
    const snap = (v: number): number => Math.round(v * STRUCT_UNITS) / STRUCT_UNITS;
    return site.orbs.flatMap((o) => {
      [o.x, o.y, o.z] = [snap(o.x), snap(site.groundAt(o.x, o.z)), snap(o.z)];
      // The plinth turns with the heading the map's head will give the site.
      return orbCollision({ ...o, y: o.y, yaw: toYaw(o.yaw) }).map((p) => {
        const piece = { ...p, yaw: (p.yaw * 360) / YAW_UNITS };
        if (o.building !== undefined) own(piece, o.building);
        return piece;
      });
    });
  },
};

export const STATIC_LAYERS: readonly StaticLayer[] = [RUINS, ORB_SHELLS, STREET_FURNITURE, ROOF_PLANT];

export function siteOf(world: World, ground: Ground, source: string): Site {
  const { nx, nz, x0, z0, x1, z1, east, south } = ground.grid;
  const [eastX, southZ] = [east + x0, south - z0];
  const at = (c: number, r: number): number => ground.height[Math.min(nz - 1, Math.max(0, r)) * nx + Math.min(nx - 1, Math.max(0, c))]!;
  return {
    source,
    world,
    ground,
    orbs: [],
    growthRoutes: [],
    vehicles: [],
    buildings: [],
    clearPlants: new Uint8Array(((nx - 1) / 2) * ((nz - 1) / 2)),
    lowPlants: new Uint8Array(((nx - 1) / 2) * ((nz - 1) / 2)),
    footprints: ground.heaps.ruins.map((ruin) => ({ building: ruin.building, ruin, district: world.districts[ruin.district - 1] ?? null })),
    toLattice: (e, no) => [eastX - e, no - southZ],
    groundAt(x, z) {
      // On the triangles the game collides with: engine sample (i, j) is base sample (nx - 1 - i, nz - 1 - j).
      const fx = Math.min(nx - 1, Math.max(0, (x - x0) / 2)), fz = Math.min(nz - 1, Math.max(0, (z - z0) / 2));
      const i = Math.min(nx - 2, Math.floor(fx)), j = Math.min(nz - 2, Math.floor(fz));
      const c = nx - 1 - i, r = nz - 1 - j;
      return cellHeight(at(c, r), at(c - 1, r), at(c, r - 1), at(c - 1, r - 1), fx - i, fz - j);
    },
    waterAt(x, z) {
      const lakes = ground.lakes;
      if (!lakes) return 0;
      const b = lakes.body[Math.min(nz - 1, Math.max(0, Math.round((z1 - z) / 2))) * nx + Math.min(nx - 1, Math.max(0, Math.round((x1 - x) / 2)))]!;
      return b === 0 ? 0 : lakes.bodies[b - 1]!.surface;
    },
  };
}
