// A road vehicle's or a vessel's hurt and decay layer as the game's own rasterizer draws it, from its pack and pictures
// as they are now: from the front on the driver's (port) side and from the rear on the other, a row of its seven stages
// (unhurt, hurt 1 to 3, decay 1 to 3) in each wear story of its kind (client/core/render/wear.ts), a row a story, story
// 0 being every mark the layer has. No build; nothing is written outside --out.
//
//   bun tools/art/wear.ts --out DIR core:compact core:veloce ...   [--side PIXELS] [--stories 0,1,2,3,4,5] [--paint COLOUR]
//
// --paint is a palette index for the paint, colour region 0, in place of the asset's sample.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LAYER_LEVELS, LAYER_STAGES } from "../../client/core/render/surface.ts";
import { MARINE_STORIES, ROAD_STORIES, WEAR_STORIES } from "../../client/core/render/wear.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { buildRig } from "../../shared/anim/rigs.ts";
import { solve } from "../../shared/anim/skeleton.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { ModelView } from "../snap.ts";
import { rgbaOf } from "../snap/files.ts";
import { encodePng } from "../snap/png.ts";
import { findAssets } from "./assets.ts";
import { materialsOf } from "./materials.ts";

const args = process.argv.slice(2);
const value = (name: string): string | undefined => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const out = value("out");
if (!out) throw new Error("--out DIR");
const side = Number(value("side") ?? 260);
const given = value("stories")?.split(",").map(Number);
/** Story 0 and the stories of the body's kind: a vessel's where its species moves as a boat. */
const storiesOf = (id: string): number[] => {
  const first = CORE_CONTENT.some((d) => d.id === id && d.type === "species" && d.vehicle?.movement === "boat") ? MARINE_STORIES : ROAD_STORIES;
  return given ?? [0, ...Array.from({ length: WEAR_STORIES }, (_, s) => first + s)];
};
const ids = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const STAGES = Array.from({ length: LAYER_STAGES + 1 }, (_, s) => (s * LAYER_LEVELS) / LAYER_STAGES);
const BACKGROUND = [0.84, 0.83, 0.81] as const;
const VIEWS = { front: [35, 14], rear: [215, 18] } as const;
const PAD = 6;
const SS = 2;

const found = await findAssets();
for (const id of ids) {
  const asset = found.find((a) => a.id === id);
  if (!asset || asset.spec.kind !== "creature") throw new Error(`no body ${id}`);
  const pack = parsePack(new Uint8Array(readFileSync(asset.file)));
  const mesh = pack.meshIndex.get(id)!;
  const { center, half } = pack.header.meshes[mesh]!;
  const rig = buildRig(pack.header.rigs[pack.header.meshes[mesh]!.rig!]!, pack.clips)!;
  rig.a.rest();
  solve(rig, rig.a, rig.solved);
  const materials = materialsOf(asset);
  const colors = [...asset.spec.regions.map((r) => r.sample), 0, 0, 0].slice(0, 6);
  if (value("paint") !== undefined) colors[0] = Number(value("paint"));
  const view = new ModelView(pack, side * SS, side * SS, BACKGROUND);
  (pack.header.textures ?? []).forEach((t, slot) => view.texture(slot, t.role, rgbaOf(materials.find((m) => t.id === `${m.id}/${t.role}`)!, t.role, t.top).pictures));
  const radius = Math.hypot(half[0], half[1], half[2]) * 0.76;
  const stories = storiesOf(id);
  const dir = join(out, id.split(":")[1]!);
  mkdirSync(dir, { recursive: true });
  for (const [name, [around, above]] of Object.entries(VIEWS)) {
    const w = STAGES.length * (side + PAD) + PAD;
    const h = stories.length * (side + PAD) + PAD;
    const img = new Uint8Array(w * h * 4).fill(214);
    stories.forEach((wear, r) => STAGES.forEach((layer, k) => {
      view.draw({ mesh, level: 0, centre: [0, center[1], center[2]], radius, around, above, rig, colors, textured: true, layer, wear });
      const src = view.raster.color;
      const [x0, y0] = [PAD + k * (side + PAD), PAD + r * (side + PAD)];
      for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) sum += src[((y * SS + dy) * side * SS + x * SS + dx) * 4 + c]!;
        img[((y0 + y) * w + x0 + x) * 4 + c] = Math.round(sum / (SS * SS));
      }
    }));
    const file = join(dir, `${name}.png`);
    writeFileSync(file, encodePng(w, h, img));
    console.log(file);
  }
}
