// The sloped statics on the proving ground's plaza, for pictures: each kind alone, near and far, and a small ruin made of
// them. `bun run snap -- --slopes ramp --view near --graphics medium`; `--slopes scene` for the ruin.

import type { Registry } from "../../shared/content/registry.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import type { StructureStore } from "../../shared/world/structures.ts";
import { STRUCT_UNITS } from "../../shared/coords.ts";
import type { Camera } from "../../client/core/render/camera.ts";
import { ruinKind } from "../../content/miami-ruins.ts";
import { slopeKind } from "../../content/slopes.ts";

/** Each kind's short name, as `slopeKind` takes it. */
export const SLOPE_NAMES = ["ramp", "rubble", "stairs", "stairs_solid", "slab30", "slab60", "roof"] as const;

/** Where the plaza is flat and empty, south-east of the spawn point. */
const AT = { x: 290, z: 206 };

interface View {
  readonly reg: Registry;
  readonly structs: StructureStore;
  readonly hf: Heightfield;
  readonly cam: Camera;
}

type Label = { text: string; at: [number, number, number] };

/** On the lattice, as a piece is set. */
const snapped = (v: number): number => Math.round(v * STRUCT_UNITS) / STRUCT_UNITS;

/**
 * Sets the scene `which` (a kind's short name or "scene") and puts the camera on it, "near" or "far" (where the coarser level
 * is drawn). Returns words to write by the pieces.
 */
export function slopesScene(view: View, which: string, look: "near" | "far"): Label[] {
  const { reg, structs, hf, cam } = view;
  const kind = (id: string): number => {
    const k = reg.index.get(id);
    if (k === undefined) throw new Error(`no ${id}`);
    return k;
  };
  const ground = hf.heightAt(AT.x, AT.z);
  const labels: Label[] = [];
  // A piece by its middle, `y` its middle's height over the ground, turned `deg` degrees.
  const put = (id: string, x: number, y: number, z: number, deg = 0, text?: string): void => {
    const k = kind(id);
    structs.add(k, snapped(AT.x + x), snapped(ground + y), snapped(AT.z + z), Math.round((deg / 360) * 65536) & 0xffff, 0, 1);
    if (text) labels.push({ text, at: [AT.x + x, ground + y + reg.halfY[k]! + 0.6, AT.z + z] });
  };
  // The camera at `from`, looking at `to`, both from AT and the ground. Yaw 0 faces +Z and turns toward +X.
  const camAt = (from: readonly number[], to: readonly number[]): void => {
    [cam.x, cam.y, cam.z] = [AT.x + from[0]!, ground + from[1]!, AT.z + from[2]!];
    const [dx, dy, dz] = [to[0]! - from[0]!, to[1]! - from[1]!, to[2]! - from[2]!];
    cam.yaw = Math.atan2(dx, dz);
    cam.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  };
  if (which !== "scene") {
    if (!(SLOPE_NAMES as readonly string[]).includes(which)) throw new Error(`--slopes takes ${SLOPE_NAMES.join(", ")} or scene, not "${which}"`);
    const k = kind(slopeKind(which));
    // Resting on the ground, its high end away from a camera that looks at it from its low end's side and above.
    put(slopeKind(which), 0, reg.halfY[k]!, 0, 0, which.replace("_", " "));
    // From the side and the low end, above: the slope and the treads in view.
    const span = Math.max(reg.halfX[k]!, reg.halfY[k]!, reg.halfZ[k]!);
    const d = look === "near" ? 2.6 * span + 4 : 90;
    camAt([0.6 * d, 0.45 * d + 1, -0.75 * d], [0, reg.halfY[k]!, 0]);
    return labels;
  }
  // A ruin: a deck a storey up on piers with a flight to it, its west bay fallen and leaning on the ground; a ramp up to a
  // low deck; west of the fallen bay, a house whose roof stands, rubble heaped against its wall.
  const floor = ruinKind("floor8");
  const pier = ruinKind("pier4");
  for (const [x, z] of [[-4, 4], [4, 4], [-4, 12], [4, 12]] as const) put(floor, x, 3.8, z);
  for (const [x, z] of [[-7.5, 0.5], [7.5, 0.5], [-7.5, 15.5], [7.5, 15.5], [0, 8]] as const) put(pier, x, 2, z);
  // The fallen bay: an 8 m slab at 30 degrees rises 4 m, from the ground to the deck's west edge.
  put(slopeKind("slab30"), -11.5, 2.17, 8, 90, "fallen floor");
  // The flight rises 4 m over 5.5 m toward +Z, its top at the deck's south edge.
  put(slopeKind("stairs"), 2, 2, -2.75, 0, "stair flight");
  // A ramp rising 2 m over 6 m to a low deck, east of the high one.
  put(slopeKind("ramp"), 14, 1 - 0.2, 0, 0, "ramp");
  put(floor, 14, 1.8, 7);
  for (const [x, z] of [[10.5, 3.5], [17.5, 3.5], [10.5, 10.5], [17.5, 10.5]] as const) put(ruinKind("pier4", "concrete"), x, 2 - 0.2 - 2, z);
  // A house 8 m square with walls 2.8 m high, its pitched roof's eaves on them.
  const wall = ruinKind("wall8", "rose");
  const hx = -22;
  const hz = 18;
  put(wall, hx, 1.4, hz - 3.75);
  put(wall, hx, 1.4, hz + 3.75);
  put(wall, hx - 3.75, 1.4, hz, 90);
  put(wall, hx + 3.75, 1.4, hz, 90);
  const roof = kind(slopeKind("roof"));
  put(slopeKind("roof"), hx, 2.8 + reg.halfY[roof]!, hz, 90, "pitched roof");
  put(slopeKind("rubble"), hx, 0.75, hz - 6, 0, "rubble");
  // From the south, so the flight faces the camera, the ramp's side is on the left and the fallen bay on the right.
  if (look === "near") camAt([-6, 10, -18], [-7, 2, 8]);
  else camAt([10, 60, -150], [-4, 2, 9]);
  return labels;
}
