import { expect, test } from "bun:test";
import { ROAD_FLEET } from "../../content/vehicles/road-fleet.ts";
import { quatRotate } from "../../shared/math/quat.ts";
import { carMeetsCapsule } from "../../shared/world/vehicle.ts";
import { isWheelVehicle } from "../../shared/sim/vehicle.ts";
import { rayVehicle, rayVehicleCover, vehiclePoint, vehicleRotation } from "../../shared/sim/vehicle-frame.ts";
import { meshDistance } from "../../tools/pack/mesh-ray.ts";
import { unpackMeshes } from "../../tools/pack/write.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { corePack } from "../fixtures/pack.ts";

// Independent surface points from each authored cabin: roof, side metal, side daylight, windshield daylight.
const samples = [
  { id: "compact", roof: [.3, 1.48, -.2], metal: [.70, 1.415, -.2], window: [.5, 1.15, 0], front: [.3, 1.15, .5] },
  { id: "fastback", roof: [.3, 1.48, -.2], metal: [.62, 1.439, -.2], window: [.5, 1.15, 0], front: [.3, 1.15, .5] },
  { id: "veloce", roof: [.3, 1.30, -.2], metal: [.68, 1.18, -.55], window: [.5, 1.07, 0], front: [.3, 1.02, .6] },
  { id: "berlinetta", roof: [.3, 1.30, -.2], metal: [.68, 1.20, -.55], window: [.5, 1.07, 0], front: [.3, 1.02, .55] },
  { id: "panel_van", roof: [.3, 2.5, -.6], metal: [.97, 1.7, -.6], window: [.6, 1.65, .8], front: [.4, 1.6, 1.1] },
  { id: "caravan", roof: [.3, 1.82, -.6], metal: [.79, 1.75, -.65], window: [.6, 1.38, .7], front: [.4, 1.4, 1] },
  // The zephyr's smoked canopy is its roof and its flank above the side glass.
  { id: "zephyr", roof: [.3, 1.15, -.2], metal: [.57, 1.065, -.2], window: [.5, .95, 0], front: [.3, .95, .55] },
] as const;

test("each enclosed road cabin blocks its roof/side metal but keeps glass apertures through full chassis rotation", () => {
  const q = new Float64Array(4), at = new Float64Array(3), direction = new Float64Array(3);
  for (const sample of samples) {
    const def = ROAD_FLEET.find(s => s.id === `core:${sample.id}`)!.vehicle!;
    expect(def.shotPanels!.length).toBeGreaterThan(0);
    for (const roll of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const frame = { x: 100, y: 6, z: 100, yaw: .7, pitch: .23, roll };
      vehicleRotation(frame, q);
      const attitude = { pitch: frame.pitch, roll, qx: q[0]!, qy: q[1]!, qz: q[2]!, qw: q[3]! };
      for (const [name, axis, solid] of [["roof", 1, true], ["metal", 0, true], ["window", 0, false], ["front", 2, false]] as const) {
        const point = [...sample[name]], origin = [...point]; origin[axis]! += 3;
        vehiclePoint(frame, origin, at);
        quatRotate(q, 0, axis === 0 ? -1 : 0, axis === 1 ? -1 : 0, axis === 2 ? -1 : 0, direction, 0);
        const distance = rayVehicleCover(def, frame.x, frame.y, frame.z, frame.yaw, at[0]!, at[1]!, at[2]!, direction[0]!, direction[1]!, direction[2]!, attitude);
        if (solid) expect(Math.abs(distance - 3), `${sample.id} ${name} roll ${roll}`).toBeLessThan(.12);
        else expect(distance, `${sample.id} ${name} roll ${roll}`).toBeGreaterThan(3.1);
      }
    }
  }
});

artTest("new fleet cover lies on the current rendered skin and the tested side windows remain actual apertures", () => {
  const meshes = unpackMeshes(corePack());
  for (const sample of samples) {
    const species = ROAD_FLEET.find(s => s.id === `core:${sample.id}`)!, lod = meshes.find(m => m.id === species.id)!.lods[0]!;
    let worst = 0;
    // Compact is the unchanged policy control; only the newly published panel sets are measured here.
    for (const panel of sample.id === "compact" ? [] : species.vehicle!.shotPanels!) {
      const center = [0, 1, 2].map(axis => panel.reduce((sum, point) => sum + point[axis]!, 0) / 4);
      const u = [0, 1, 2].map(axis => panel[1][axis]! - panel[0][axis]!), v = [0, 1, 2].map(axis => panel[2][axis]! - panel[0][axis]!);
      const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
      const length = Math.hypot(...n); for (let axis = 0; axis < 3; axis++) n[axis]! /= length;
      const distance = meshDistance(lod, center.map((c, axis) => c + n[axis]! * .15), n.map(c => -c), .15);
      worst = Math.max(worst, Math.abs(distance - .15));
    }
    expect(worst, `${sample.id}: panel centre to rendered skin`).toBeLessThan(.04);
    const window = sample.window;
    expect(meshDistance(lod, [window[0] + 3, window[1], window[2]], [-1, 0, 0]), `${sample.id}: open side window`).toBeGreaterThan(3.05);
  }
});

test("the semi's cab and rear deck meet the same bodies and rays as their visible heights", () => {
  const def = ROAD_FLEET.find(model => model.id === "core:semi")!.vehicle!;
  if (!isWheelVehicle(def)) throw Error("expected a road tractor");
  const frame = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 };
  for (const [z, y, solid] of [[-3, 1.6, false], [-3, .9, true], [.5, 1.6, true]] as const) {
    const aim = [0, 0, 0, 0, 4, y, z, -1, 0, 0] as const;
    expect(Number.isFinite(rayVehicleCover(def, ...aim, frame))).toBe(solid);
    expect(Number.isFinite(rayVehicle(def, ...aim, def.spec.height, frame))).toBe(solid);
    expect(carMeetsCapsule(def.spec, frame, 0, y, z, .1, .3) !== null).toBe(solid);
  }
});
