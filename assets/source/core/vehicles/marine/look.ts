// A vessel as the game's own rasterizer draws it from its pack and its pictures as they are now (no build), from the
// views its painter and its reviewer look at: the bow and the stern quarters, the port side, from above, and close on
// the bow, the transom and the helm. Nothing is written outside --out.
//
//   bun assets/source/core/vehicles/marine/look.ts --out DIR core:thunderbolt ... [--stage 0-6] [--story N]
//       [--colors 29,104] [--afloat | --water Y] [--full] [--size 900] [--views hero,stern,side,top,bow,transom,helm] [--asset core:x_sunk]
//
// --full draws every picture at the size the pack stores it, as a card on the high or ultra tier does, where the rgba
// variant (and so the client's software rasterizer) stops at 1024. --stage is the hurt and decay layer's stage: 0 whole, 1 to 3 hurt, 4 to 6 decay. --story is the wear story it is
// drawn in (client/core/render/wear.ts; a vessel's are 6 to 10), 0 for every mark. --afloat hides what lies under the
// waterline, and --water Y what lies under height Y of the model. --source reads another tree's asset folders. --asset draws another asset on the vessel's measurements, such as one of its wreck forms.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LAYER_LEVELS, LAYER_STAGES } from "../../../../../client/core/render/surface.ts";
import { MARINE_MODELS } from "../../../../../content/vehicles/marine-fleet.ts";
import { buildRig } from "../../../../../shared/anim/rigs.ts";
import { solve } from "../../../../../shared/anim/skeleton.ts";
import { parsePack } from "../../../../../shared/pack/pack.ts";
import { findAssets } from "../../../../../tools/art/assets.ts";
import { materialsOf, readMaps, type Material } from "../../../../../tools/art/materials.ts";
import { materialMips, rgbaPicture } from "../../../../../tools/pack/texture.ts";
import type { TextureRole } from "../../../../../shared/pack/texture.ts";
import { ModelView } from "../../../../../tools/snap.ts";
import { rgbaOf } from "../../../../../tools/snap/files.ts";
import { encodePng } from "../../../../../tools/snap/png.ts";

const args = process.argv.slice(2);
const value = (name: string): string | undefined => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const out = value("out");
if (!out) throw new Error("--out DIR");
const size = Number(value("size") ?? 900);
const stage = Number(value("stage") ?? 0);
const story = Number(value("story") ?? 0);
const water = value("water");
const afloat = args.includes("--afloat") || water !== undefined;
const VALUED = ["out", "size", "stage", "story", "colors", "views", "asset", "water", "source"];
const ids = args.filter((a, i) => a.startsWith("core:") && !VALUED.includes(args[i - 1]?.slice(2) ?? ""));
const SS = 2;

const found = await findAssets(value("source"));
for (const id of ids) {
  const model = MARINE_MODELS.find((m) => m.id === id);
  if (!model) throw new Error(`no vessel ${id}`);
  const asset = found.find((a) => a.id === (value("asset") ?? id));
  if (!asset || asset.spec.kind !== "creature") throw new Error(`no body ${value("asset") ?? id}`);
  const pack = parsePack(new Uint8Array(readFileSync(asset.file)));
  const mesh = pack.meshIndex.get(asset.id)!;
  const rig = buildRig(pack.header.rigs[pack.header.meshes[mesh]!.rig!]!, pack.clips)!;
  rig.a.rest();
  solve(rig, rig.a, rig.solved);
  const materials = materialsOf(asset);
  const colors = [...asset.spec.regions.map((r) => r.sample), 0, 0, 0, 0, 0].slice(0, 6);
  (value("colors")?.split(",").map(Number) ?? []).forEach((c, k) => (colors[k] = c));
  const background = afloat ? ([0.16, 0.27, 0.31] as const) : ([0.84, 0.83, 0.81] as const);
  const view = new ModelView(pack, size * SS, size * SS, background);
  const full = new Map<string, Partial<Record<TextureRole, Uint8Array[]>>>();
  const picturesOf = (m: Material, role: TextureRole, top: number): Uint8Array[] => {
    if (!args.includes("--full")) return rgbaOf(m, role, top).pictures;
    if (!full.has(m.id)) full.set(m.id, materialMips(readMaps(m)));
    return full.get(m.id)![role]!.slice(0, Math.log2(top) + 1).map((p) => rgbaPicture(role, p));
  };
  (pack.header.textures ?? []).forEach((t, slot) => view.texture(slot, t.role, picturesOf(materials.find((m) => t.id === `${m.id}/${t.role}`)!, t.role, t.top)));
  const L = model.length, B = model.beam, H = model.height;
  const helm = model.seats[0]!;
  // Each view: degrees around from the bow toward port, degrees above, the point looked at and the radius held.
  const VIEWS: Record<string, [number, number, readonly [number, number, number], number]> = {
    hero: [35, 14, [0, H * 0.4, 0], Math.max(L * 0.36, H * 0.6)],
    stern: [215, 18, [0, H * 0.4, 0], Math.max(L * 0.36, H * 0.6)],
    side: [90, 3, [0, H * 0.45, 0], L * 0.45],
    top: [30, 62, [0, H * 0.3, 0], L * 0.4],
    bow: [40, 12, [0, model.draft + 0.3, L * 0.32], Math.max(B, L * 0.2)],
    transom: [200, 10, [0, model.draft + 0.4, -L * 0.42], Math.max(B * 0.75, L * 0.13)],
    helm: [168, 20, [helm[0], helm[1] + 0.35, helm[2] + 0.7], Math.max(1.3, B * 0.3)],
  };
  const chosen = (value("views") ?? Object.keys(VIEWS).join(",")).split(",");
  const dir = join(out, (value("asset") ?? id).split(":")[1]!);
  mkdirSync(dir, { recursive: true });
  for (const name of chosen) {
    const [around, above, centre, radius] = VIEWS[name]!;
    view.draw({ mesh, level: 0, centre, radius, around, above, rig, colors, textured: true, layer: (stage * LAYER_LEVELS) / LAYER_STAGES, wear: story, ...(afloat ? { floor: water !== undefined ? Number(water) : model.draft } : {}) });
    const src = view.raster.color;
    const img = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) sum += src[((y * SS + dy) * size * SS + x * SS + dx) * 4 + c]!;
      img[(y * size + x) * 4 + c] = Math.round(sum / (SS * SS));
    }
    const file = join(dir, `${name}${stage ? `-stage${stage}` : ""}${story ? `-story${story}` : ""}.png`);
    writeFileSync(file, encodePng(size, size, img));
    console.log(file);
  }
}
