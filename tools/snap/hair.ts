// Every hair and beard style on both sexes, as one sheet: a column a style, and for each sex a row of portraits turned
// aside, a row from the front and a row at 5 m. The beards are worn with buzzed hair. Drawn as a client on one graphics tier draws, textures and all.
//
//   bun tools/snap/hair.ts [--graphics high] [--hour 10] [--size 200x240] [--out artifacts/hair.png]

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { BEARD_STYLES, HAIR_STYLES, LOOK_BEARD, LOOK_BYTES, LOOK_HAIR, LOOK_HAIR_COLOR, LOOK_SEX, LOOK_SKIN, defaultLook } from "../../shared/anim/look.ts";
import { HAIR_COLORS, SKIN_TONES } from "../../shared/pack/palette.ts";
import { SOURCE } from "../art/source.ts";
import { label, provingView, settle } from "../snap.ts";
import { gameFiles } from "./files.ts";
import { encodePng } from "./png.ts";

const args = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

/** Each column's look: a hair style, or buzzed hair and a beard. */
function columns(sex: number): { label: string; look: Uint8Array }[] {
  const out = HAIR_STYLES.map((s, k) => ({ label: s.label, hair: k, beard: 0 }));
  BEARD_STYLES.forEach((s, k) => k > 0 && out.push({ label: `${s.label} beard`, hair: 1, beard: k }));
  return out.map((c, k) => {
    const look = defaultLook();
    look[LOOK_SEX] = sex;
    look[LOOK_HAIR] = c.hair;
    look[LOOK_BEARD] = c.beard;
    look[LOOK_SKIN] = (k * 3 + sex * 5) % SKIN_TONES;
    look[LOOK_HAIR_COLOR] = (k * 7 + sex * 3) % HAIR_COLORS;
    return { label: c.label, look };
  });
}

if (import.meta.main) {
  const tier = arg("graphics") ?? "high";
  const [w, h] = (arg("size") ?? "200x240").split("x").map(Number) as [number, number];
  const files = await gameFiles(SOURCE);
  const view = provingView(w, h, {}, files);
  view.scene.assets.tier = tierOf(tier);
  view.scene.viewHeight = h;
  view.scene.hour = Number(arg("hour") ?? 10);
  const r = view.remote;
  r.count = 0;
  r.tick = 0;
  const kind = view.reg.index.get("core:survivor")!;
  const rows = [0, 1].map(columns);
  const across = rows[0]!.length;
  // Each body 8 m from the next, all facing +Z, the sexes 8 m apart.
  rows.forEach((row, sex) => row.forEach(({ look }, k) => {
    const n = r.count++;
    r.id[n] = 1024 * (n + 1);
    r.kind[n] = kind;
    r.x[n] = 200 + k * 8;
    r.z[n] = 228 + sex * 8;
    r.y[n] = view.hf.heightAt(r.x[n]!, r.z[n]!);
    r.yaw[n] = 0;
    r.flags[n] = 1;
    r.anim[n] = 0;
    r.hasLook[n] = 1;
    r.look.set(look.subarray(0, LOOK_BYTES), n * LOOK_BYTES);
  }));
  const shots = [
    { name: "portrait", distance: 0.85, height: 1.62, aim: 1.6, fov: 0.42, turn: 0.55 },
    { name: "front", distance: 0.85, height: 1.62, aim: 1.6, fov: 0.42, turn: 0 },
    { name: "5 m", distance: 5, height: 1.6, aim: 0.95, fov: 0.42, turn: 0.35 },
  ];
  const W = w * across, H = h * shots.length * 2;
  const pixels = new Uint8ClampedArray(W * H * 4);
  const cam = view.cam;
  for (let sex = 0; sex < 2; sex++) for (const [s, shot] of shots.entries()) for (let k = 0; k < across; k++) {
    const n = sex * across + k;
    const x = r.x[n]!, z = r.z[n]!, ground = r.y[n]!;
    cam.x = x + Math.sin(shot.turn) * shot.distance;
    cam.z = z + Math.cos(shot.turn) * shot.distance;
    cam.y = ground + shot.height;
    cam.yaw = shot.turn + Math.PI;
    cam.pitch = Math.atan2(ground + shot.aim - cam.y, shot.distance);
    cam.fovY = shot.fov;
    cam.aspect = w / h;
    const frames = settle(view);
    if (args.includes("--verbose")) console.log(`${rows[sex]![k]!.label}, ${shot.name}: ${frames} frames`);
    const [ox, oy] = [k * w, (sex * shots.length + s) * h];
    for (let y = 0; y < h; y++) pixels.set(view.raster.color.subarray(y * w * 4, (y + 1) * w * 4), ((oy + y) * W + ox) * 4);
    if (s === 0) label(pixels, W, rows[sex]![k]!.label, ox + 6, oy + 6);
    if (k === 0) label(pixels, W, `${sex === 0 ? "male" : "female"}, ${shot.name}`, ox + 6, oy + h - 22);
  }
  const out = resolve(arg("out") ?? "artifacts/hair.png");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, encodePng(W, H, pixels));
  console.log(`${out}  ${W}x${H}, ${tier}`);
  process.exit(0);
}
