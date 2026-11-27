// Fire that stands (client/core/render/fires.ts), seen as it plays: a lit campfire on the proving ground's grass and
// burning hulls on its water, each from near, farther, far off and from over it, drawn as a client draws them.
//
//   bun run snap -- --fire --graphics high --hour 12 --at 1500
//
// --kinds takes kinds by name (core:campfire_lit, core:zzzzhull_needle_burning, ...), --at the scene's clock in ms,
// --hour the hour, --size WxH a frame and --out FILE the picture.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import type { ProvingView } from "../snap.ts";
import { GLYPH_HEIGHT, GLYPH_WIDTH, glyphPixel } from "./font.ts";
import { encodePng } from "./png.ts";

const KINDS = ["core:campfire_lit", "core:zzzzhull_needle_burning", "core:zzzzhull_meridian_burning"] as const;
/** The eye from each kind's fire: its distance in heights of the fire's tallest tip, and how far over it it looks down, in radians. */
const VIEWS = [{ name: "near", far: 4, down: 0.12 }, { name: "farther", far: 14, down: 0.08 }, { name: "far off", far: 60, down: 0.04 }, { name: "from over it", far: 7, down: 0.7 }] as const;

/** Writes `text` at (x, y) of a picture `width` across, each pixel of the font two square, on a dark band. */
function label(pixels: Uint8ClampedArray, width: number, text: string, x: number, y: number): void {
  const put = (px: number, py: number, rgb: readonly number[]): void => {
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) pixels.set(rgb, ((py + dy) * width + px + dx) * 4);
  };
  for (let py = y - 2; py < y + (GLYPH_HEIGHT + 1) * 2; py += 2) for (let px = x - 2; px < x + text.length * (GLYPH_WIDTH + 1) * 2; px += 2) put(px, py, [20, 22, 26, 255]);
  [...text].forEach((ch, i) => {
    for (let col = 0; col < GLYPH_WIDTH; col++) for (let row = 0; row < GLYPH_HEIGHT; row++) if (glyphPixel(ch.charCodeAt(0), col, row)) put(x + (i * (GLYPH_WIDTH + 1) + col) * 2, y + row * 2, [240, 240, 240, 255]);
  });
}

/** Open water a little out from the proving ground's edge, with room round it. */
function water(view: ProvingView): [number, number] {
  const hf = view.hf;
  for (let z = 256; z < 320; z += 1) for (let x = 120; x < 200; x += 1) if (hf.heightAt(x, z) < hf.waterAt(x, z) - 2 && hf.heightAt(x - 20, z) < hf.waterAt(x - 20, z) - 1) return [x - 10, z];
  return [160, 280];
}

/** Each kind's fire, a row each, from each view, at the scene's clock `ms`. */
export function fireSheet(view: ProvingView, w: number, h: number, kinds: readonly string[], ms: number): { width: number; height: number; pixels: Uint8ClampedArray; lines: string[] } {
  const { scene, cam, remote, hf, raster, reg, structs } = view;
  remote.count = 0;
  cam.aspect = w / h;
  const [W, H] = [w * VIEWS.length, h * kinds.length];
  const pixels = new Uint8ClampedArray(W * H * 4);
  const lines: string[] = [];
  const [wx, wz] = water(view);
  kinds.forEach((name, row) => {
    const kind = reg.index.get(name);
    if (kind === undefined) throw new Error(`no kind ${name}`);
    const afloat = reg.ablaze[kind] === 1;
    // Each on its own ground, apart from the last.
    const x = afloat ? wx - row * 40 : 236 + row * 30, z = afloat ? wz : 372;
    const floor = afloat ? hf.waterAt(x, z) - 0.25 * reg.halfY[kind]! : hf.heightAt(x, z);
    const ref = structs.add(kind, x, floor + reg.halfY[kind]!, z, 0x2a00, 0, 1);
    const tip = Math.max(1, 2 * reg.halfY[kind]! * (afloat ? 1.4 : 2.4));
    VIEWS.forEach((v, col) => {
      const far = v.far * tip, mid = floor + 0.5 * tip;
      [cam.x, cam.z] = [x - far * Math.cos(v.down) * 0.6, z - far * Math.cos(v.down) * 0.8];
      cam.y = Math.max(mid + far * Math.sin(v.down), Math.max(hf.heightAt(cam.x, cam.z), hf.waterAt(cam.x, cam.z)) + 1.7);
      cam.yaw = Math.atan2(x - cam.x, z - cam.z);
      cam.pitch = Math.atan2(mid - cam.y, Math.hypot(x - cam.x, z - cam.z));
      // A few frames to the moment, so the card holds what is seen there.
      for (let k = 3; k >= 0; k--) {
        scene.now = ms - (k * 1000) / 60;
        remote.tick = (scene.now * TICK_RATE) / 1000;
        raster.take(scene.build(cam, remote));
      }
      raster.render(scene.packet);
      for (let py = 0; py < h; py++) pixels.set(raster.color.subarray(py * w * 4, (py + 1) * w * 4), ((row * h + py) * W + col * w) * 4);
      label(pixels, W, `${v.name}, ${Math.round(Math.hypot(x - cam.x, z - cam.z))} m`, col * w + 6, row * h + 6);
      lines.push(`${name} ${v.name}: ${scene.fires.fires} fires, ${scene.fires.blazes} blazes in ${scene.fires.draws} draws, ${scene.fires.count} cards, fill ${scene.fires.fill.toFixed(3)} screens`);
    });
    label(pixels, W, `${name.replace("core:", "")}, ${scene.assets.tier.name}`, 6, (row + 1) * h - 22);
    structs.remove(ref);
  });
  return { width: W, height: H, pixels, lines };
}

/** `bun run snap -- --fire`: the sheet as a PNG, and what each frame held. `provingView` is snap.ts's. */
export function fireSnap(arg: (name: string) => string | undefined, provingView: (width: number, height: number) => ProvingView): void {
  const [w, h] = (arg("size") ?? "400x300").split("x").map(Number) as [number, number];
  const view = provingView(w, h);
  view.scene.assets.tier = tierOf(arg("graphics") ?? "high");
  view.scene.viewHeight = h;
  if (arg("hour") !== undefined) view.scene.hour = Number(arg("hour"));
  const t0 = performance.now();
  const sheet = fireSheet(view, w, h, arg("kinds")?.split(",") ?? KINDS, Number(arg("at") ?? 1500));
  const out = resolve(arg("out") ?? `artifacts/fires/fires-${view.scene.assets.tier.name}${arg("hour") !== undefined ? `-${arg("hour")}h` : ""}.png`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, encodePng(sheet.width, sheet.height, sheet.pixels));
  console.log(out);
  for (const line of sheet.lines) console.log(line);
  console.log(`${sheet.width}x${sheet.height}  ${(performance.now() - t0).toFixed(0)} ms`);
}
