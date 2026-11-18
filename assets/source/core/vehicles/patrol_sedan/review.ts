// Renders the native pack and its streamed finish at normal and open door poses.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PATROL_SEDAN_ART as sedan } from "../../../../../content/vehicles/patrol-sedan-art.ts";
import { buildRig } from "../../../../../shared/anim/rigs.ts";
import { solve } from "../../../../../shared/anim/skeleton.ts";
import { quatAxis } from "../../../../../shared/math/quat.ts";
import { parsePack } from "../../../../../shared/pack/pack.ts";
import { Stage } from "../../../../../tests/fixtures/stage.ts";
import { findAssets } from "../../../../../tools/art/assets.ts";
import { materialsOf } from "../../../../../tools/art/materials.ts";
import { ModelView } from "../../../../../tools/snap.ts";
import { rgbaOf } from "../../../../../tools/snap/files.ts";
import { encodePng } from "../../../../../tools/snap/png.ts";

const asset = (await findAssets()).find(a => a.id === sedan.id)!;
const pack = parsePack(new Uint8Array(readFileSync(asset.file)));
const mesh = pack.meshIndex.get(sedan.id)!;
const rig = buildRig(pack.header.rigs[pack.header.meshes[mesh]!.rig!]!, pack.clips)!;
const materials = materialsOf(asset);
const textures = pack.header.textures!.map(t => rgbaOf(materials.find(m => t.id === `${m.id}/${t.role}`)!, t.role, t.top));
const width = 800, height = 420, colors = [10, 97, 91];
const folder = join(asset.dir, "ref");
mkdirSync(folder, { recursive: true });
const view = new ModelView(pack, 2 * width, 2 * height, [.83,.85,.86]);
textures.forEach((t, i) => view.texture(i, t.role, t.pictures));
for (const [name, around, above, opened] of [["front",48,12,false], ["rear",230,14,false], ["doors",74,23,true]] as const) {
  rig.a.rest();
  if (opened) for (const [side, sign] of [["left",-1],["right",1]] as const) {
    for (const prefix of ["door_", "door_rear_"]) quatAxis(rig.a.rot, rig.names.indexOf(prefix + side) * 4, 0, 1, 0, sign * 1.1);
  }
  solve(rig, rig.a, rig.solved);
  view.draw({ mesh, level: 0, rig, colors, textured: true, around, above, centre: [0,.76,0], radius: 3.0, zoom: opened ? 1.67 : 1.91 });
  const pixels = new Uint8Array(width * height * 4);
  const input = view.raster.color, stride = 8 * width;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let k = 0; k < 4; k++) {
    const at = y * 2 * stride + x * 8 + k;
    pixels[(y * width + x) * 4 + k] = Math.round((input[at]! + input[at+4]! + input[at+stride]! + input[at+stride+4]!) / 4);
  }
  writeFileSync(join(folder, name + ".png"), encodePng(width, height, pixels));
}

rig.a.rest();
solve(rig, rig.a, rig.solved);
const stage = new Stage(pack, width, height);
[stage.cam.x, stage.cam.y, stage.cam.z] = sedan.anchors.camera_driver;
Object.assign(stage.cam, { pitch: -.13, yaw: -.085, fovY: 1.25 });
stage.begin();
textures.forEach((t, i) => stage.texture(i, t.role, t.pictures));
for (const where of [{ x: 0,y: 0,z: 0 }, { x: -1, y: 0, z: 9, yaw: .28 }]) {
  stage.add(sedan.id, 0, { ...where, bone: stage.pose(rig, where), regions: colors });
}
writeFileSync(join(folder, "driver.png"), encodePng(width, height, stage.render()));
