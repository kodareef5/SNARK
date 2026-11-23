import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ruinKind } from "../../content/ruins.ts";
import { streetKind } from "../../content/street.ts";
import { Heightfield } from "../../shared/world/heightfield.ts";
import { writeMap, type MapStatic } from "../../shared/world/mapfile.ts";
import { made } from "../map.ts";

/** An open apron beside two loading sheds gives the first truck room to receive and turn. */
export function airYard(): Uint8Array {
  const ground = new Heightfield({ chunksX: 12, chunksZ: 12 }, 2, -32, 1 / 256);
  for (let j = 0; j < ground.nz; j++) for (let i = 0; i < ground.nx; i++) {
    const x = 2 * i, z = 2 * j;
    const yard = x > 200 && x < 480 && z > 198 && z < 445;
    const hill = Math.max(0, Math.min(1, (Math.hypot(x - 340, z - 320) - 165) / 120));
    ground.setSample(i, j, 3 + hill * (9 + 6 * Math.cos(x / 41) + 5 * Math.sin(z / 48)));
    const lane = yard && (x === 318 || x === 342) && z < 366 && z % 20 < 12;
    ground.tint[j * ground.nx + i] = lane ? 103 : yard ? 90 : 17;
  }
  const statics: MapStatic[] = [];
  const put = (kind: string, x: number, y: number, z: number, yaw = 0) => statics.push({ kind, x, y, z, yaw });
  for (const z of [290, 345, 401]) {
    for (const x of [238, 256, 414, 432]) {
      put(ruinKind("container", x < 300 ? "rustsheet" : "bluesheet"), x, 4.3, z);
      put(ruinKind("container", "limesheet"), x, 4.3, z + 3.5);
      if (x === 256 || x === 432) put(ruinKind("container", "steelsheet"), x, 6.9, z);
    }
  }
  for (const z of [324, 382]) {
    for (const x of [276, 292, 308]) {
      put(ruinKind("floor16", "tar"), x, 11.2, z);
      for (const side of [-1, 1]) put(ruinKind("pier8"), x + 7.55, 7, z + side * 7.55);
    }
    for (const side of [-1, 1]) put(ruinKind("pier8"), 268.45, 7, z + side * 7.55);
  }
  for (const z of [240, 281, 322, 363, 404]) {
    put(streetKind("lamp_lit"), 309, 3, z, 16384);
    put(streetKind("lamp_lit"), 365, 3, z, 49152);
  }
  for (const x of [275, 288, 301]) put("core:box_trailer", x, 3, 261);
  put(streetKind("billboard_bare"), 449, 3, 421, 32768);
  return writeMap(made({
    id: "preview:air-freight", dims: ground.dims, minY: ground.minY, stepY: ground.stepY,
    seaLevel: 0, heights: ground.heights, tint: ground.tint, statics, nodes: [],
    vehicles: [{ kind: "core:semi", x: 329.4, z: 249.65, yaw: 0, fuel: [1, 1] }],
    spawns: [{ name: "Freight apron", x: 332, z: 251, yaw: 49152 }],
  }));
}

export function writeAirYard(path: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, airYard());
  return path;
}
