// A coast with a city on it, for flyers: sea to the west, a beach, and frame towers to 192 m (tests/integration/flyers.test.ts,
// tools/bench/flyers.ts).

import { CHUNK_SIZE } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import { TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { writeMap, type MapStatic } from "../../shared/world/mapfile.ts";
import { building } from "./cityworld.ts";
import { flatMap } from "./map.ts";

/**
 * A coast of 6 by 6 chunks: sea to the west, a beach rising to flat land at 2 m, and frame towers of 4 to 48 storeys (16 to
 * 192 m) east of the beach, the city fixture's buildings of the Miami ruin kit, open between their floors.
 */
export function coast(): Uint8Array<ArrayBuffer> {
  const chunks = 6;
  const side = (chunks * CHUNK_SIZE) / TERRAIN_CELL + 1;
  const heights = new Uint16Array(side * side);
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const x = i * TERRAIN_CELL;
      const y = x < 90 ? -6 : x < 130 ? -6 + ((x - 90) / 40) * 8 : 2;
      heights[j * side + i] = Math.round((y + 32) * 256);
    }
  }
  const statics: MapStatic[] = [];
  const rng = new Rng(12);
  for (const x of [176, 216, 256, 296, 336]) for (const z of [96, 144, 192, 240, 288]) statics.push(...building(x, z, 2, 4 + rng.int(45), 2, rng.int(4) * 16384));
  return writeMap(flatMap(chunks, { id: "test:coast", seaLevel: 0, heights, statics, spawns: [{ name: "Beach", x: 120, z: 192, yaw: 0 }] }));
}
