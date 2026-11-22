// Where Cast's scenes happen: spots read from the map's ground, made a region at a time when first needed and kept. A
// spot on paving by a road is a sidewalk (a corner where roads meet it on two sides, a storefront where a building
// stands beside it), paving away from roads a plaza, sand a beach, gravel a lot to park in, a road a road, open grass
// away from buildings a park; a few plazas and beach spots hold a food cart and its queue. Landmarks and spawn points are
// spots of their own. Authored spots (an admin's, a map's file) are added beside them.

import type { SpotTag } from "../../shared/cast/catalogue.ts";
import type { Spot } from "../../shared/cast/state.ts";
import { GROUND_CLASS } from "../../shared/world/vehicle-surface.ts";
import type { CastWorld } from "./world.ts";

/** Metres a region is on a side: Cast's unit of liveliness and of making spots. */
export const REGION_SIZE = 256;
/** Metres between the samples a region's spots are read from. */
const STEP = 12;
/** Spots kept of each tag in a region, at most: enough for variety, few enough to keep. */
const PER_TAG = 24;

export class Spots {
  readonly all: Spot[] = [];
  private readonly byRegion = new Map<number, number[]>();
  private readonly world: CastWorld;
  readonly cols: number;
  readonly rows: number;

  constructor(world: CastWorld) {
    this.world = world;
    this.cols = Math.max(1, Math.ceil(world.sizeX / REGION_SIZE));
    this.rows = Math.max(1, Math.ceil(world.sizeZ / REGION_SIZE));
  }

  regionAt(x: number, z: number): number {
    const c = Math.min(this.cols - 1, Math.max(0, Math.floor(x / REGION_SIZE)));
    const r = Math.min(this.rows - 1, Math.max(0, Math.floor(z / REGION_SIZE)));
    return r * this.cols + c;
  }

  /** The middle of a region. */
  centre(region: number): { x: number; z: number } {
    return { x: ((region % this.cols) + 0.5) * REGION_SIZE, z: (Math.floor(region / this.cols) + 0.5) * REGION_SIZE };
  }

  /** Adds a spot from outside (authored, or a test's); returns its index. */
  add(s: Spot): number {
    const i = this.all.push(s) - 1;
    const r = this.regionAt(s.x, s.z);
    this.of(r).push(i);
    return i;
  }

  /** A region's spots, read from the ground the first time they are asked for. */
  in(region: number): readonly number[] {
    return this.of(region);
  }

  private of(region: number): number[] {
    let got = this.byRegion.get(region);
    if (got) return got;
    got = [];
    this.byRegion.set(region, got);
    this.read(region, got);
    return got;
  }

  /** Spots in the region with any of the tags, as indices. */
  tagged(region: number, tags: readonly string[]): number[] {
    return this.in(region).filter((i) => this.all[i]!.tags.some((t) => tags.includes(t)));
  }

  private read(region: number, into: number[]): void {
    const w = this.world;
    const x0 = (region % this.cols) * REGION_SIZE, z0 = Math.floor(region / this.cols) * REGION_SIZE;
    const kept = new Map<string, number>();
    const road = (x: number, z: number) => w.ground(x, z) === GROUND_CLASS.ASPHALT && w.water(x, z) <= 0;
    let n = 0;
    for (let z = z0 + STEP / 2; z < z0 + REGION_SIZE; z += STEP) {
      for (let x = x0 + STEP / 2; x < x0 + REGION_SIZE; x += STEP) {
        n++;
        const g = w.ground(x, z);
        if (g < 0 || w.blocked(x, z) || w.water(x, z) > 0.2) continue;
        const tags: SpotTag[] = [];
        if (g === GROUND_CLASS.ASPHALT) tags.push("road");
        else if (g === GROUND_CLASS.PAVING) {
          const ew = road(x - 8, z) || road(x + 8, z), ns = road(x, z - 8) || road(x, z + 8);
          if (ew && ns) tags.push("corner", "sidewalk", "beat");
          else if (ew || ns) tags.push("sidewalk");
          else tags.push("plaza");
          if (w.blocked(x - 5, z) || w.blocked(x + 5, z) || w.blocked(x, z - 5) || w.blocked(x, z + 5)) tags.push("storefront");
          // Every so often a plaza or a sidewalk is wide enough for a cart and its line.
          if (!ew && !ns && n % 5 === 0) tags.push("cart", "queue");
        } else if (g === GROUND_CLASS.SAND) {
          tags.push("beach");
          if (n % 7 === 0) tags.push("cart", "queue");
        } else if (g === GROUND_CLASS.GRAVEL) tags.push("parking");
        else if (g === GROUND_CLASS.GROUND && !w.blocked(x - 15, z) && !w.blocked(x + 15, z) && !w.blocked(x, z - 15) && !w.blocked(x, z + 15)) tags.push("park");
        if (!tags.length) continue;
        // Keep a spread: no more than PER_TAG of a spot's first tag in the region.
        const k = kept.get(tags[0]!) ?? 0;
        if (k >= PER_TAG) continue;
        kept.set(tags[0]!, k + 1);
        const queue = tags.includes("queue") ? { yaw: openWay(w, x, z), spacing: 0.9, serve: 8 } : undefined;
        const i = this.all.push({ x, z, tags, cap: tags.includes("beach") || tags.includes("plaza") ? 60 : tags.includes("road") ? 2 : 6, ...(queue ? { queue } : {}) }) - 1;
        into.push(i);
      }
    }
    for (const p of w.places()) {
      if (this.regionAt(p.x, p.z) !== region) continue;
      const tags: SpotTag[] = [p.kind === "spawn" ? "spawn" : "landmark", "plaza"];
      into.push(this.all.push({ x: p.x, z: p.z, tags, cap: 40, name: p.name }) - 1);
    }
  }
}

/** The way from a point with the most open, dry, unblocked ground over ten metres: where a line can run. */
function openWay(w: CastWorld, x: number, z: number): number {
  let best = 0, bestOpen = -1;
  for (let k = 0; k < 8; k++) {
    const yaw = (k / 8) * Math.PI * 2;
    let open = 0;
    for (let d = 1; d <= 10; d++) {
      const px = x + Math.sin(yaw) * d, pz = z + Math.cos(yaw) * d;
      if (w.blocked(px, pz) || w.water(px, pz) > 0 || w.ground(px, pz) === GROUND_CLASS.ASPHALT) break;
      open++;
    }
    if (open > bestOpen) (best = yaw), (bestOpen = open);
  }
  return best;
}
