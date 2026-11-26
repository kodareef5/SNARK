// Sheets of drawn faces: each a survivor's head close up, through the game's renderer and the rasterizer, its face made
// on the client (client/core/render/faces.ts). One sheet a sex of 24 people the survivors' population makes, and one of
// every face slider at each end. `bun tools/snap/faces.ts [--out var/faces] [--graphics high] [--size 160]`.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { FACE_COUNT, LOOK_BYTES, LOOK_HAIR, LOOK_SEX, defaultLook, setFace } from "../../shared/anim/look.ts";
import { personFrom } from "../../shared/people/person.ts";
import { FACE_LABELS } from "../../shared/people/face-controls.ts";
import { SURVIVORS } from "../../content/people/defaults.ts";
import { asTextured } from "../bench/base.ts";
import { label, provingView, settle, type ProvingView } from "../snap.ts";
import { gameFiles } from "./files.ts";
import { encodePng } from "./png.ts";

const args = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const OUT = resolve(arg("out") ?? "var/faces");
const TIER = arg("graphics") ?? "high";
const SIZE = Number(arg("size") ?? 160);
const COLUMNS = 8;

/** The view, one survivor at the plaza turned three-quarters to a camera 0.6 m from its face. */
async function portraitView(): Promise<ProvingView> {
  const view = provingView(SIZE, SIZE, {}, await gameFiles());
  view.scene.assets.tier = tierOf(TIER);
  view.scene.viewHeight = SIZE * 4;
  asTextured(view.scene);
  const r = view.remote;
  r.count = 1;
  r.tick = 0;
  r.id[0] = 4096;
  r.kind[0] = view.reg.index.get("core:survivor")!;
  r.x[0] = 256;
  r.z[0] = 228;
  r.y[0] = view.hf.heightAt(256, 228);
  r.yaw[0] = Math.PI + 0.5;
  r.flags[0] = 1;
  r.anim[0] = 0;
  r.hasLook[0] = 1;
  view.scene.hour = 11;
  return view;
}

/** One tile: the body in `look`, framed on its head, after enough frames for its head to be made. */
function portrait(view: ProvingView, look: Uint8Array): Uint8ClampedArray {
  const r = view.remote, cam = view.cam;
  r.look.set(look, 0);
  const eye = r.y[0]! + (look[LOOK_SEX] === 1 ? 1.56 : 1.64);
  cam.x = r.x[0]! - 0.55 * Math.sin(0.15);
  cam.z = r.z[0]! - 0.55 * Math.cos(0.15);
  cam.y = eye + 0.02;
  cam.yaw = Math.PI + 0.15;
  cam.pitch = -0.05;
  cam.fovY = 0.5;
  cam.aspect = 1;
  settle(view);
  for (let k = 0; k < 6; k++) view.render();
  return view.raster.color.slice();
}

function sheet(tiles: Uint8ClampedArray[], names: string[], file: string): void {
  const rows = Math.ceil(tiles.length / COLUMNS), W = COLUMNS * SIZE, H = rows * SIZE;
  const pixels = new Uint8ClampedArray(W * H * 4);
  tiles.forEach((t, i) => {
    const ox = (i % COLUMNS) * SIZE, oy = Math.floor(i / COLUMNS) * SIZE;
    for (let y = 0; y < SIZE; y++) pixels.set(t.subarray(y * SIZE * 4, (y + 1) * SIZE * 4), ((oy + y) * W + ox) * 4);
    label(pixels, W, names[i]!, ox + 4, oy + SIZE - 14);
  });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, file), encodePng(W, H, pixels));
  console.log(join(OUT, file));
}

const view = await portraitView();
for (const sex of [0, 1]) {
  const tiles: Uint8ClampedArray[] = [], names: string[] = [];
  for (let seed = 1; tiles.length < 24; seed++) {
    const person = personFrom(seed * 7919, SURVIVORS);
    if (person.look[LOOK_SEX] !== sex) continue;
    tiles.push(portrait(view, person.look));
    names.push(`seed ${seed * 7919}`);
  }
  sheet(tiles, names, `generated-${sex === 0 ? "male" : "female"}.png`);
  const ends: Uint8ClampedArray[] = [], labels: string[] = [];
  const plain = defaultLook();
  plain[LOOK_SEX] = sex;
  plain[LOOK_HAIR] = 0;
  ends.push(portrait(view, plain));
  labels.push("neutral");
  for (let m = 0; m < FACE_COUNT; m++) for (const end of [-1, 1]) {
    const look = plain.slice(0, LOOK_BYTES);
    setFace(look, m, end);
    ends.push(portrait(view, look));
    labels.push(`${FACE_LABELS[m]} ${end > 0 ? "+" : "-"}`);
  }
  for (const end of [-1, 1]) {
    const look = plain.slice(0, LOOK_BYTES);
    for (let m = 0; m < FACE_COUNT; m++) setFace(look, m, end);
    ends.push(portrait(view, look));
    labels.push(`every slider ${end > 0 ? "+" : "-"}`);
  }
  sheet(ends, labels, `ends-${sex === 0 ? "male" : "female"}.png`);
}
console.log(`made ${view.scene.characters.faces.makes} heads`);
process.exit(0);
