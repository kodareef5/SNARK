// Renders the UFO's review sheets from its built pack with the game's software renderer: the craft whole (its three
// pieces, the rim and ring turned as the client turns them) by day, at dusk and by night, from where a player sees it;
// its wreck; and its core.
//   bun assets/source/core/events/ufo/review.ts            every sheet
//   bun assets/source/core/events/ufo/review.ts craft      one of craft, wreck, core
// Each sheet is written to ref/review/<name>.png in this folder, beside one picture a shot.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parsePack, type Pack } from "../../../../../shared/pack/pack.ts";
import { defaultPalette, nearestColour } from "../../../../../shared/pack/palette.ts";
import { findAssets } from "../../../../../tools/art/assets.ts";
import { materialsOf } from "../../../../../tools/art/materials.ts";
import { ModelView } from "../../../../../tools/snap.ts";
import { rgbaOf } from "../../../../../tools/snap/files.ts";
import { GLYPH_HEIGHT, GLYPH_WIDTH, glyphPixel } from "../../../../../tools/snap/font.ts";
import { encodePng } from "../../../../../tools/snap/png.ts";
import { PICK_SKY } from "../../../../../tools/snap/raster.ts";

type V3 = readonly [number, number, number];
const W = 640, H = 400;
const GROUND: V3 = [0.36, 0.35, 0.33];
const palette = defaultPalette();
const tint = (rgb: number) => nearestColour(palette, (rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255);
/** The client's colours (client/core/mapevent/craft.ts): the craft's glow and a wreck's ember. */
const GLOW = tint(0x40e8ff), EMBER = tint(0x1a5a66);

const asset = (await findAssets()).find((a) => a.id === "core:ufo")!;
const pack: Pack = parsePack(new Uint8Array(readFileSync(asset.file)));
const materials = materialsOf(asset);
const views = new Map<string, ModelView>();
function view(sky: V3): ModelView {
  const key = sky.join();
  let v = views.get(key);
  if (v) return v;
  v = new ModelView(pack, W * 2, H * 2, sky);
  (pack.header.textures ?? []).forEach((t, slot) => {
    const tex = rgbaOf(materials.find((m) => t.id === `${m.id}/${t.role}`)!, t.role, t.top, null);
    v!.texture(slot, tex.role, tex.pictures);
  });
  views.set(key, v);
  return v;
}
const mesh = (id: string): number => {
  const m = pack.meshIndex.get(id);
  if (m === undefined) throw new Error(`the pack has no ${id}`);
  return m;
};

/** A camera at `eye` looking at `at`. */
function look(eye: V3, at: V3, fov: number) {
  const d = [eye[0] - at[0], eye[1] - at[1], eye[2] - at[2]] as const;
  const dist = Math.hypot(...d);
  return { around: (Math.atan2(d[0], d[2]) * 180) / Math.PI, above: (Math.asin(d[1] / dist) * 180) / Math.PI, centre: at, radius: dist * 0.9, perspective: { distance: dist, fovY: fov } };
}
type Camera = ReturnType<typeof look> | { around: number; above: number; centre: V3; radius: number; perspective?: undefined };
const orbit = (around: number, above: number, centre: V3, radius: number): Camera => ({ around, above, centre, radius });

interface Shot { name: string; cam: Camera; parts: [id: string, turn: number][]; color: number; hour?: number; level?: number; ground?: number; sky?: V3 }

/** One picture: the parts drawn together from one camera, the ground and sky behind. */
function picture(shot: Shot): Uint8Array {
  const sky: V3 = shot.sky ?? (shot.hour !== undefined && (shot.hour > 20 || shot.hour < 5) ? [0.05, 0.07, 0.12] : shot.hour !== undefined && shot.hour > 17 ? [0.62, 0.48, 0.42] : [0.66, 0.74, 0.84]);
  const v = view(sky);
  const level = shot.level ?? 0;
  const placed = shot.parts.map(([id, turn]) => [mesh(id), 0, 0, 0, Math.round((turn / (2 * Math.PI)) * 65536) & 65535] as const);
  v.draw({ ...shot.cam, mesh: placed[0]![0], placed, level, rig: null, colors: [shot.color], textured: level < (pack.header.meshes[placed[0]![0]]!.flat ?? 99), hour: shot.hour, floor: shot.ground });
  const r = v.raster;
  const color = r.color.slice();
  const ray = [0, 0, 0];
  const cam = v.cam;
  const ground = shot.ground;
  for (let i = 0; i < r.pickKind.length; i++) {
    if (r.pickKind[i] !== PICK_SKY) continue;
    cam.ray(((i % (W * 2)) + 0.5) / (W * 2), (Math.floor(i / (W * 2)) + 0.5) / (H * 2), ray);
    let c: V3 = sky;
    if (ground !== undefined && ray[1]! < 0 && cam.y > ground) {
      const t = (cam.y - ground) / -ray[1]!;
      const gx = cam.x + ray[0]! * t, gz = cam.z + ray[2]! * t;
      const line = Math.min(Math.abs(gx / 5 - Math.round(gx / 5)), Math.abs(gz / 5 - Math.round(gz / 5))) < 0.01 * Math.max(1, t / 8);
      const fade = Math.min(1, t / 200);
      const g = shot.hour !== undefined && (shot.hour > 20 || shot.hour < 5) ? GROUND.map((k) => k * 0.12) : GROUND;
      c = [0, 1, 2].map((k) => g[k]! * (line ? 0.86 : 1) * (1 - fade) + sky[k]! * fade) as unknown as V3;
    }
    color.set([c[0] * 255, c[1] * 255, c[2] * 255, 255], i * 4);
  }
  const out = new Uint8Array(W * H * 4);
  const stride = W * 2 * 4;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let ch = 0; ch < 4; ch++) {
    const p = 2 * y * stride + 8 * x + ch;
    out[(y * W + x) * 4 + ch] = Math.round((color[p]! + color[p + 4]! + color[p + stride]! + color[p + stride + 4]!) / 4);
  }
  return out;
}

function label(img: Uint8Array, width: number, x0: number, y0: number, text: string): void {
  const s = 2;
  const w = text.length * (GLYPH_WIDTH + 1) * s + 8;
  for (let y = y0; y < y0 + GLYPH_HEIGHT * s + 8; y++) for (let x = x0; x < x0 + w; x++) img.set([16, 18, 20, 255], (y * width + x) * 4);
  [...text].forEach((ch, k) => {
    for (let row = 0; row < GLYPH_HEIGHT; row++) for (let col = 0; col < GLYPH_WIDTH; col++) {
      if (!glyphPixel(ch.toUpperCase().charCodeAt(0), col, row)) continue;
      for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) img.set([235, 235, 230, 255], ((y0 + 4 + row * s + dy) * width + x0 + 4 + (k * (GLYPH_WIDTH + 1) + col) * s + dx) * 4);
    }
  });
}

const whole = (rim = 0.4, ring = 1.1): [string, number][] => [["core:ufo_craft", 0], ["core:ufo_rim", rim], ["core:ufo_ring", ring]];
const sheets: Record<string, Shot[]> = {
  craft: [
    { name: "three quarter, above", cam: orbit(30, 22, [0, 0.4, 0], 13), parts: whole(), color: GLOW },
    { name: "level", cam: orbit(70, 3, [0, 0.6, 0], 12.5), parts: whole(), color: GLOW },
    { name: "from below, as a player sees it", cam: look([18, -40, 26], [0, 0, 0], 0.62), parts: whole(), color: GLOW },
    { name: "straight under", cam: orbit(10, -80, [0, -1, 0], 12.5), parts: whole(0.9, 2.3), color: GLOW },
    { name: "rim and band, close", cam: look([14, 3.5, 6], [6, 1.2, 2], 0.7), parts: whole(), color: GLOW },
    { name: "belly, close", cam: look([5, -9, 9], [0, -2, 0], 0.75), parts: whole(), color: GLOW },
    { name: "dusk, from below", cam: look([22, -36, 30], [0, 0, 0], 0.62), parts: whole(), color: GLOW, hour: 19.2 },
    { name: "night, from below", cam: look([22, -36, 30], [0, 0, 0], 0.62), parts: whole(), color: GLOW, hour: 23 },
    { name: "shield broken: white", cam: orbit(40, 12, [0, 0.4, 0], 13), parts: whole(), color: tint(0xf4f8ff) },
    { name: "level 2, flat, 260 m below", cam: look([60, -250, 90], [0, 0, 0], 0.09), parts: whole(), color: GLOW, level: 2 },
  ],
  wreck: [
    { name: "from 50 m, as the review walks up", cam: look([40, -1.6, 25], [0, -2.0, 2], 0.75), parts: [["core:ufo_wreck", 0]], color: EMBER, ground: -3.2 },
    { name: "ahead, the buried edge", cam: look([6, 1.5, 34], [0, -2.2, 4], 0.85), parts: [["core:ufo_wreck", 0]], color: EMBER, ground: -3.2 },
    { name: "the torn rim", cam: look([26, 2.5, 18], [6, -1.5, 5], 0.8), parts: [["core:ufo_wreck", 0]], color: EMBER, ground: -3.2 },
    { name: "behind, where its core lies", cam: look([-14, 3, -34], [0, -2, 0], 0.8), parts: [["core:ufo_wreck", 0]], color: EMBER, ground: -3.2 },
    { name: "from above", cam: orbit(30, 62, [0, -2, 6], 26), parts: [["core:ufo_wreck", 0]], color: EMBER, ground: -3.2 },
    { name: "at night", cam: look([40, -1.6, 25], [0, -2.0, 2], 0.75), parts: [["core:ufo_wreck", 0]], color: EMBER, ground: -3.2, hour: 23 },
  ],
  core: [
    { name: "core, three quarter", cam: orbit(35, 18, [0, 0.8, 0], 1.6), parts: [["core:ufo_core", 0]], color: GLOW, ground: 0 },
    { name: "core, from a stride off", cam: look([2.6, 1.7, 2.2], [0, 0.8, 0], 0.9), parts: [["core:ufo_core", 0]], color: GLOW, ground: 0 },
    { name: "core at night", cam: orbit(35, 18, [0, 0.8, 0], 1.6), parts: [["core:ufo_core", 0]], color: GLOW, ground: 0, hour: 23 },
    { name: "core from above", cam: orbit(10, 70, [0, 0.8, 0], 1.4), parts: [["core:ufo_core", 0]], color: GLOW, ground: 0 },
  ],
};

const folder = join(import.meta.dir, "ref", "review");
mkdirSync(folder, { recursive: true });
const only = process.argv.slice(2);
for (const [sheet, shots] of Object.entries(sheets)) {
  if (only.length > 0 && !only.includes(sheet)) continue;
  const cols = 2, rows = Math.ceil(shots.length / cols);
  const page = new Uint8Array(cols * W * rows * H * 4);
  shots.forEach((shot, k) => {
    const img = picture(shot);
    label(img, W, 6, 6, shot.name);
    writeFileSync(join(folder, `${sheet}-${k + 1}.png`), encodePng(W, H, img));
    const ox = (k % cols) * W, oy = Math.floor(k / cols) * H;
    for (let y = 0; y < H; y++) page.set(img.subarray(y * W * 4, (y + 1) * W * 4), ((oy + y) * cols * W + ox) * 4);
  });
  writeFileSync(join(folder, `${sheet}.png`), encodePng(cols * W, rows * H, page));
  console.log(join(folder, `${sheet}.png`));
}
