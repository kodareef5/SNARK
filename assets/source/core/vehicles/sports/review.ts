// Re-render the production skin, front-hinged doors and driver view from both checked-in SNPKs.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { VELOCE_ART, BERLINETTA_ART } from "../../../../../content/vehicles/sports-art.ts";
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

const assets = await findAssets();
const width = 720, height = 395;
const shots = [
  { name: "front", around: 37, above: 14, open: 0, radius: 1.51 },
  { name: "rear", around: 217, above: 16, open: 0, radius: 1.54 },
  { name: "doors", around: 75, above: 24, open: 1.1, radius: 1.67 },
];

for (const art of [VELOCE_ART, BERLINETTA_ART]) {
  const asset = assets.find(a => a.id === art.id)!;
  const pack = parsePack(new Uint8Array(readFileSync(asset.file)));
  const mesh = pack.meshIndex.get(asset.id)!;
  const rig = buildRig(pack.header.rigs[pack.header.meshes[mesh]!.rig!]!, pack.clips)!;
  const materials = materialsOf(asset);
  const textures = (pack.header.textures ?? []).map(t => rgbaOf(materials.find(m => t.id === `${m.id}/${t.role}`)!, t.role, t.top, null));
  const colors = art.id === "core:veloce" ? [47, 84, 91, 0, 0, 0] : [46, 97, 91, 0, 0, 0];
  const folder = join(asset.dir, "ref", "review");
  mkdirSync(folder, { recursive: true });

  const view = new ModelView(pack, width * 2, height * 2, [.82, .835, .846]);
  textures.forEach((t, slot) => view.texture(slot, t.role, t.pictures));
  for (const shot of shots) {
    rig.a.rest();
    for (const [side, sign] of [["left", -1], ["right", 1]] as const)
      quatAxis(rig.a.rot, rig.names.indexOf(`door_${side}`) * 4, 0, 1, 0, sign * shot.open);
    solve(rig, rig.a, rig.solved);
    view.draw({ ...shot, mesh, level: 0, centre: [0, .62, 0], rig, colors, textured: true });

    const data = new Uint8Array(width * height * 4), src = view.raster.color;
    const stride = width * 2 * 4;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let channel = 0; channel < 4; channel++) {
      const pixel = 2 * y * stride + 8 * x + channel;
      data[(y * width + x) * 4 + channel] = Math.round((src[pixel]! + src[pixel + 4]! + src[pixel + stride]! + src[pixel + stride + 4]!) / 4);
    }
    writeFileSync(join(folder, `${shot.name}.png`), encodePng(width, height, data));
  }

  // A second vehicle seven metres ahead gives the driver's eye a known target through the glazing.
  const stage = new Stage(pack, width, height);
  [stage.cam.x, stage.cam.y, stage.cam.z] = art.anchors.camera_driver;
  stage.cam.yaw = -.08;
  stage.cam.pitch = -.13;
  stage.cam.fovY = 1.24;
  stage.begin();
  textures.forEach((t, slot) => stage.texture(slot, t.role, t.pictures));
  const origin = { x: 0, y: 0, z: 0 }, ahead = { x: -.18, y: 0, z: 7.6, yaw: .18 };
  stage.add(asset.id, 0, { ...origin, bone: stage.pose(rig, origin), regions: colors });
  stage.add(asset.id, 0, { ...ahead, bone: stage.pose(rig, ahead), regions: [41, 97, 91] });
  writeFileSync(join(folder, "driver.png"), encodePng(width, height, new Uint8Array(stage.render())));
}
