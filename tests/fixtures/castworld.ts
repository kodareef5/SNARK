// A small city for Cast's tests, as plain functions: roads every 128 m both ways with sidewalks beside them, buildings
// filling the blocks but for a plaza every third one, a beach along the east and the sea past it. Players stand where a
// test puts them; "seen" is a square ring about each, as the server's ring of chunks is.

import type { CastPlace, CastPlayer, CastWorld } from "../../server/cast/world.ts";
import { GROUND_CLASS } from "../../shared/world/vehicle-surface.ts";

export const CITY = 2048, BLOCK = 128, ROAD = 8, WALK = 6, BEACH = 1880, SEA = 1980;
/** The ring a player is sent bodies in, in metres: three chunks of 64 and one more, as car-return reckons it. */
export const RING = 4 * 64 + 32;

export class CastCity implements CastWorld {
  readonly rate = 30;
  readonly sizeX = CITY;
  readonly sizeZ = CITY;
  t = 0;
  clock = 12;
  people: CastPlayer[] = [];
  extraPlaces: CastPlace[] = [{ name: "Fountain", kind: "landmark", x: 3 * BLOCK + 64, z: 3 * BLOCK + 64 }];

  tick(): number {
    return this.t;
  }
  hour(): number {
    return this.clock;
  }
  players(): readonly CastPlayer[] {
    return this.people;
  }
  ground(x: number, z: number): number {
    if (x < 0 || z < 0 || x >= CITY || z >= CITY) return -1;
    if (x >= BEACH) return GROUND_CLASS.SAND;
    const mx = x % BLOCK, mz = z % BLOCK;
    if (mx < ROAD || mz < ROAD) return GROUND_CLASS.ASPHALT;
    if (mx < ROAD + WALK || mz < ROAD + WALK || mx > BLOCK - WALK || mz > BLOCK - WALK) return GROUND_CLASS.PAVING;
    return this.plaza(x, z) ? GROUND_CLASS.PAVING : GROUND_CLASS.GROUND;
  }
  water(x: number): number {
    return x >= SEA ? 2 : 0;
  }
  blocked(x: number, z: number, r = 0.35): boolean {
    if (r > 1) return this.blocked(x - r, z) || this.blocked(x + r, z) || this.blocked(x, z - r) || this.blocked(x, z + r);
    if (x >= BEACH || x < 0 || z < 0 || x >= CITY || z >= CITY) return false;
    const mx = x % BLOCK, mz = z % BLOCK;
    if (mx < ROAD + WALK || mz < ROAD + WALK || mx > BLOCK - WALK || mz > BLOCK - WALK) return false;
    return !this.plaza(x, z);
  }
  seen(x: number, z: number): boolean {
    return this.people.some((p) => Math.abs(p.x - x) <= RING && Math.abs(p.z - z) <= RING);
  }
  places(): readonly CastPlace[] {
    return this.extraPlaces;
  }
  private plaza(x: number, z: number): boolean {
    return (Math.floor(x / BLOCK) + Math.floor(z / BLOCK)) % 3 === 0;
  }
  /** Moves time on by seconds, calling `step` each tick. */
  run(seconds: number, step: () => void): void {
    for (let i = 0; i < seconds * this.rate; i++) {
      this.t++;
      step();
    }
  }
}
