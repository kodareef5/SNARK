import { MARINE_MODELS } from "../../content/vehicles/marine-fleet.ts";
import type { MapData, MapVehicle } from "../../shared/world/mapfile.ts";
import { boatCourse } from "./course.ts";

/** Each stern ladder meets the same dock edge. The ten boats point out into the deep-water course. */
export function fleetMarina(): MapData {
  const course = boatCourse(), statics = [...course.statics].filter(s => s.z > 120);
  for (let x = 77; x <= 191; x += 3) statics.push({ kind: "core:ceiling", x, y: .45, z: 91, yaw: 0 });
  for (let z = 73; z <= 88; z += 3) statics.push({ kind: "core:ceiling", x: 131, y: .45, z, yaw: 0 });
  const vehicles: MapVehicle[] = MARINE_MODELS.map((model, i) => ({
    id: `fleet/${model.id.slice(5)}`, kind: model.id,
    x: 80 + i * 12 - model.boarding.water[0], z: 93.2 - model.boarding.water[2],
    yaw: 0, condition: [1, 1], fuel: [1, 1],
  }));
  return { ...course, id: "preview:marine-fleet", statics, vehicles, spawns: [{ name: "Fleet marina", x: 131, z: 69, yaw: 0 }] };
}
