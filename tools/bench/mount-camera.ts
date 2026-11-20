// Measures the whole controlled-mount pose/camera/frame path, including padded obstruction queries.
import { Camera } from "../../client/core/render/camera.ts";
import { Scene, type OwnBody } from "../../client/core/render/scene.ts";
import "../../client/core/render/city-late.ts";
import { Viewpoint } from "../../client/core/viewpoint.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { GEAR_COUNT, GEAR_WORN } from "../../shared/sim/entities.ts";
import { ACT_NONE, ACT_SWING } from "../../shared/sim/weapon.ts";
import { corePack } from "../../tests/fixtures/pack.ts";
import { flatWorld } from "../../tests/fixtures/world.ts";
import { ART } from "../art/source.ts";

type Row = (name: string, value: number, unit: string, budget?: number | null) => void;
export function benchMountCameras(section: (name: string) => void, record: Row): void {
  if (!ART) throw new Error("This benchmark requires the original creature packs under assets/source.");
  section("Controlled mount: current pose, body-aware camera and full frame (CPU)");
  const reg = flatWorld(4).reg, pack = corePack();
  const ids = ["core:trike", "core:stego"].filter(id => reg.index.has(id));
  if (!ids.length) ids.push("core:raptor");
  for (const id of ids) for (const roofed of [false, true]) for (const avoid of [false, true]) {
    const world = flatWorld(4), kind = reg.index.get(id)!, def = reg.defs[kind]!, scene = new Scene(world, reg, pack), cam = new Camera(), view = new Viewpoint();
    if (!scene.characters.creature(kind)) throw new Error(`Native mounted camera benchmark requires the authored rig for ${id}`);
    if (def.type !== "species") throw new Error("A camera benchmark needs species content");
    // A real small enclosure exercises underside queries, visible-roof filtering and ordinary boom collision.
    // It includes stacked walls: their upper sections must not masquerade as extra low ceilings.
    if (roofed) for (let row = 0; row < 11; row++) {
      for (let column = -2; column <= 2; column++) world.structs.add(world.kind("core:ceiling"), 128 + column * 3, 4.4, 93 + row * 3, 0, 1, 100);
      for (const x of [120.5, 135.5]) for (const y of [1.5, 4.5]) world.structs.add(world.kind("core:wall_stone"), x, y, 93 + row * 3, 16384, 1, 100);
    }
    const own: OwnBody = { id: 9, generation: 1, kind, x: 128, y: 0, z: 100, yaw: 0, state: new AnimState(), tick: 0,
      firstPerson: false, colors: new Uint8Array(6), look: null, gear: new Uint16Array(GEAR_COUNT) };
    own.gear[GEAR_WORN] = reg.saddleFits.indexOf(kind);
    scene.own = own; scene.viewHeight = 720;
    const times: number[] = [], motion = { vx: 0, vy: 0, vz: 3, id: own.id, boom: def.camera?.distance ?? 7 };
    let dropped = 0, nonfinite = 0;
    for (let frame = 0; frame < 420; frame++) {
      own.tick = frame * .5; own.z = 100 + frame * .05; scene.now = frame * 1000 / 60;
      own.state.setMotion(0, 3, 0, 0); own.state.grounded = true;
      own.state.setAction(frame % 60 < 30 ? ACT_SWING : ACT_NONE, 0, Math.floor(frame / 60) * 30);
      const start = performance.now(), obstruction = avoid ? scene.prepareCameraBody(own) : null;
      view.placeVehicle(cam, world, own.x, own.y + (def.camera?.height ?? 4.65), own.z + (def.camera?.forward ?? .65), Math.sin(frame / 50) * 1.4, .5 + Math.sin(frame / 30) * .8, 0, 3, 1000 / 60, false, motion, obstruction);
      const packet = scene.build(cam, null), elapsed = performance.now() - start;
      if (frame >= 120) { times.push(elapsed); dropped = Math.max(dropped, packet.dropped); }
      if (![cam.x, cam.y, cam.z].every(Number.isFinite)) nonfinite++;
    }
    times.sort((a, b) => a - b);
    const label = `${id} ${roofed ? "roofed" : "open"} ${avoid ? "body obstruction" : "legacy obstruction"}`;
    record(`${label}: full frame median`, times[150]!, "ms");
    record(`${label}: full frame p99`, times[297]!, "ms");
    record(`${label}: dropped draws/bodies`, dropped, "", 0);
    record(`${label}: nonfinite camera positions`, nonfinite, "", 0);
  }
}

if (import.meta.main) benchMountCameras(console.log, (name, value, unit) => console.log(`${name}: ${value.toFixed(4)} ${unit}`));
