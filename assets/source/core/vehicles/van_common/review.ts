// Draw the two coachbuilt vans with the game's meshes, rig, lighting and streamed material pictures.
// Run from the checkout with bun assets/source/core/vehicles/van_common/review.ts.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeBones } from "../../../../../client/core/render/characters.ts";
import { CARAVAN_ART, PANEL_VAN_ART } from "../../../../../content/vehicles/van-art.ts";
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
const width = 720;
const height = 426;
const sheetWidth = 2 * width + 3;
const sheetHeight = 2 * height + 3;
for (const art of [PANEL_VAN_ART, CARAVAN_ART]) {
  const cargo = art.id === "core:panel_van";
  const asset = assets.find(a => a.id === art.id)!;
  const pack = parsePack(new Uint8Array(readFileSync(asset.file)));
  const mesh = pack.meshIndex.get(art.id)!;
  const rig = buildRig(pack.header.rigs[pack.header.meshes[mesh]!.rig!]!, pack.clips)!;
  const mats = materialsOf(asset);
  const textures = (pack.header.textures ?? []).map(t => rgbaOf(mats.find(m => t.id === `${m.id}/${t.role}`)!, t.role, t.top));
  const regions = [cargo ? 10 : 5, 104, 91];
  const sheet = new Uint8Array(sheetWidth * sheetHeight * 4).fill(250);
  const cell = (x: number, y: number, pixels: Uint8ClampedArray | Uint8Array) => {
    for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
      const at = ((row + y) * sheetWidth + col + x) * 4;
      const src = (row * 2 * (width * 2) + col * 2) * 4;
      for (let ch = 0; ch < 3; ch++) sheet[at + ch] = Math.round((
        pixels[src + ch]! + pixels[src + ch + 4]! + pixels[src + ch + 8 * width]! + pixels[src + ch + 8 * width + 4]!) / 4);
      sheet[at + 3] = 255;
    }
  };
  const pose = (opened: boolean) => {
    rig.a.rest();
    const offsets = new Float32Array(rig.bones * 3);
    if (opened) {
      for (const [s, side] of [[1, "left"], [-1, "right"]] as const) {
        quatAxis(rig.a.rot, rig.names.indexOf(`door_${side}`) * 4, 0, 1, 0, -s * 1.1);
        const slide = rig.names.indexOf(`door_slide_${side}`);
        if (slide >= 0) offsets.set([s * .115, 0, -art.slideTravel], slide * 3);
      }
    }
    solve(rig, rig.a, rig.solved, rig.rest, null, offsets);
  };
  const view = new ModelView(pack, width * 2, height * 2, [.84, .85, .85]);
  textures.forEach((t, i) => view.texture(i, t.role, t.pictures));
  const outside = (col: number, row: number, around: number, above: number, open: boolean) => {
    pose(open);
    view.draw({ mesh, level: 0, around, above, centre: [0, art.height * .51, 0],
      radius: art.halfLength * 1.20, zoom: open ? 1.64 : cargo ? 1.89 : 1.87, rig, colors: regions, textured: true });
    cell(col * (width + 3), row * (height + 3), view.raster.color);
  };
  outside(0, 0, 49, 13, false);
  outside(1, 0, 220, 14, false);
  outside(0, 1, 268, 7, true);
  const stage = new Stage(pack, width * 2, height * 2);
  [stage.cam.x, stage.cam.y, stage.cam.z, stage.cam.yaw, stage.cam.pitch, stage.cam.fovY] = cargo
    ? [.54, 1.73, .12, Math.PI + .17, -.30, 1.22]
    : [-.92, 1.40, -.80, .71, -.24, 1.28];
  stage.begin();
  textures.forEach((t, i) => stage.texture(i, t.role, t.pictures));
  const bone = stage.pose(rig, { x: 0, y: 0, z: 0 });
  pose(true);
  writeBones(stage.packet.bones, 0, rig.solved, rig.rest, null, -stage.cam.x, -stage.cam.y, -stage.cam.z, 0);
  stage.add(art.id, 0, { x: 0, y: 0, z: 0, bone, regions });
  cell(width + 3, height + 3, stage.render());
  writeFileSync(join(asset.dir, "ref/review.png"), encodePng(sheetWidth, sheetHeight, sheet));
  // A second native van, parked ahead, makes an opaque windscreen immediately apparent.
  const driver = new Stage(pack, 960, 540);
  const [eyeX, eyeY, eyeZ] = art.anchors.camera_driver;
  Object.assign(driver.cam, { x: eyeX, y: eyeY, z: eyeZ, yaw: -.13, pitch: -.135, fovY: 1.26 });
  driver.begin();
  textures.forEach((t, i) => driver.texture(i, t.role, t.pictures));
  const parked = { x: -1.45, y: 0, z: 9, yaw: .28 };
  driver.add(art.id, 0, { ...parked, bone: driver.pose(rig, parked), regions });
  const driverVan = { x: 0, y: 0, z: 0 };
  driver.add(art.id, 0, { ...driverVan, bone: driver.pose(rig, driverVan), regions });
  writeFileSync(join(asset.dir, "ref/driver.png"), encodePng(960, 540, driver.render()));
}
