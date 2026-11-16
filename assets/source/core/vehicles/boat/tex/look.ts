// The original boat as the game's own renderer draws it, from the pictures and the pack as they are now: every stage of its
// hurt and decay layer from three sides, a turned outboard, and the driver's view out through the windscreen. No build;
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
import { BOAT_ART as H } from "../../../../../../content/vehicles/boat-art.ts";

const args = process.argv.slice(2);
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : undefined;
if (!out) throw new Error("--out DIR");
mkdirSync(out, { recursive: true });

const ID = args.includes("--asset") ? args[args.indexOf("--asset") + 1]! : H.id;
const asset = (await findAssets()).find((a) => a.id === ID)!;
const pack = parsePack(new Uint8Array(readFileSync(asset.file)));
const index = pack.meshIndex.get(ID)!;
const rig = buildRig(pack.header.rigs[pack.header.meshes[index]!.rig!]!, pack.clips)!;
const materials = materialsOf(asset);
const textures = (pack.header.textures ?? []).map((t) => rgbaOf(materials.find((m) => t.id === `${m.id}/${t.role}`)!, t.role, t.top, null));
// The liveries use the asset's measured dye samples.
const COLORS = asset.spec.kind === "creature" ? asset.spec.regions.map(r=>r.sample ?? 0) : [];
const STAGES = Array.from({ length: LAYER_STAGES + 1 }, (_, s) => (s * LAYER_LEVELS) / LAYER_STAGES);
const BACKGROUND = [0.84, 0.83, 0.81] as const;

/** The rig at rest, or with its helm and outboard turned. */
function posed(open: number): void {
  rig.a.rest();
  quatAxis(rig.a.rot, rig.names.indexOf("steering") * 4, 0, 0, 1, open);
  quatAxis(rig.a.rot, rig.names.indexOf("outboard") * 4, 0, 1, 0, open * .55 / .65);
  solve(rig, rig.a, rig.solved);
}

type Shot = [centre: readonly [number, number, number], radius: number, around: number, above: number];
const VIEWS: Record<string, Shot> = {
  front_left: [[0, 1.10, -.20], 4.3, 35, 24],
  back_right: [[0, 1.10, -.20], 4.3, 215, 26],
  side: [[0, 1.10, -.20], 4.3, 90, 8],
  nose: [[0, 1.12, 2.15], 1.7, 30, 30],
  cabin: [[0, 1.45, -.20], 2.1, 70, 28],
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
  const [x, y, z] = H.anchors.camera_driver;
  [stage.cam.x, stage.cam.y, stage.cam.z, stage.cam.yaw, stage.cam.pitch, stage.cam.fovY] = [x, y, z, -0.12, -0.12, 1.2];
  stage.begin();
  textures.forEach((t, slot) => stage.texture(slot, t.role, t.pictures));
  const bone = stage.pose(rig, { x: 0, y: 0, z: 0 });
  stage.add(ID, 0, { x: 0, y: 0, z: 0, bone, regions: COLORS });
  return { w: width, h: height, img: new Uint8Array(stage.render()) };
}

const write = (name: string, p: { w: number; h: number; img: Uint8Array }): void => {
  const file = join(out, `${name}.png`);
  writeFileSync(file, encodePng(p.w, p.h, p.img));
  console.log(file);
};

for (const [name, shot] of Object.entries(VIEWS)) write(`stages_${name}`, row(shot, 300, 2, name === "cabin" ? .65 : 0));
write("steering", row(VIEWS.back_right!, 300, 2, .65));
write("driver", driver(960, 540));
const view=new ModelView(pack,1600,1000,BACKGROUND);
textures.forEach((t,slot)=>view.texture(slot,t.role,t.pictures));
posed(0);
view.draw({mesh:index,level:0,centre:[0,1.10,-.20],radius:3.0,around:35,above:24,rig,colors:COLORS,textured:true});
write("hero",{w:1600,h:1000,img:new Uint8Array(view.raster.color)});
