// The water district motor pool. Wrecks are ordinary saved map statics, metres above sea level.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import bounds from "../../content/vehicles/tanker-wreck-bounds.json" with { type: "json" };
import { Heightfield } from "../../shared/world/heightfield.ts";
import { writeMap, type MapStatic } from "../../shared/world/mapfile.ts";
import { made } from "../map.ts";

export function writeTankerYard(path: string, freight = false): string {
  const hf = new Heightfield({ chunksX: 4, chunksZ: 4 }, 2, -32, 1 / 256);
  for (let z = 0; z < hf.nz; z++)
    for (let x = 0; x < hf.nx; x++) {
      hf.setSample(x, z, 1);
      hf.tint[z * hf.nx + x] = x > 40 && x < 86 && z > 22 && z < 102 ? 90 : 17;
    }
  const statics: MapStatic[] = freight ? [{kind:"core:box_trailer", x:140, y:1, z:84, yaw:0}] : Object.keys(bounds).map((state, i) => ({
    kind: `core:tanker_${state}`,
    x: i % 2 ? 138 : 115,
    y: 1,
    z: 83 + Math.floor(i / 2) * 17,
    yaw: i % 2 ? 44000 : 21500,
  }));
  const map = made({
    id: freight ? "preview:freight-yard" : "preview:tanker-yard",
    dims: hf.dims,
    minY: hf.minY,
    stepY: hf.stepY,
    seaLevel: 0,
    heights: hf.heights,
    tint: hf.tint,
    statics,
    nodes: [],
    spawns: [{ name: freight ? "District transport yard" : "Water district motor pool", x: 128, z: 65, yaw: 0 }],
  });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, writeMap(map));
  return path;
}
