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
import { RUINS } from "./ruins.ts";

/** A piece as statics.json takes it: a content id, its centre in engine metres, and its turn in degrees from north toward +x. */
export interface StaticPiece {
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
}

export interface Footprint {
  /** The building as the base layers give it: rings in metres east and north of the map's centre, its area and perimeter. */
  readonly building: Building;
  /** What the heaps took it to be: storeys from its area and its district's height, and heap, hall or tank. */
  readonly ruin: Ruin;
  readonly district: District | null;
}

export interface Site {
  readonly source: string;
  readonly world: World;
  readonly ground: Ground;
  readonly footprints: readonly Footprint[];
  /** Engine x and z of a point given in metres east and north of the map's centre. */
  toEngine(e: number, n: number): [number, number];
  /** The ground's height in metres above the sea at engine x and z, between samples. */
  groundAt(x: number, z: number): number;
  readonly clearPlants: Uint8Array;
  readonly lowPlants: Uint8Array;
}

export interface StaticLayer {
  readonly name: string;
  make(site: Site): StaticPiece[];
}

export const STATIC_LAYERS: readonly StaticLayer[] = [RUINS];

export function siteOf(world: World, ground: Ground, size: number, source = "assets/source/maps/miami"): Site {
  const n = ground.n;
  const half = size / 2;
  const at = (c: number, r: number): number => ground.height[Math.min(n - 1, Math.max(0, r)) * n + Math.min(n - 1, Math.max(0, c))]!;
  return {
    source,
    world,
    ground,
    clearPlants: new Uint8Array(((n - 1) / 2) ** 2),
    lowPlants: new Uint8Array(((n - 1) / 2) ** 2),
    footprints: ground.heaps.ruins.map((ruin) => ({ building: ruin.building, ruin, district: world.districts[ruin.district - 1] ?? null })),
    toEngine: (e, no) => [half - e, half + no],
    groundAt(x, z) {
      // Columns run west to east and rows north to south, so x and z count back from the far corner.
      const fc = (size - x) / 2;
      const fr = (size - z) / 2;
      const c = Math.floor(fc);
      const r = Math.floor(fr);
      const u = fc - c;
      const v = fr - r;
      return (at(c, r) * (1 - u) + at(c + 1, r) * u) * (1 - v) + (at(c, r + 1) * (1 - u) + at(c + 1, r + 1) * u) * v;
    },
  };
}
