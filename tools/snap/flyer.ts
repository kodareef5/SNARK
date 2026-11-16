// The pteranodon as a client on each graphics tier draws it, its asset files read from assets/source where a client
// fetches them (planning/reference/flyers-plan.md, PA6): near on the ground, from below in flight at 20, 60, 150 and
// 400 m on a 1080-row screen, banking and rolling, knocked out and dead, ridden with its saddle and a rider. --close draws
// a few near at full size, --levels each level of its mesh in turn, and --clips frames through the clips whose folded
// skin crosses itself, at the size a body is seen from about 12 m.
//
//   bun tools/snap/flyer.ts [--tier all|lowpoly|medium|high|ultra] [--close] [--levels] [--clips] [--out DIR] [--source DIR]

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { TIERS, tierOf } from "../../client/core/assets/tiers.ts";
import { PTERANODON_DYES } from "../../content/creatures/pteranodon.ts";
import { FELL } from "../../shared/anim/corpse.ts";
import { AnimState, CUE_DEAD, CUE_ROLL, CUE_TAKEOFF, bodySeed } from "../../shared/anim/pose.ts";
import { MODE_FLYER, STANCE_CROUCH } from "../../shared/sim/character.ts";
import { GEAR_COUNT, GEAR_WORN } from "../../shared/sim/entities.ts";
import { buildRig } from "../../shared/anim/rigs.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { findAssets } from "../art/assets.ts";
import { repack } from "../art/build.ts";
import { Poser } from "../art/check.ts";
import { materialsOf } from "../art/materials.ts";
import { SOURCE } from "../art/source.ts";
import { ModelView, provingView, settle, type ProvingView } from "../snap.ts";
import { gameFiles, rgbaOf } from "./files.ts";
import { GLYPH_HEIGHT, GLYPH_WIDTH, glyphPixel } from "./font.ts";
import { encodePng } from "./png.ts";
import { atLevel } from "./saddles.ts";

const args = process.argv.slice(2);
const arg = (name: string): string | undefined => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const out = resolve(arg("out") ?? "artifacts/flyer");
const source = resolve(arg("source") ?? SOURCE);
const tierArg = arg("tier") ?? "all";
const tiers = tierArg === "all" ? TIERS.map((t) => t.name) : [tierArg];
mkdirSync(out, { recursive: true });

/** A body put in the view: where it is, which way it faces in radians, how its pose state is set, and what it wears. */
interface Put {
  x: number;
  y: number;
  z: number;
  yaw: number;
  set?: (s: AnimState, tick: number) => void;
  flying?: boolean;
  saddled?: boolean;
  rider?: boolean;
  /** The cue word of a body that lies dead, CUE_DEAD and what it carries. */
  dead?: number;
}

/** A picture: its words, the bodies, and the camera at (x, y, z) looking at (tx, ty, tz) with a vertical field of view in degrees. */
interface Shot {
  label: string;
  bodies: Put[];
  eye: [number, number, number];
  at: [number, number, number];
  fov: number;
}

const TICK = 4000;
const SEED_FROM = 1024;
/** The smallest id from `from` whose body clock runs `seed` ticks ahead. */
function idWithSeed(seed: number, from: number): number {
  for (let id = from; ; id++) if (bodySeed(id) === seed) return id;
}

function stage(view: ProvingView, bodies: readonly Put[], base = SEED_FROM): void {
  const { reg, remote: r } = view;
  const kind = reg.index.get("core:pteranodon")!;
  const saddle = reg.index.get("core:saddle_pteranodon")!;
  const survivor = reg.index.get("core:survivor")!;
  const st = new AnimState();
  r.count = 0;
  r.tick = TICK;
  r.died = new Map();
  let from = base;
  const add = (k: number, b: Put, seed: number): number => {
    const n = r.count++;
    r.id[n] = from = idWithSeed(seed, from + 1);
    [r.gen[n], r.kind[n], r.x[n], r.y[n], r.z[n], r.yaw[n], r.flags[n]] = [0, k, b.x, b.y, b.z, b.yaw, b.flying ? 0 : 1];
    r.gear.fill(0, n * GEAR_COUNT, (n + 1) * GEAR_COUNT);
    if (b.saddled) r.gear[n * GEAR_COUNT + GEAR_WORN] = saddle;
    for (let q = 0; q < 6; q++) r.colors[n * 6 + q] = k === kind ? PTERANODON_DYES[q]! : 0;
    [r.span[n], r.grown[n], r.seat[n], r.hasLook[n]] = [0, 0, 0, 0];
    st.unpack(0);
    if (b.flying) {
      st.mode = MODE_FLYER;
      st.grounded = false;
    }
    b.set?.(st, TICK);
    r.anim[n] = b.dead ? 0 : st.pack();
    r.cue[n] = b.dead ?? st.packCue();
    return n;
  };
  for (const b of bodies) {
    const n = add(kind, b, 0);
    if (!b.rider) continue;
    const rider = add(survivor, { x: b.x, y: b.y, z: b.z, yaw: b.yaw, set: (s) => (s.stance = STANCE_CROUCH) }, 0);
    r.seat[rider] = r.id[n]! + 1;
  }
}

function aim(view: ProvingView, shot: Shot, ratio: number): void {
  const cam = view.cam;
  [cam.x, cam.y, cam.z] = shot.eye;
  const [dx, dy, dz] = [shot.at[0] - cam.x, shot.at[1] - cam.y, shot.at[2] - cam.z];
  cam.yaw = Math.atan2(dx, dz);
  cam.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  cam.fovY = (shot.fov * Math.PI) / 180;
  cam.aspect = ratio;
}

function label(pixels: Uint8Array, width: number, text: string, x: number, y: number): void {
  const put = (px: number, py: number, rgb: readonly number[]): void => {
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) pixels.set(rgb, ((py + dy) * width + px + dx) * 4);
  };
  for (let py = y - 2; py < y + (GLYPH_HEIGHT + 1) * 2; py += 2) for (let px = x - 2; px < x + text.length * (GLYPH_WIDTH + 1) * 2; px += 2) put(px, py, [20, 22, 26]);
  [...text].forEach((ch, i) => {
    for (let col = 0; col < GLYPH_WIDTH; col++) for (let row = 0; row < GLYPH_HEIGHT; row++) if (glyphPixel(ch.charCodeAt(0), col, row)) put(x + (i * (GLYPH_WIDTH + 1) + col) * 2, y + row * 2, [240, 240, 240]);
  });
}

/** A view's whole picture at a `by`th of its size, each pixel the mean of those it covers, into `sheet` at (ox, oy). */
function shrink(view: ProvingView, vw: number, vh: number, sheet: Uint8Array | Uint8ClampedArray, sw: number, ox: number, oy: number, by: number): void {
  const src = view.raster.color;
  for (let y = 0; y < vh / by; y++) {
    for (let x = 0; x < vw / by; x++) {
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let dy = 0; dy < by; dy++) for (let dx = 0; dx < by; dx++) sum += src[((y * by + dy) * vw + x * by + dx) * 4 + c]!;
        sheet[((oy + y) * sw + ox + x) * 4 + c] = Math.round(sum / (by * by));
      }
    }
  }
}

/** Copies the `w` by `h` middle of a view's picture, each pixel made `scale` pixels square, into `sheet` at (ox, oy). */
function paste(view: ProvingView, vw: number, vh: number, sheet: Uint8Array, sw: number, ox: number, oy: number, w: number, h: number, scale: number): void {
  const src = view.raster.color;
  const [x0, y0] = [Math.floor(vw / 2 - w / (2 * scale)), Math.floor(vh / 2 - h / (2 * scale))];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((y0 + Math.floor(y / scale)) * vw + x0 + Math.floor(x / scale)) * 4;
      sheet.set(src.subarray(s, s + 4), ((oy + y) * sw + ox + x) * 4);
    }
  }
}

/** `n` frames a sixtieth of a second apart that carry their uploads to the card and draw nothing, as settle's do. */
function quiet(view: ProvingView, n: number): void {
  for (let f = 0; f < n; f++) {
    view.scene.now += 1000 / 60;
    view.port?.advance(view.scene.now);
    const p = view.scene.build(view.cam, view.remote);
    p.drawCount = p.tileCount = 0;
    view.raster.render(p);
  }
}

const files = await gameFiles(source);
const mesh = files.manifest.meshes.findIndex((m) => m.id === "core:pteranodon");
const [TW, TH] = [480, 270];

/** Where the shots are taken: open ground south of the proving ground's plaza. */
function ground(view: ProvingView): { x: number; y: number; z: number } {
  const [x, z] = [256, 214];
  return { x, y: view.hf.heightAt(x, z), z };
}

/** The shots near the animal, on a 960 by 540 view. */
function nearShots(view: ProvingView): Shot[] {
  const g = ground(view);
  const side = (b: Put, far: number, around: number, up: number, lift = 0.9): Shot["eye"] => {
    const a = b.yaw + (around * Math.PI) / 180;
    const e = (up * Math.PI) / 180;
    return [b.x + far * Math.sin(a) * Math.cos(e), b.y + lift + far * Math.sin(e), b.z + far * Math.cos(a) * Math.cos(e)];
  };
  const shot = (label: string, b: Put, far: number, around: number, up: number, fov = 34, lift = 0.9): Shot => ({ label, bodies: [b], eye: side(b, far, around, up, lift), at: [b.x, b.y + lift, b.z], fov });
  const onGround = (set?: Put["set"], extra: Partial<Put> = {}): Put => ({ x: g.x, y: g.y, z: g.z, yaw: 0.6, set, ...extra });
  const aloft = (set?: Put["set"], extra: Partial<Put> = {}): Put => ({ x: g.x, y: g.y + 12, z: g.z, yaw: 0.6, flying: true, set, ...extra });
  const dead = (air: boolean): Put => ({ x: g.x, y: g.y, z: g.z, yaw: 0.6, dead: (CUE_DEAD | (air ? FELL : 0)) >>> 0 });
  return [
    shot("standing", onGround(), 7, 50, 10),
    shot("walking", onGround((s) => (s.speed = 4)), 7, 70, 8),
    shot("taking off, 8", onGround((s, t) => ((s.mode = MODE_FLYER), (s.grounded = false), (s.cue = CUE_TAKEOFF), (s.cueStart = (t - 8) & 255)), { flying: true }), 8, 60, 6),
    shot("flying, from beside", aloft((s) => (s.speed = 3)), 9, 80, -8),
    shot("banking left", aloft((s) => ((s.speed = 4), (s.bank = 7))), 11, 140, -12),
    shot("banking right", aloft((s) => ((s.speed = 4), (s.bank = -7))), 11, 220, -12),
    shot("rolling, 8", aloft((s, t) => ((s.speed = 4), (s.cue = CUE_ROLL), (s.cueStart = (t - 8) & 255))), 10, 160, -10),
    shot("rolling, 16", aloft((s, t) => ((s.speed = 4), (s.cue = CUE_ROLL), (s.cueStart = (t - 16) & 255))), 10, 160, -10),
    shot("ridden, standing", onGround(undefined, { saddled: true, rider: true }), 6, 40, 12),
    shot("ridden, flying", aloft((s) => (s.speed = 3), { saddled: true, rider: true }), 8, 60, 10),
    shot("ridden, banking", aloft((s) => ((s.speed = 4), (s.bank = 6)), { saddled: true, rider: true }), 9, 200, 5),
    shot("saddled, from above", onGround(undefined, { saddled: true }), 4.5, 160, 45, 50, 1),
    shot("knocked out in the air", aloft((s) => ((s.out = true), (s.grounded = false))), 9, 70, 0),
    shot("knocked out, lying", onGround((s) => (s.out = true)), 6, 60, 25, 34, 0.5),
    shot("dead, on the ground", dead(false), 6, 60, 30, 34, 0.4),
    shot("dead, from the air", dead(true), 6, 60, 30, 34, 0.4),
  ];
}

for (const name of tiers) {
  const t0 = performance.now();
  const tier = tierOf(name);
  // Near: a 960 by 540 view, its middle drawn at full size.
  const near = provingView(960, 540, {}, files);
  near.scene.assets.tier = tier;
  near.scene.viewHeight = 540;
  const shots = nearShots(near);
  const across = 4;
  const rows = Math.ceil(shots.length / across) + 2;
  const [SW, SH] = [across * TW, rows * TH + 24];
  const sheet = new Uint8Array(SW * SH * 4).fill(236);
  shots.forEach((s, i) => {
    stage(near, s.bodies, SEED_FROM * (i + 1));
    aim(near, s, 960 / 540);
    // A body come upon dead is laid to rest over frames of its own, before the card is filled and the picture drawn.
    quiet(near, 30);
    settle(near);
    const [ox, oy] = [(i % across) * TW, Math.floor(i / across) * TH];
    shrink(near, 960, 540, sheet, SW, ox, oy, 2);
    label(sheet, SW, s.label, ox + 6, oy + 6);
  });
  // From below in flight at the game's 70 degrees, the camera on the ground, with levels chosen for a 1080-row screen:
  // the middle at full size near and enlarged far. The first row is drawn as the software rasterizer draws, a sample a
  // pixel; the second with two by two samples a pixel averaged, as the browser's multisampled canvas covers one.
  for (const [row, ss] of [[rows - 2, 1], [rows - 1, 2]] as const) {
    const far = provingView(1920 * ss, 1080 * ss, {}, files);
    far.scene.assets.tier = tier;
    far.scene.viewHeight = 1080;
    const g = ground(far);
    const one = { raster: { color: new Uint8Array(1920 * 1080 * 4) } } as unknown as ProvingView;
    [20, 60, 150, 400].forEach((d, i) => {
      const up = (55 * Math.PI) / 180;
      const eye: Shot["eye"] = [g.x, g.y + 1.7, g.z];
      const at: Shot["at"] = [g.x, g.y + 1.7 + d * Math.sin(up), g.z + d * Math.cos(up)];
      const shot: Shot = { label: "", bodies: [{ x: at[0], y: at[1] - 0.8, z: at[2], yaw: Math.PI / 2, flying: true, set: (s) => ((s.speed = 4), (s.pitch = -7)) }], eye, at, fov: 70 };
      // The sky alone first, to tell the animal from.
      stage(far, []);
      aim(far, shot, 1920 / 1080);
      settle(far);
      const sky = new Uint8Array(1920 * 1080 * 4);
      shrink(far, 1920 * ss, 1080 * ss, sky, 1920, 0, 0, ss);
      stage(far, shot.bodies);
      settle(far);
      const p = far.scene.packet;
      const drawn = [...Array(p.drawCount).keys()].filter((k) => p.drawMesh[k] === mesh).map((k) => p.drawLod[k]!);
      shrink(far, 1920 * ss, 1080 * ss, one.raster.color, 1920, 0, 0, ss);
      // How far across it shows: the rows where a pixel differs from the sky alone by more than about 3%.
      const c = one.raster.color;
      let [lo, hi] = [Infinity, -Infinity];
      for (let y = 540 - 200; y < 540 + 200; y++) {
        for (let x = 960 - 200; x < 960 + 200; x++) {
          const k = (y * 1920 + x) * 4;
          if (Math.abs(c[k]! - sky[k]!) + Math.abs(c[k + 1]! - sky[k + 1]!) + Math.abs(c[k + 2]! - sky[k + 2]!) > 24) [lo, hi] = [Math.min(lo, y), Math.max(hi, y)];
        }
      }
      const expected = (6.96 * 1080) / (2 * d * Math.tan(35 * (Math.PI / 180)));
      console.log(`${name.padEnd(8)} ${d} m, ${ss * ss} samples a pixel: level ${drawn[0] ?? "-"}, span ${expected.toFixed(1)} px, ${Math.max(0, hi - lo + 1)} px of it show`);
      const scale = d <= 20 ? 1 : d <= 60 ? 2 : d <= 150 ? 4 : 8;
      const [ox, oy] = [i * TW, row * TH];
      paste(one, 1920, 1080, sheet, SW, ox, oy, TW, TH, scale);
      label(sheet, SW, `${d} m${scale > 1 ? ` x${scale}` : ""}, level ${drawn[0] ?? "-"}, ${ss === 1 ? "1 sample" : "4 samples"} a pixel`, ox + 6, oy + 6);
    });
  }
  label(sheet, SW, `core:pteranodon on ${name}, as a client draws it`, 6, SH - 20);
  const file = join(out, `flyer-${name}.png`);
  writeFileSync(file, encodePng(SW, SH, sheet));
  console.log(`${file}  ${((performance.now() - t0) / 1000).toFixed(1)} s`);
}

if (args.includes("--close")) {
  // Near at full size on one tier: the head, the animal standing, its saddle and rider, and its underside 12 m up.
  const name = tierArg === "all" ? "high" : tierArg;
  const view = provingView(960, 540, {}, files);
  view.scene.assets.tier = tierOf(name);
  view.scene.viewHeight = 540;
  const g = ground(view);
  const body: Put = { x: g.x, y: g.y, z: g.z, yaw: 0.6 };
  const aloft: Put = { x: g.x, y: g.y + 12, z: g.z, yaw: Math.PI / 2, flying: true, set: (s) => ((s.speed = 4), (s.pitch = -7)) };
  const at = (b: Put, around: number, up: number, far: number, lift: number): Shot["eye"] => {
    const a = b.yaw + (around * Math.PI) / 180;
    const e = (up * Math.PI) / 180;
    return [b.x + far * Math.sin(a) * Math.cos(e), b.y + lift + far * Math.sin(e), b.z + far * Math.cos(a) * Math.cos(e)];
  };
  const shots: Shot[] = [
    { label: "the head", bodies: [body], eye: at(body, 70, 5, 2.2, 1.45), at: [body.x + 0.4 * Math.sin(body.yaw), body.y + 1.4, body.z + 0.4 * Math.cos(body.yaw)], fov: 34 },
    { label: "standing", bodies: [body], eye: at(body, 45, 12, 5.5, 0.9), at: [body.x, body.y + 0.9, body.z], fov: 34 },
    { label: "ridden, its saddle", bodies: [{ ...body, saddled: true, rider: true }], eye: at(body, 120, 25, 3.6, 1.1), at: [body.x, body.y + 1.1, body.z], fov: 34 },
    { label: "from below, 12 m", bodies: [aloft], eye: [g.x - 3, g.y + 1.7, g.z - 6], at: [aloft.x, aloft.y + 0.8, aloft.z], fov: 40 },
  ];
  const sheet = new Uint8Array(1920 * 1104 * 4).fill(236);
  shots.forEach((s, i) => {
    stage(view, s.bodies, SEED_FROM * (i + 1));
    aim(view, s, 960 / 540);
    settle(view);
    const [ox, oy] = [(i % 2) * 960, Math.floor(i / 2) * 540];
    for (let y = 0; y < 540; y++) sheet.set(view.raster.color.subarray(y * 960 * 4, (y + 1) * 960 * 4), ((oy + y) * 1920 + ox) * 4);
    label(sheet, 1920, s.label, ox + 6, oy + 6);
  });
  label(sheet, 1920, `core:pteranodon near on ${name}, as a client draws it`, 6, 1084);
  const file = join(out, `flyer-close-${name}.png`);
  writeFileSync(file, encodePng(1920, 1104, sheet));
  console.log(file);
}

if (args.includes("--clips")) {
  // Ten frames through each clip whose membrane crossings ref/wing/clips.json counts, textured, at the size the animal
  // stands from about 12 m on a 1080-row screen: ground clips from before and above, flight clips from beside and below.
  const asset = (await findAssets(source)).find((a) => a.id === "core:pteranodon")!;
  const pack = parsePack(repack(new Uint8Array(readFileSync(asset.file)), false, asset));
  const rig = buildRig(pack.header.rigs.find((r) => r.id === "core:pteranodon")!, pack.clips)!;
  const index = pack.meshIndex.get("core:pteranodon")!;
  const materials = materialsOf(asset);
  const view = new ModelView(pack, 640, 360, [0.74, 0.82, 0.92]);
  (pack.header.textures ?? []).forEach((t, slot) => view.texture(slot, t.role, rgbaOf(materials.find((m) => t.id === `${m.id}/${t.role}`)!, t.role, t.top, null).pictures));
  const poser = new Poser(rig);
  const rows: [string, boolean][] = [["idle", true], ["walk", true], ["call", true], ["take_off", true], ["fly", false], ["fly_fast", false], ["dive", false], ["glide", false]];
  const COLS = 10;
  const [CW, CH] = [320, 180];
  const sheet = new Uint8Array(COLS * CW * (rows.length * CH + 24) * 4).fill(236);
  const SW = COLS * CW;
  rows.forEach(([name, ground], j) => {
    const clip = rig.clips.get(name)!;
    for (let k = 0; k < COLS; k++) {
      const frame = Math.round((k * (clip.frames - 1)) / (COLS - 1));
      poser.set(clip, frame);
      const root = rig.solved.pos;
      view.draw({ mesh: index, level: 0, around: ground ? 40 : 70, above: ground ? 20 : -15, centre: [root[0]!, root[1]! + 0.3, root[2]! + 0.4], radius: ground ? 1.3 : 1.9, rig, colors: PTERANODON_DYES, textured: true });
      shrink({ raster: view.raster } as unknown as ProvingView, 640, 360, sheet, SW, k * CW, j * CH, 2);
      label(sheet, SW, `${name} ${frame}`, k * CW + 6, j * CH + 6);
    }
  });
  label(sheet, SW, "core:pteranodon through the clips whose skin crosses, as the game's renderer draws it", 6, rows.length * CH + 4);
  const file = join(out, "flyer-clips.png");
  writeFileSync(file, encodePng(SW, rows.length * CH + 24, sheet));
  console.log(file);
  // The frame of each clip where ref/wing/clips.json counts the most crossings, at full size, from where they would show.
  const worst: [string, number, number, number][] = [
    ["idle", 99, 40, 20], ["walk", 12, 40, 20], ["call", 15, 40, 20], ["take_off", 6, 40, 20],
    ["fly", 21, 70, -15], ["fly_fast", 12, 70, -15], ["dive", 18, 70, -15], ["dive", 18, 160, 35],
    ["attack", 9, 40, 20], ["barrel_roll", 15, 70, -15], ["death", 18, 40, 30], ["torpor_out", 54, 40, 30],
  ];
  const [WW, WH] = [4 * 640, 3 * 360 + 24];
  const near = new Uint8Array(WW * WH * 4).fill(236);
  worst.forEach(([name, frame, around, above], i) => {
    poser.set(rig.clips.get(name)!, frame);
    const root = rig.solved.pos;
    view.draw({ mesh: index, level: 0, around, above, centre: [root[0]!, root[1]! + 0.3, root[2]! + 0.4], radius: above > 0 && around < 90 ? 1.3 : 1.9, rig, colors: PTERANODON_DYES, textured: true });
    const [ox, oy] = [(i % 4) * 640, Math.floor(i / 4) * 360];
    for (let y = 0; y < 360; y++) near.set(view.raster.color.subarray(y * 640 * 4, (y + 1) * 640 * 4), ((oy + y) * WW + ox) * 4);
    label(near, WW, `${name} ${frame}`, ox + 6, oy + 6);
  });
  label(near, WW, "core:pteranodon at the frame of each clip with the most crossings, as the game's renderer draws it", 6, 3 * 360 + 4);
  const close = join(out, "flyer-clips-worst.png");
  writeFileSync(close, encodePng(WW, WH, near));
  console.log(close);
  // Eight frames running about the worst of four clips, nearer, so what changes from one frame to the next is seen.
  const runs: [string, number, number, number][] = [["dive", 14, 160, 35], ["fly_fast", 8, 70, -25], ["walk", 8, 40, 20], ["torpor_out", 50, 40, 30], ["take_off", 2, 40, 20], ["call", 11, 40, 20]];
  const [RW, RH] = [8 * 320, runs.length * 180 + 24];
  const strip = new Uint8Array(RW * RH * 4).fill(236);
  runs.forEach(([name, from, around, above], j) => {
    const clip = rig.clips.get(name)!;
    for (let k = 0; k < 8; k++) {
      const frame = (from + k) % clip.frames;
      poser.set(clip, frame);
      const root = rig.solved.pos;
      view.draw({ mesh: index, level: 0, around, above, centre: [root[0]!, root[1]! + 0.2, root[2]! + 0.2], radius: 1.1, rig, colors: PTERANODON_DYES, textured: true });
      shrink({ raster: view.raster } as unknown as ProvingView, 640, 360, strip, RW, k * 320, j * 180, 2);
      label(strip, RW, `${name} ${frame}`, k * 320 + 6, j * 180 + 6);
    }
  });
  label(strip, RW, "core:pteranodon frame by frame where its skin crosses most, as the game's renderer draws it", 6, runs.length * 180 + 4);
  const motion = join(out, "flyer-clips-motion.png");
  writeFileSync(motion, encodePng(RW, RH, strip));
  console.log(motion);
}

if (args.includes("--levels")) {
  // Each level of its mesh in turn, on one tier: in flight from below and three quarters, and ridden on the ground.
  const name = tierArg === "all" ? "medium" : tierArg;
  const view = provingView(960, 540, {}, files);
  view.scene.assets.tier = tierOf(name);
  view.scene.viewHeight = 540;
  const levels = files.manifest.meshes[mesh]!.levels.length;
  const g = ground(view);
  const poses: [string, Put, Shot["eye"]][] = [
    ["from below", { x: g.x, y: g.y + 10, z: g.z, yaw: 0.6, flying: true, set: (s) => ((s.speed = 4), (s.pitch = -7)) }, [g.x - 2, g.y + 1.7, g.z - 6]],
    ["ridden", { x: g.x, y: g.y, z: g.z, yaw: 0.6, saddled: true, rider: true }, [g.x + 4.5, g.y + 2.6, g.z - 3]],
  ];
  const [SW, SH] = [levels * TW, poses.length * TH + 24];
  const sheet = new Uint8Array(SW * SH * 4).fill(236);
  poses.forEach(([what, body, eye], j) => {
    for (let level = 0; level < levels; level++) {
      const shot: Shot = { label: what, bodies: [body], eye, at: [body.x, body.y + 0.9, body.z], fov: 34 };
      stage(view, shot.bodies);
      aim(view, shot, 960 / 540);
      view.scene.assets.tier = tierOf(name);
      atLevel(view.scene.assets, view, mesh, level, 540);
      settle(view);
      const p = view.scene.packet;
      const drawn = [...Array(p.drawCount).keys()].filter((k) => p.drawMesh[k] === mesh).map((k) => p.drawLod[k]!);
      shrink(view, 960, 540, sheet, SW, level * TW, j * TH, 2);
      label(sheet, SW, `${what}, level ${drawn[0] ?? "-"}`, level * TW + 6, j * TH + 6);
    }
  });
  label(sheet, SW, `core:pteranodon at each level of its mesh, ${name}`, 6, SH - 20);
  const file = join(out, `flyer-levels-${name}.png`);
  writeFileSync(file, encodePng(SW, SH, sheet));
  console.log(file);
}
process.exit(0);
