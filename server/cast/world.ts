// What Cast asks of the world, and nothing more: so its engine runs headless under test (a fake world) and in the server
// (server/cast/host.ts, over the real one). Positions are the server's own metres.

export interface CastPlayer {
  name: string;
  x: number;
  z: number;
}

/** A named place on the map: a landmark, a spawn point, an obelisk. */
export interface CastPlace {
  name: string;
  kind: string;
  x: number;
  z: number;
}

export interface CastWorld {
  /** Ticks a second. */
  readonly rate: number;
  tick(): number;
  /** The game's hour, 0 to 24. */
  hour(): number;
  /** The map's extent in metres. */
  readonly sizeX: number;
  readonly sizeZ: number;
  players(): readonly CastPlayer[];
  /** The ground's class (shared/world/vehicle-surface.ts GROUND_CLASS) where one stands, or -1 off the map. */
  ground(x: number, z: number): number;
  /** Metres of water over the ground; 0 or less is dry. */
  water(x: number, z: number): number;
  /** Something stands there that a body of radius `r` (a person's 0.35 m unless given) would not fit by: a building,
   * the map's own piece, a tree or a rock. */
  blocked(x: number, z: number, r?: number): boolean;
  /** Some player is sent the bodies there (within its ring of chunks, and one more): nothing appears or goes there. */
  seen(x: number, z: number): boolean;
  places(): readonly CastPlace[];
}
