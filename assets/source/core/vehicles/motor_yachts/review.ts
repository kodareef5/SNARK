// Review near geometry and forward visibility from the packed helm with the native rasterizer.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MOTOR_YACHTS } from "../../../../../content/vehicles/motor-yachts.ts";
import { buildRig } from "../../../../../shared/anim/rigs.ts";
import { solve } from "../../../../../shared/anim/skeleton.ts";
import { parsePack } from "../../../../../shared/pack/pack.ts";
import { Stage } from "../../../../../tests/fixtures/stage.ts";
import { findAssets } from "../../../../../tools/art/assets.ts";
import { materialsOf } from "../../../../../tools/art/materials.ts";
import { ModelView } from "../../../../../tools/snap.ts";
import { rgbaOf } from "../../../../../tools/snap/files.ts";
import { encodePng } from "../../../../../tools/snap/png.ts";

const out = process.argv[2] ?? "artifacts/motor-yachts";
mkdirSync(out, { recursive: true });
const assets = await findAssets();
for (const boat of MOTOR_YACHTS) {
  const name = boat.id.slice(5);
  const asset = assets.find(a => a.id === boat.id)!;
  const pack = parsePack(new Uint8Array(readFileSync(asset.file)));
  const mesh = pack.meshIndex.get(boat.id)!;
  const rig = buildRig(pack.header.rigs[pack.header.meshes[mesh]!.rig!]!, pack.clips)!;
  const materials = materialsOf(asset);
  const pictures = (pack.header.textures ?? []).map(t => rgbaOf(materials.find(m => t.id === `${m.id}/${t.role}`)!, t.role, t.top));
  const regions = [boat.paint, 84, 101];
  const w = 1056, h = 580;
  const view = new ModelView(pack, w, h, [.84, .87, .88]);
  pictures.forEach((t, i) => view.texture(i, t.role, t.pictures));
  rig.a.rest();
  solve(rig, rig.a, rig.solved);
  for (const [file, around, above] of [["bow", 54, 19], ["stern", 222, 22]] as const) {
    view.draw({ mesh, level: 0, centre: [0, boat.height * .44, 0], radius: boat.length * .55,
      zoom: 1.62, around, above, rig, colors: regions, textured: true });
    writeFileSync(join(out, `${name}-${file}.png`), encodePng(w, h, new Uint8Array(view.raster.color)));
  }
  const stage = new Stage(pack, w, h);
  const [x,y,z] = boat.camera;
  Object.assign(stage.cam, { x, y, z, yaw: 0, pitch: -.12, fovY: 1.27 });
  stage.begin();
  pictures.forEach((t,i) => stage.texture(i, t.role, t.pictures));
  // A second boat on the horizon makes the opening in the windscreen visible.
  const forward = { x: x - boat.beam * 1.10, y: 0, z: boat.length * 1.30, yaw: -.97 };
  stage.add(boat.id, 0, { ...forward, bone: stage.pose(rig, forward), regions });
  const aboard = { x: 0, y: 0, z: 0 };
  stage.add(boat.id, 0, { ...aboard, bone: stage.pose(rig, aboard), regions });
  writeFileSync(join(out, `${name}-pilot.png`), encodePng(w, h, new Uint8Array(stage.render())));
}
