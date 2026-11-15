// The compact as the game's own renderer draws it, from the pictures and the pack as they are now: every stage of its
// hurt and decay layer from three sides, its doors open, and the driver's view out through the windscreen. No build;
// nothing is written outside --out. The renderer reads the rgba variant, where the layer is stored at 512 across.
//
//   bun tex/look.ts --out DIR
//
// A stages picture is a row of seven: unhurt, hurt stages 1, 2 and 3 (3 is also a fresh wreck), then decay 1, 2 and 3.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LAYER_LEVELS, LAYER_STAGES } from "../../../../../../client/core/render/surface.ts";
import { buildRig } from "../../../../../../shared/anim/rigs.ts";
import { solve } from "../../../../../../shared/anim/skeleton.ts";
import { quatAxis } from "../../../../../../shared/math/quat.ts";
import { parsePack } from "../../../../../../shared/pack/pack.ts";
import { findAssets } from "../../../../../../tools/art/assets.ts";
import { materialsOf } from "../../../../../../tools/art/materials.ts";
import { ModelView } from "../../../../../../tools/snap.ts";
import { rgbaOf } from "../../../../../../tools/snap/files.ts";
import { encodePng } from "../../../../../../tools/snap/png.ts";
import { Stage } from "../../../../../../tests/fixtures/stage.ts";
import { COMPACT_ART as COMPACT } from "../../../../../../content/vehicles/compact-art.ts";

const args = process.argv.slice(2);
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : undefined;
if (!out) throw new Error("--out DIR");
mkdirSync(out, { recursive: true });

const asset = (await findAssets()).find((a) => a.id === COMPACT.id)!;
const pack = parsePack(new Uint8Array(readFileSync(asset.file)));
const index = pack.meshIndex.get(COMPACT.id)!;
const rig = buildRig(pack.header.rigs[pack.header.meshes[index]!.rig!]!, pack.clips)!;
const materials = materialsOf(asset);
const textures = (pack.header.textures ?? []).map((t) => rgbaOf(materials.find((m) => t.id === `${m.id}/${t.role}`)!, t.role, t.top, null));
// Blue paint, tan leather, silver alloys: asset.ts's samples.
const COLORS = [41, 220, 91, 0, 0, 0];
const STAGES = Array.from({ length: LAYER_STAGES + 1 }, (_, s) => (s * LAYER_LEVELS) / LAYER_STAGES);
const BACKGROUND = [0.84, 0.83, 0.81] as const;

/** The rig at rest, or with both doors open. */
function posed(open: number): void {
  rig.a.rest();
  quatAxis(rig.a.rot, rig.names.indexOf("door_left") * 4, 0, 1, 0, -open);
  quatAxis(rig.a.rot, rig.names.indexOf("door_right") * 4, 0, 1, 0, open);
  solve(rig, rig.a, rig.solved);
}

type Shot = [centre: readonly [number, number, number], radius: number, around: number, above: number];
const VIEWS: Record<string, Shot> = {
  front_left: [[0, 0.7, 0], 2.2, 35, 14],
  back_right: [[0, 0.7, 0], 2.2, 215, 18],
  side: [[0, 0.7, 0], 2.2, 90, 4],
  nose: [[0.3, 0.6, 1.4], 0.8, 30, 12],
  cabin: [[0.2, 0.8, 0.1], 1.0, 70, 35],
};

function row(shot: Shot, side: number, ss: number, open = 0): { w: number; h: number; img: Uint8Array } {
  const pad = 8;
  const w = STAGES.length * (side + pad) + pad;
  const h = side + pad * 2;
  const img = new Uint8Array(w * h * 4).fill(214);
  const view = new ModelView(pack, side * ss, side * ss, BACKGROUND);
  textures.forEach((t, slot) => view.texture(slot, t.role, t.pictures));
  posed(open);
  STAGES.forEach((layer, k) => {
    view.draw({ mesh: index, level: 0, centre: shot[0], radius: shot[1], around: shot[2], above: shot[3], rig, colors: COLORS, textured: true, layer });
    const src = view.raster.color;
    const x0 = pad + k * (side + pad);
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        for (let c = 0; c < 4; c++) {
          let sum = 0;
          for (let dy = 0; dy < ss; dy++) for (let dx = 0; dx < ss; dx++) sum += src[((y * ss + dy) * side * ss + x * ss + dx) * 4 + c]!;
          img[((pad + y) * w + x0 + x) * 4 + c] = Math.round(sum / (ss * ss));
        }
      }
    }
  });
  return { w, h, img };
}

/** From the driver's eye (the contract's camera_driver), looking ahead and a little down: through the windscreen. */
function driver(width: number, height: number): { w: number; h: number; img: Uint8Array } {
  const stage = new Stage(pack, width, height);
  const [x, y, z] = COMPACT.anchors.camera_driver;
  [stage.cam.x, stage.cam.y, stage.cam.z, stage.cam.yaw, stage.cam.pitch, stage.cam.fovY] = [x, y, z, -0.12, -0.12, 1.2];
  stage.begin();
  textures.forEach((t, slot) => stage.texture(slot, t.role, t.pictures));
  const bone = stage.pose(rig, { x: 0, y: 0, z: 0 });
  stage.add(COMPACT.id, 0, { x: 0, y: 0, z: 0, bone, regions: COLORS });
  return { w: width, h: height, img: new Uint8Array(stage.render()) };
}

const write = (name: string, p: { w: number; h: number; img: Uint8Array }): void => {
  const file = join(out, `${name}.png`);
  writeFileSync(file, encodePng(p.w, p.h, p.img));
  console.log(file);
};

for (const [name, shot] of Object.entries(VIEWS)) write(`stages_${name}`, row(shot, 300, 2, name === "cabin" ? 1.1 : 0));
write("doors_open", row(VIEWS.front_left!, 300, 2, 1.1));
write("driver", driver(960, 540));
