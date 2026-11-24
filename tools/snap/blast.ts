// What burns, seen as it plays (client/core/render/blasts.ts): a blast on the proving ground at chosen moments after it
// went off, a row a seed, or a rocket in flight with its smoke, from the side and from where it was fired. Each frame is
// drawn as a client draws it, sixty a second, and the moments are put side by side.
//
//   bun run snap -- --blast rocket --surface ground --at 40,150,400,1000,2500 --graphics medium
//   bun run snap -- --rocket --graphics medium
//
// --surface takes air, ground, built, water, body or vehicle, and --made thatch, wood, stone or metal. --seeds N draws
// N rows, --far M stands M metres off, --hour H sets the hour, --size WxH a frame, --out FILE the picture.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { blastSeed } from "../../shared/net/rockets.ts";
import { BURST_LOOKS } from "../../shared/content/kinds/weapons.ts";
import type { ProvingView } from "../snap.ts";
import { GLYPH_HEIGHT, GLYPH_WIDTH, glyphPixel } from "./font.ts";
import { encodePng } from "./png.ts";

const SURFACES = ["air", "ground", "built", "water", "body", "vehicle"] as const;
const MADE = ["unknown", "thatch", "wood", "stone", "metal"] as const;

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

/** A place on the proving ground's water a little out from its edge, as the details' splash is drawn at. */
function water(view: ProvingView): [number, number] {
  const hf = view.hf;
  for (let z = 256; z < 300; z += 1) for (let x = 140; x < 200; x += 1) if (hf.heightAt(x, z) < hf.waterAt(x, z) - 0.6 && hf.heightAt(x + 3, z) > hf.waterAt(x + 3, z)) return [x - 4, z];
  return [172, 250];
}

export interface Sheet {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  lines: string[];
}

/** Runs frames, sixty a second, to `ms` past `from`: each is built and what it puts on the card taken, and the last is drawn. */
function runTo(view: ProvingView, from: number, ms: number, each: () => void): void {
  const { scene, cam, remote, raster } = view;
  while (scene.now < from + ms - 1e-6) {
    scene.now = Math.min(from + ms, scene.now + 1000 / 60);
    // The details move by the server's ticks, as the bodies the view holds do.
    remote.tick = (scene.now * TICK_RATE) / 1000;
    each();
    raster.take(scene.build(cam, remote));
  }
  raster.render(scene.packet);
}

/** A few frames from a new place, so the card holds what is seen there and the details know the eye and the tier. */
function arrive(view: ProvingView): void {
  for (let k = 0; k < 4; k++) {
    view.scene.now += 1000 / 60;
    view.remote.tick = (view.scene.now * TICK_RATE) / 1000;
    view.raster.take(view.scene.build(view.cam, view.remote));
  }
}

/** Blasts of `look` on `surface`, a row a seed and a column a moment, on the tier the view has. */
export function blastSheet(view: ProvingView, w: number, h: number, look: string, surface: string, made: string, moments: readonly number[], seeds: number, far: number): Sheet {
  const { scene, cam, remote, hf, raster } = view;
  const kind = SURFACES.indexOf(surface as (typeof SURFACES)[number]);
  if (kind < 0) throw new Error(`--surface takes ${SURFACES.join(", ")}, not "${surface}"`);
  if (!(BURST_LOOKS as readonly string[]).includes(look)) throw new Error(`--blast takes ${BURST_LOOKS.join(", ")}, not "${look}"`);
  const radius = look === "rocket" ? 7.5 : look === "grenade" ? 5 : 4;
  const [x0, z0] = surface === "water" ? water(view) : [236, 372];
  // What is built faces the eye; a body or a vehicle is hit from the eye's side.
  const [nx, ny, nz] = surface === "built" || surface === "body" || surface === "vehicle" ? [0, 0, -1] : [0, 1, 0];
  remote.count = 0;
  cam.aspect = w / h;
  const [W, H] = [w * moments.length, h * seeds];
  const pixels = new Uint8ClampedArray(W * H * 4);
  const lines: string[] = [];
  for (let row = 0; row < seeds; row++) {
    // Each row its own place, clear of what the row before left lying.
    const x = surface === "water" ? x0 : x0 + row * 30, z = surface === "water" ? z0 + row * 30 : z0;
    const ground = Math.max(hf.heightAt(x, z), surface === "water" ? hf.waterAt(x, z) : -Infinity);
    const y = surface === "air" ? ground + 9 : surface === "ground" || surface === "water" ? ground : ground + 1.6;
    cam.x = x;
    cam.z = z - far;
    cam.y = Math.max(hf.heightAt(cam.x, cam.z), hf.waterAt(cam.x, cam.z)) + 1.7;
    cam.yaw = 0;
    cam.pitch = Math.atan2(y + radius * 0.3 - cam.y, far);
    arrive(view);
    const from = scene.now;
    const seed = blastSeed(row + 1, x, y, z);
    scene.blasts.burst(BURST_LOOKS.indexOf(look as (typeof BURST_LOOKS)[number]), x, y, z, nx, ny, nz, radius, kind, Math.max(0, MADE.indexOf(made as (typeof MADE)[number])), seed, from);
    moments.forEach((ms, col) => {
      runTo(view, from, ms, () => {});
      for (let py = 0; py < h; py++) pixels.set(raster.color.subarray(py * w * 4, (py + 1) * w * 4), ((row * h + py) * W + col * w) * 4);
      label(pixels, W, `${ms} ms`, col * w + 6, row * h + 6);
      const p = scene.packet;
      lines.push(`seed ${row} ${String(ms).padStart(5)} ms: ${scene.details.pool.count} particles alive, ${p.detailCount} cards drawn, ${scene.blasts.lobes} lobes in ${scene.blasts.draws} draws, fill ${p.detailFill.toFixed(3)} screens`);
    });
  }
  label(pixels, W, `${look} on ${surface}${surface === "built" ? ` of ${made}` : ""}, ${scene.assets.tier.name}, ${far} m off`, 6, H - 22);
  return { width: W, height: H, pixels, lines };
}

/** A rocket in flight with its smoke, a column a moment: seen from the side, and from where it was fired. */
export function rocketSheet(view: ProvingView, w: number, h: number, moments: readonly number[]): Sheet {
  const { scene, cam, remote, hf, raster } = view;
  remote.count = 0;
  const [x0, z0] = [244, 262];
  const y0 = hf.heightAt(x0, z0) + 1.6;
  const speed = 60, gravity = 2;
  // Fired level across the view, and for the second row away from the eye.
  const rows = [
    { way: [1, 0.03, 0], eye: [x0 + 13, y0 + 0.6, z0 - 13], name: "from the side" },
    { way: [0.05, 0.04, 1], eye: [x0 - 0.3, y0 + 0.12, z0 - 0.8], name: "from where it was fired" },
  ] as const;
  const [W, H] = [w * moments.length, h * rows.length];
  const pixels = new Uint8ClampedArray(W * H * 4);
  const lines: string[] = [];
  rows.forEach((r, row) => {
    const l = Math.hypot(...r.way);
    const [dx, dy, dz] = [r.way[0] / l, r.way[1] / l, r.way[2] / l];
    [cam.x, cam.y, cam.z] = r.eye;
    cam.aspect = w / h;
    arrive(view);
    const from = scene.now;
    const key = 7 + row;
    scene.blasts.launch(x0, y0, z0, x0 - dx * 0.9, y0 - dy * 0.9, z0 - dz * 0.9, dx, dy, dz, blastSeed(0, x0, y0, z0), false, from);
    scene.blasts.fly(key, x0, y0, z0, dx * speed, dy * speed, dz * speed, gravity, 0.9, from);
    moments.forEach((ms, col) => {
      const at = (): [number, number, number] => {
        const t = (scene.now - from) / 1000;
        return [x0 + dx * speed * t, y0 + dy * speed * t - 0.5 * gravity * t * t, z0 + dz * speed * t];
      };
      const tell = (): void => {
        const [x, y, z] = at();
        scene.blasts.at(key, x, y, z, dx, dy, dz);
        // The eye follows the rocket from the side, and looks down its path from behind.
        const [tx, ty, tz] = row === 0 ? [x0 + 13, y0 + 0.6, z0] : [x, y, z];
        cam.yaw = Math.atan2(tx - cam.x, tz - cam.z);
        cam.pitch = Math.atan2(ty - cam.y, Math.hypot(tx - cam.x, tz - cam.z));
      };
      runTo(view, from, ms, tell);
      for (let py = 0; py < h; py++) pixels.set(raster.color.subarray(py * w * 4, (py + 1) * w * 4), ((row * h + py) * W + col * w) * 4);
      label(pixels, W, `${ms} ms`, col * w + 6, row * h + 6);
      lines.push(`${r.name} ${String(ms).padStart(5)} ms: ${scene.blasts.count} cards, ${scene.blasts.flames} flames in ${scene.blasts.draws} draws, fill ${scene.packet.detailFill.toFixed(3)} screens`);
    });
    scene.blasts.end(key, scene.now);
    label(pixels, W, r.name, 6, (row + 1) * h - 22);
  });
  return { width: W, height: H, pixels, lines };
}

/** `bun run snap -- --blast LOOK` and `-- --rocket`: the sheet as a PNG, and what each frame held. `provingView` is snap.ts's. */
export function blastSnap(args: readonly string[], arg: (name: string) => string | undefined, provingView: (width: number, height: number) => ProvingView): void {
  const [w, h] = (arg("size") ?? "400x300").split("x").map(Number) as [number, number];
  const view = provingView(w, h);
  view.scene.assets.tier = tierOf(arg("graphics") ?? "medium");
  view.scene.viewHeight = h;
  if (arg("hour") !== undefined) view.scene.hour = Number(arg("hour"));
  const t0 = performance.now();
  const rocket = args.includes("--rocket");
  const look = arg("blast") ?? "rocket", surface = arg("surface") ?? "ground";
  const sheet = rocket
    ? rocketSheet(view, w, h, (arg("at") ?? "60,250,700,1500").split(",").map(Number))
    : blastSheet(view, w, h, look, surface, arg("made") ?? "stone", (arg("at") ?? "40,150,400,1000,2500").split(",").map(Number), Number(arg("seeds") ?? 3), Number(arg("far") ?? 16));
  const out = resolve(arg("out") ?? (rocket ? `artifacts/blasts/rocket-${view.scene.assets.tier.name}.png` : `artifacts/blasts/${look}-${surface}-${view.scene.assets.tier.name}.png`));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, encodePng(sheet.width, sheet.height, sheet.pixels));
  console.log(out);
  for (const line of sheet.lines) console.log(line);
  console.log(`${sheet.width}x${sheet.height}  ${(performance.now() - t0).toFixed(0)} ms`);
}
