// A bay of the sea with Koru moored along a quay, made as a map build makes a map with a landmark: the quay and the dug
// berth its ground asks for, its statics and tender placed, its definitions in the map's content.

import { KORU, KORU_LAYOUT } from "../../content/landmarks/koru.ts";
import { boatRestY } from "../../shared/sim/boat.ts";
import { isBoatVehicle } from "../../shared/sim/vehicle.ts";
import { Heightfield } from "../../shared/world/heightfield.ts";
import { landmarkGround, landmarkPoint, placeLandmark } from "../../shared/world/landmark.ts";
import { writeMap, type MapData } from "../../shared/world/mapfile.ts";
import { coreRegistry } from "./world.ts";

/** Where its origin is moored: on the sea, its bow to +z, its port side and gangway to the quay at +x. */
export const KORU_AT = { x: 160, y: 0, z: 256, yaw: 0 } as const;
/** The land beyond the quay, and the bay's floor. */
const LAND = 1.5;
const FLOOR = -9;

/** A point of the yacht's metres in the bay. */
export function koruPoint(local: readonly number[]): [number, number, number] {
  const p = [0, 0, 0];
  landmarkPoint(KORU_AT.x, KORU_AT.y, KORU_AT.z, KORU_AT.yaw, [local[0]!, local[1]!, local[2]!], p);
  return [p[0]!, p[1]!, p[2]!];
}

/** On the quay, at the shore end of the gangway, where a survivor arrives. */
export const KORU_QUAY = koruPoint(KORU_LAYOUT.docking.shoreApproach);

export function koruMap(): MapData {
  const hf = new Heightfield({ chunksX: 8, chunksZ: 8 }, 2, -64, 1 / 256);
  for (let j = 0; j < hf.nz; j++) {
    for (let i = 0; i < hf.nx; i++) {
      const x = i * hf.cell, z = j * hf.cell;
      hf.setSample(i, j, landmarkGround(KORU, KORU_AT.x, KORU_AT.y, KORU_AT.z, KORU_AT.yaw, x, z, x > KORU_AT.x + 44 ? LAND : FLOOR));
    }
  }
  const { statics, vehicles } = placeLandmark(KORU, KORU_AT.x, KORU_AT.y, KORU_AT.z, KORU_AT.yaw);
  const reg = coreRegistry();
  return {
    id: "test:koru-bay",
    dims: hf.dims,
    minY: hf.minY,
    stepY: hf.stepY,
    seaLevel: 0,
    heights: hf.heights,
    tint: hf.tint,
    statics,
    nodes: [],
    spawns: [{ name: "quay", x: KORU_QUAY[0], z: KORU_QUAY[2], yaw: 49152 }],
    vehicles: vehicles.map((v) => {
      const def = reg.vehicle[reg.index.get(v.kind)!]!;
      return isBoatVehicle(def) ? { ...v, y: boatRestY(def.spec, 0) } : v;
    }),
    content: { landmarks: [KORU.name], defs: KORU.defs },
  };
}

let bytes: Uint8Array<ArrayBuffer> | null = null;
/** The bay's map file, made once. */
export const koruMapFile = (): Uint8Array<ArrayBuffer> => (bytes ??= writeMap(koruMap()));
