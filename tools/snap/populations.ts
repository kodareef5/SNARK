// Sheets of each built-in population: 24 of its people at full length, each in the outfit and dyes its seed draws, as
// Cast dresses them. One sheet a population. `bun tools/snap/populations.ts [--out var/populations] [--graphics high]
// [--width 160] [--only core:people_beach]`.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { POPULATIONS } from "../../content/people/defaults.ts";
import { LOOK_BYTES } from "../../shared/anim/look.ts";
import { partSeed, personFrom } from "../../shared/people/person.ts";
import { WORN_FIELDS, WORN_LENGTH } from "../../shared/sim/entities.ts";
import { label, provingView, settle, type ProvingView } from "../snap.ts";
import { gameFiles } from "./files.ts";
import { encodePng } from "./png.ts";

const args = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const OUT = resolve(arg("out") ?? "var/populations");
const TIER = arg("graphics") ?? "high";
const W = Number(arg("width") ?? 160), H = W * 2;
const COLUMNS = 12, PEOPLE = 24;

const view: ProvingView = provingView(W, H, {}, await gameFiles());
view.scene.assets.tier = tierOf(TIER);
view.scene.viewHeight = H * 3;
view.scene.hour = 11;
const r = view.remote, reg = view.reg;
r.count = 1;
r.tick = 0;
[r.id[0], r.kind[0], r.x[0], r.z[0], r.yaw[0], r.flags[0], r.anim[0], r.hasLook[0], r.hasWardrobe[0]] = [4096, reg.index.get("core:survivor")!, 256, 228, Math.PI + 0.5, 1, 0, 1, 1];
r.y[0] = view.hf.heightAt(256, 228);

/** One tile: the body in `look`, dressed in `wear` with each garment's main colour, seen whole from 3.4 m. */
function tile(look: Uint8Array, wear: readonly string[], dyes: readonly number[]): Uint8ClampedArray {
  r.look.set(look, 0);
  r.wardrobe.fill(0, 0, WORN_LENGTH);
  wear.forEach((id, i) => {
    const item = reg.index.get(id) ?? 0, slot = reg.garmentSlot[item] ?? -1;
    if (slot >= 0) r.wardrobe.set([item, 0, dyes[i] ?? 0], slot * WORN_FIELDS);
  });
  const cam = view.cam;
  [cam.yaw, cam.pitch, cam.fovY, cam.aspect] = [0.15, -0.04, 0.62, W / H];
  cam.x = r.x[0]! - 3.4 * Math.sin(0.15);
  cam.z = r.z[0]! - 3.4 * Math.cos(0.15);
  cam.y = r.y[0]! + 0.95;
  settle(view);
  for (let k = 0; k < 6; k++) view.render();
  return view.raster.color.slice();
}

mkdirSync(OUT, { recursive: true });
for (const p of POPULATIONS) {
  if (arg("only") && arg("only") !== p.id) continue;
  const rows = Math.ceil(PEOPLE / COLUMNS), SW = COLUMNS * W, SH = rows * H, pixels = new Uint8ClampedArray(SW * SH * 4);
  for (let k = 0; k < PEOPLE; k++) {
    const seed = partSeed(0x5eed, 0x5e00 + k), person = personFrom(seed, p, new Uint8Array(LOOK_BYTES));
    const t = tile(person.look, person.outfit >= 0 ? p.outfits![person.outfit]!.wear : [], person.dyes);
    const ox = (k % COLUMNS) * W, oy = Math.floor(k / COLUMNS) * H;
    for (let y = 0; y < H; y++) pixels.set(t.subarray(y * W * 4, (y + 1) * W * 4), ((oy + y) * SW + ox) * 4);
    label(pixels, SW, `${person.outfit + 1}`, ox + 4, oy + 4, 1);
  }
  label(pixels, SW, p.label, 4, SH - 12, 1);
  const file = join(OUT, `${p.id.split(":")[1]}.png`);
  writeFileSync(file, encodePng(SW, SH, pixels));
  console.log(file);
}
process.exit(0);
