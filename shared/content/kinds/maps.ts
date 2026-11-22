// Maps: a world's zones, which say what spawns, grows and drops where. Its ground is the map file that carries its id.

import { f, row, stub, type Fields, type Kind, type Named } from "../kind.ts";

/** A place on a map where something spawns or drops. */
export interface MapZone {
  readonly kind: "spawn" | "crate" | "biome";
  /** Centre x and z, in metres. */
  readonly at: readonly [number, number];
  /** A circle of this radius, in metres. */
  readonly radius?: number;
  /** In place of `radius`: a box of this half width and half depth. */
  readonly half?: readonly [number, number];
  /** For a spawn zone: the `spawns` it is stocked from, and how many creatures it holds at a DinoCountMultiplier of 1. */
  readonly spawns?: string;
  readonly count?: number;
  readonly crate?: string;
}

/**
 * A world. Its ground is the map file that carries its id (shared/world/mapfile.ts), and a server is started with that file.
 * A spawn zone that names spawns is kept stocked from them (server/spawner.ts).
 */
export interface MapDef extends Named {
  readonly type: "map";
  readonly id: string;
  readonly label?: string;
  /** Its sea level, which must be what its file holds. Its size is its file's. */
  readonly seaLevel?: number;
  readonly game?: string;
  readonly zones?: readonly MapZone[];
}

const FIELDS = {
  label: stub("maps", "text"),
  seaLevel: f("number"),
  game: stub("maps", "text", "the game data a level names", { refs: { "": "game" } }),
  zones: f("list", "zone managers and crate volumes", { refs: { "[].spawns": "spawns", "[].crate": "prop/crate" } }),
} satisfies Fields<MapDef>;

export const maps: Kind<MapDef> = {
  type: "map",
  fields: FIELDS,
  rows: [
    row("map", "map", FIELDS, { ark: "a level and the game data it names", status: "partial", waits: "maps", shelf: "maps", may: ["label", "seaLevel", "game", "zones"], doc: "A world. Its ground is the map file that carries its id, and its zones say what spawns, grows and drops where. A spawn zone with a spawns definition is kept stocked from it; one without is where a test's starting creatures are put." }),
  ],
  check(d, { errors }) {
    for (const z of d.zones ?? []) {
      if (z.count !== undefined && !(Number.isInteger(z.count) && z.count >= 0 && z.count <= 65535)) errors.push(`${d.id}: a zone holds a whole number of creatures from 0 to 65,535`);
      if ((z.spawns === undefined) !== (z.count === undefined)) errors.push(`${d.id}: a zone that names spawns says how many it holds, and only such a zone does`);
    }
  },
};
