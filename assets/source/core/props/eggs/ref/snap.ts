// The egg as the game would draw it once a species' egg prop names it: the software rasterizer drawing what a client
// on the medium and the ultra tier draws, on the proving ground's grass, with the dodo's egg prop (its colour, and
// none for the markings) drawn as core:egg_xs in place of the grey egg it names today. Each shot is written beside
// this file as <shot>_<tier>.png:
//
//   beside   a dodo's egg at a grown dodo's feet, a survivor standing by, seen from a survivor's eyes 2 m off
//   near     the same at arm's length, from a crouch
//   5m       the same from a survivor's eyes 5 m off, and enlarged about the egg 4 times (5m_<tier>_x4.png)
//   sizes    the five sizes, extra small to extra large, with a dodo and a survivor
//   colours  the shell in other colours, and its markings given a colour of their own
//
//   bun assets/source/core/props/eggs/ref/snap.ts [shot ...] [--tier medium|ultra]

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tierOf } from "../../../../../../client/core/assets/tiers.ts";
import { AnimState, bodySeed } from "../../../../../../shared/anim/pose.ts";
import { defaultPalette, nearestColour } from "../../../../../../shared/pack/palette.ts";
import { GEAR_COUNT } from "../../../../../../shared/sim/entities.ts";
import { ACT_NONE, HOLD_HANDS } from "../../../../../../shared/sim/weapon.ts";
import { SOURCE } from "../../../../../../tools/art/source.ts";
import { provingView, settle, type ProvingView } from "../../../../../../tools/snap.ts";
import { gameFiles } from "../../../../../../tools/snap/files.ts";
import { encodePng } from "../../../../../../tools/snap/png.ts";

const [W, H] = [1280, 720];
/** The dodo's patch of grass beyond the plaza (assets/source/core/creatures/dodo/ref/world/snap.ts). */
const [CX, CZ] = [160, 360];
const SHOTS = ["beside", "near", "5m", "sizes", "colours"] as const;
type Shot = (typeof SHOTS)[number];
const SIZES = ["xs", "s", "m", "l", "xl"];
/** Prop kinds the shots borrow to stand eggs of other sizes and colours beside the dodo's: each is drawn as an egg. */
const BORROWED = ["core:egg_dodo", "core:egg_raptor", "core:egg_parasaur", "core:cache", "core:bag"];
const PALETTE = defaultPalette();
const tone = (rgb: number): number => nearestColour(PALETTE, rgb >> 16, (rgb >> 8) & 255, rgb & 255);

const args = process.argv.slice(2);
const tierArg = args.indexOf("--tier");
const tiers = tierArg >= 0 ? [args[tierArg + 1]!] : ["medium", "ultra"];
const asked = args.filter((a, i) => !a.startsWith("--") && (tierArg < 0 || i !== tierArg + 1));
const shots = asked.length > 0 ? (asked as Shot[]) : [...SHOTS];
const files = await gameFiles(SOURCE);

interface Body {
  x: number;
  z: number;
  yaw: number;
  kind: string;
  /** For an egg: the second colour, its markings'. */
  marks?: number;
}

function idFor(n: number, seed: number): number {
  for (let id = 1024 * (n + 1); id < 1024 * (n + 2); id++) if (bodySeed(id) === seed) return id;
  return 1024 * (n + 1);
}

/** Draws each borrowed kind as the egg of a size, in a shell colour. */
function eggs(view: ProvingView, sizes: readonly string[], colours: readonly number[]): void {
  const scene = view.scene;
  BORROWED.forEach((id, k) => {
    if (k >= sizes.length) return;
    const kind = view.reg.index.get(id)!;
    scene.meshOfKind[kind] = scene.assets.table.find(`core:egg_${sizes[k]}`);
    scene.colorOfKind[kind] = colours[k]!;
  });
}

function place(view: ProvingView, bodies: readonly Body[], tick: number): void {
  const r = view.remote;
  const reg = view.reg;
  const dodo = reg.index.get("core:dodo")!;
  const set = reg.colorSet[dodo]!;
  const plain = Array.from({ length: 6 }, (_, q) => set.palette[set.start[q]!]!);
  const st = new AnimState();
  r.count = 0;
  r.tick = tick;
  for (const b of bodies) {
    const n = r.count++;
    const kind = reg.index.get(b.kind)!;
    const prop = BORROWED.includes(b.kind);
    r.id[n] = idFor(n, (n * 7) % 32);
    r.kind[n] = kind;
    r.x[n] = CX + b.x;
    r.z[n] = CZ + b.z;
    r.y[n] = view.hf.heightAt(CX + b.x, CZ + b.z);
    r.yaw[n] = b.yaw;
    r.flags[n] = prop ? 1 | 8 : 1;
    r.gear.fill(0, n * GEAR_COUNT, (n + 1) * GEAR_COUNT);
    const colors = b.kind === "core:dodo" ? plain : [0, b.marks ?? 0, 0, 0, 0, 0];
    for (let q = 0; q < 6; q++) r.colors[n * 6 + q] = colors[q]!;
    r.span[n] = prop ? 1000 : 0;
    r.grown[n] = prop ? tick + 1000 : 0;
    r.seat[n] = r.hasLook[n] = 0;
    st.unpack(0);
    st.mode = 1;
    st.grounded = true;
    st.setAction(ACT_NONE, HOLD_HANDS, 0);
    r.anim[n] = st.pack();
    r.cue[n] = st.packCue();
  }
}

function aim(view: ProvingView, x: number, up: number, z: number, tx: number, at: number, tz: number, fov = 1.2217): void {
  const cam = view.cam;
  cam.x = CX + x;
  cam.z = CZ + z;
  cam.y = view.hf.heightAt(cam.x, cam.z) + up;
  const ty = view.hf.heightAt(CX + tx, CZ + tz) + at;
  const [dx, dy, dz] = [CX + tx - cam.x, ty - cam.y, CZ + tz - cam.z];
  cam.yaw = Math.atan2(dx, dz);
  cam.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  cam.fovY = fov;
}

const SHELL = tone(0xe6e3dc);
/** The dodo, its egg at its feet, a survivor beside. */
const FAMILY: Body[] = [
  { x: 0.25, z: 0.1, yaw: -Math.PI / 2 - 0.5, kind: "core:dodo" },
  { x: -0.12, z: -0.05, yaw: 0.3, kind: "core:egg_dodo" },
  { x: -0.9, z: 0.7, yaw: -2.6, kind: "core:survivor" },
];

function scene(view: ProvingView, shot: Shot): void {
  const tick = 400;
  if (shot === "beside" || shot === "near" || shot === "5m") {
    eggs(view, ["xs"], [SHELL]);
    place(view, FAMILY, tick);
    if (shot === "beside") aim(view, 0.4, 1.62, -2, -0.1, 0.15, 0.1, 0.9);
    else if (shot === "near") aim(view, 0.05, 0.55, -0.62, -0.08, 0.06, 0, 0.9);
    else aim(view, 0.8, 1.62, -5, -0.1, 0.2, 0.1);
    return;
  }
  if (shot === "sizes") {
    eggs(view, SIZES, SIZES.map(() => SHELL));
    place(view, [
      ...SIZES.map((_, k): Body => ({ x: 1.6 - [0, 0.25, 0.6, 1.1, 1.8][k]!, z: 0, yaw: 0.4 * k, kind: BORROWED[k]! })),
      { x: 2.15, z: 0.05, yaw: -Math.PI / 2 - 0.3, kind: "core:dodo" },
      { x: -1.1, z: 0.9, yaw: -2.6, kind: "core:survivor" },
    ], tick);
    aim(view, 0.4, 1.3, -3.4, 0.35, 0.25, 0.2, 0.75);
    return;
  }
  // colours: five shells, the last three with their markings in a colour of their own.
  const shells = [SHELL, tone(0xd8c49a), tone(0x9fb39a), tone(0x7d8f9c), tone(0xb88a6a)];
  const marks = [0, 0, tone(0x4a3a2a), tone(0x2f3a2c), tone(0x5c2c22)];
  eggs(view, ["xs", "xs", "xs", "xs", "xs"], shells);
  place(view, BORROWED.map((kind, k): Body => ({ x: 0.28 - 0.14 * k, z: 0.02 * (k % 2), yaw: 0.9 * k, kind, marks: marks[k] })), tick);
  aim(view, 0, 0.42, -0.75, 0, 0.05, 0, 0.6);
}

/** Where the point (x, up, z) about the patch's middle falls in the picture, in pixels. */
function project(view: ProvingView, x: number, up: number, z: number): [number, number] {
  const { cam, hf } = view;
  const m = cam.viewProj;
  const [rx, ry, rz] = [CX + x - cam.x, hf.heightAt(CX + x, CZ + z) + up - cam.y, CZ + z - cam.z];
  const w = m[3]! * rx + m[7]! * ry + m[11]! * rz;
  return [(((m[0]! * rx + m[4]! * ry + m[8]! * rz) / w) * 0.5 + 0.5) * W, (0.5 - ((m[1]! * rx + m[5]! * ry + m[9]! * rz) / w) * 0.5) * H];
}

function enlarged(color: Uint8ClampedArray, px: number, py: number, k: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(W * H * 4);
  const x0 = Math.min(Math.max(Math.round(px - W / k / 2), 0), W - Math.ceil(W / k));
  const y0 = Math.min(Math.max(Math.round(py - H / k / 2), 0), H - Math.ceil(H / k));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out.set(color.subarray(((y0 + Math.floor(y / k)) * W + x0 + Math.floor(x / k)) * 4, ((y0 + Math.floor(y / k)) * W + x0 + Math.floor(x / k)) * 4 + 4), (y * W + x) * 4);
  return out;
}

for (const tier of tiers) {
  for (const shot of shots) {
    const t0 = performance.now();
    const view = provingView(W, H, {}, files);
    view.scene.assets.tier = tierOf(tier);
    view.scene.viewHeight = H;
    scene(view, shot);
    settle(view);
    const out = join(import.meta.dir, `${shot}_${tier}.png`);
    writeFileSync(out, encodePng(W, H, view.raster.color));
    if (shot === "5m") {
      const [px, py] = project(view, 0.05, 0.15, 0.05);
      writeFileSync(join(import.meta.dir, `${shot}_${tier}_x4.png`), encodePng(W, H, enlarged(view.raster.color, px, py, 4)));
    }
    console.log(`${out}  ${(performance.now() - t0).toFixed(0)} ms`);
  }
}
