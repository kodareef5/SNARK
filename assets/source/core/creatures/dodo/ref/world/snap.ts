// The dodo as the game draws it today: the software rasterizer drawing what a client on the medium and the ultra tier
// draws, with the pictures the pack names, on the proving ground's grass north-west of the plaza. Each shot is written
// beside this file as <shot>_<tier>.png:
//
//   2m, 6m, 20m   a flock seen from a survivor's eyes 2, 6 and 20 m from the nearest bird, at the game's 70 degree view;
//                 each also enlarged about the birds, pixel for pixel (<shot>_<tier>_x<times>.png)
//   profile       the default bird side on from 2 m at its own height, through a long lens, against the concept's side
//   dyes          ten birds side on: the default bird, then nine wild rolls from its colour set
//   young         grown, newborn, a third grown and three quarters grown, and its egg, with a survivor for size
//   knocked_out   standing, going down, lying, and swallowing a berry as it lies
//   lying         two birds knocked out, close: one seen from its belly, one from its back
//   dead          two corpses six seconds after death, one killed standing and one killed knocked out, by a live bird
//   held          a survivor holding one in both arms, from her front right, and one crouched holding another behind her
//   held_side     the same survivor from her right through a long lens, to see the bird held clear of her chest
//   held_left     and from her left
//   held_top      from above her right shoulder, where the bird's back meets her chest
//   held_back     from behind her, to see her hands under it
//   held_crouch   the crouched one from her left: the bird held out in front of her knees
//   held_eye      what she sees of it from her own eyes, looking ahead
//   hurt_2m, hurt_10m     four birds side on, unhurt and at hurt stages 1, 2 and 3, from 2 and 10 m
//   decay_2m, decay_10m   four corpses lying, fresh and at decay stages 1, 2 and 3, from 2 and 10 m; each also
//                         enlarged about the birds
//
//   bun assets/source/core/creatures/dodo/ref/world/snap.ts [shot ...] [--tier medium|ultra] [--out DIR]

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tierOf } from "../../../../../../../client/core/assets/tiers.ts";
import { AnimState, CUE_TORPOR, LAYER_EAT, bodySeed } from "../../../../../../../shared/anim/pose.ts";
import { Rng } from "../../../../../../../shared/rng.ts";
import { rollWild } from "../../../../../../../shared/sim/genome.ts";
import { GEAR_COUNT } from "../../../../../../../shared/sim/entities.ts";
import { ACT_NONE, ACT_SWING, HOLD_CARRY, HOLD_HANDS } from "../../../../../../../shared/sim/weapon.ts";
import { STANCE_CROUCH } from "../../../../../../../shared/sim/character.ts";
import { SOURCE } from "../../../../../../../tools/art/source.ts";
import { provingView, settle, type ProvingView } from "../../../../../../../tools/snap.ts";
import { gameFiles } from "../../../../../../../tools/snap/files.ts";
import { encodePng } from "../../../../../../../tools/snap/png.ts";

const [W, H] = [1280, 720];
/** A grassy patch beyond the plaza with no tree or rock between it and a camera 26 m to its south. */
const [CX, CZ] = [160, 360];
const SHOTS = ["2m", "6m", "20m", "profile", "dyes", "young", "knocked_out", "lying", "dead", "held", "held_side", "held_left", "held_top", "held_back", "held_crouch", "held_eye", "hurt_2m", "hurt_10m", "decay_2m", "decay_10m"] as const;
type Shot = (typeof SHOTS)[number];

const args = process.argv.slice(2);
const tierArg = args.indexOf("--tier");
const outArg = args.indexOf("--out");
const tiers = tierArg >= 0 ? [args[tierArg + 1]!] : ["medium", "ultra"];
const dir = outArg >= 0 ? args[outArg + 1]! : import.meta.dir;
const asked = args.filter((a, i) => !a.startsWith("--") && (tierArg < 0 || i !== tierArg + 1) && (outArg < 0 || i !== outArg + 1));
const shots = asked.length > 0 ? (asked as Shot[]) : [...SHOTS];
const files = await gameFiles(SOURCE);

interface Body {
  x: number;
  z: number;
  yaw: number;
  kind?: string;
  /** Six palette entries; the default bird's when not given. */
  colors?: readonly number[];
  /** Fraction grown, 1 for an adult. */
  grown?: number;
  set?: (s: AnimState) => void;
  /** Ticks ahead on its clock. */
  seed?: number;
}

/** The smallest id whose body clock runs `seed` ticks ahead, in its own block of 1024. */
function idFor(n: number, seed: number): number {
  for (let id = 1024 * (n + 1); id < 1024 * (n + 2); id++) if (bodySeed(id) === seed) return id;
  return 1024 * (n + 1);
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
    const kind = reg.index.get(b.kind ?? "core:dodo")!;
    r.id[n] = idFor(n, b.seed ?? (n * 7) % 32);
    r.kind[n] = kind;
    r.x[n] = CX + b.x;
    r.z[n] = CZ + b.z;
    r.y[n] = view.hf.heightAt(CX + b.x, CZ + b.z);
    r.yaw[n] = b.yaw;
    r.flags[n] = b.kind === "core:egg_dodo" ? 1 | 8 : 1;
    r.gear.fill(0, n * GEAR_COUNT, (n + 1) * GEAR_COUNT);
    const colors = b.kind === undefined || b.kind === "core:dodo" ? (b.colors ?? plain) : [0, 0, 0, 0, 0, 0];
    for (let q = 0; q < 6; q++) r.colors[n * 6 + q] = colors[q]!;
    const grown = b.grown ?? 1;
    r.span[n] = grown < 1 ? 1000 : 0;
    r.grown[n] = grown < 1 ? tick + Math.round((1 - grown) * 1000) : 0;
    r.seat[n] = r.hasLook[n] = 0;
    st.unpack(0);
    st.mode = 1;
    st.grounded = true;
    st.setAction(ACT_NONE, HOLD_HANDS, 0);
    b.set?.(st);
    r.anim[n] = st.pack();
    r.cue[n] = st.packCue();
  }
}

/** Points the camera from (x, y above the ground, z) about the patch's middle at a point `at` high over (tx, tz). */
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

const walk = (s: AnimState): void => void (s.speed = 1);
const peck = (tick: number) => (s: AnimState): void => s.setAction(ACT_SWING, HOLD_HANDS, tick - 4);

/** A flock of six about the patch's middle and a survivor among them, the nearest bird at the origin. */
function flock(view: ProvingView, tick: number): void {
  const set = view.reg.colorSet[view.reg.index.get("core:dodo")!]!;
  const rng = new Rng(11);
  const wild = (): number[] => [...rollWild(rng, 1 + rng.int(30), set).colors];
  place(view, [
    { x: 0, z: 0, yaw: Math.PI - 0.7 },
    { x: 1.2, z: 1.0, yaw: Math.PI + 1.1, colors: wild(), set: peck(tick) },
    { x: -1.3, z: 1.4, yaw: 1.6, colors: wild(), set: walk },
    { x: 0.5, z: 2.6, yaw: Math.PI - 0.2, colors: wild() },
    { x: 2.4, z: 3.1, yaw: -2.2, colors: wild(), set: walk },
    { x: -2.6, z: 3.6, yaw: 2.6, colors: wild() },
    { x: 3.4, z: 1.6, yaw: -2.6, kind: "core:survivor" },
  ], tick);
}

/**
 * Survivors holding birds: body `k` of each pair holds body `k + 1`, which is placed at her palms, as a client places a
 * bird with CUE_HELD whose seat is her. With `own`, the first survivor is the viewer's own body, seen from her eyes.
 */
function holding(view: ProvingView, tick: number, pairs: readonly [x: number, z: number, yaw: number, crouched: boolean][], own: boolean): void {
  const bodies: Body[] = [];
  for (const [x, z, yaw, crouched] of pairs) {
    bodies.push({ x, z, yaw, kind: "core:survivor", set: (s) => (s.setAction(ACT_NONE, HOLD_CARRY, 0), void (crouched && (s.stance = STANCE_CROUCH))) });
    bodies.push({ x, z, yaw, set: (s) => void (s.held = true), seed: 9 });
  }
  place(view, bodies, tick);
  const r = view.remote;
  for (let k = 0; k < r.count; k += 2) r.seat[k + 1] = r.id[k]! + 1;
  if (!own) return;
  // The first survivor is drawn as the viewer's own body, from its prediction, and not again among the others.
  const st = new AnimState();
  st.unpack(r.anim[0]!, 0);
  st.seed = bodySeed(r.id[0]!);
  view.scene.own = { kind: r.kind[0]!, x: r.x[0]!, y: r.y[0]!, z: r.z[0]!, yaw: r.yaw[0]!, state: st, tick, firstPerson: true, colors: new Uint8Array(6), look: null, gear: new Uint16Array(GEAR_COUNT), id: r.id[0]! };
  view.scene.skip = r.id[0]!;
}

function scene(view: ProvingView, shot: Shot): void {
  const tick = 400;
  if (shot.startsWith("held")) {
    const eye = shot === "held_eye";
    // She faces -Z, so her right is +X.
    holding(view, tick, eye ? [[0, 0, 0, false]] : [[0, 0, Math.PI, false], [-1.5, 1.3, Math.PI - 0.6, true]], eye);
    if (shot === "held") aim(view, 1.1, 1.35, -1.9, -0.25, 0.95, 0.2, 0.8);
    else if (shot === "held_crouch") aim(view, 0.9, 0.8, 0.4, -1.5, 0.7, 1.3, 0.5);
    else if (shot === "held_left") aim(view, -3.6, 1.2, -0.25, 0, 1.2, -0.25, 0.3);
    else if (shot === "held_top") aim(view, 0.45, 2.6, 0.25, 0, 1.2, -0.2, 0.6);
    else if (shot === "held_side") aim(view, 3.6, 1.1, -0.25, 0, 1.1, -0.25, 0.4);
    else if (shot === "held_back") aim(view, 0.75, 1.95, 0.9, 0, 1.0, -0.35, 0.8);
    else {
      aim(view, 0, 1.62, 0, 0, 1.2, 3, 1.2217);
      view.cam.pitch = 0;
    }
    return;
  }
  if (shot === "2m" || shot === "6m" || shot === "20m") {
    flock(view, tick);
    const d = { "2m": 2, "6m": 6, "20m": 20 }[shot];
    aim(view, -0.25 * d, 1.62, -d, 0.6, 0.35, 1.6);
    return;
  }
  if (shot === "profile") {
    place(view, [{ x: 0, z: 0, yaw: Math.PI / 2 }], tick);
    aim(view, 0, 0.45, -2, 0, 0.36, 0, 0.42);
    return;
  }
  if (shot === "dyes") {
    const set = view.reg.colorSet[view.reg.index.get("core:dodo")!]!;
    const rng = new Rng(5);
    const bodies: Body[] = [];
    for (let i = 0; i < 10; i++) {
      const row = i < 5 ? 0 : 1;
      const col = i % 5;
      bodies.push({ x: (2 - col) * 0.95 + row * 0.45, z: row * 1.3, yaw: -Math.PI / 2 + (row ? 0.35 : -0.25), colors: i === 0 ? undefined : [...rollWild(rng, 1, set).colors], seed: i * 3 });
    }
    place(view, bodies, tick);
    aim(view, 0, 1.6, -3.4, 0, 0.3, 0.6, 0.75);
    return;
  }
  if (shot === "young") {
    place(view, [
      { x: 0.9, z: 0, yaw: -Math.PI / 2 - 0.3 },
      { x: 0.1, z: 0, yaw: -Math.PI / 2 - 0.3, grown: 0 },
      { x: -0.4, z: 0, yaw: -Math.PI / 2 - 0.3, grown: 0.3 },
      { x: -1.15, z: 0, yaw: -Math.PI / 2 - 0.3, grown: 0.75 },
      { x: 1.9, z: 0.5, yaw: 0.4, kind: "core:egg_dodo" },
      { x: -2.1, z: 1.2, yaw: -2.4, kind: "core:survivor" },
    ], tick);
    aim(view, -0.1, 1.2, -3.6, -0.1, 0.45, 0.3, 0.8);
    return;
  }
  if (shot === "knocked_out") {
    const at = (frames: number): number => (tick - frames) & 255;
    place(view, [
      { x: 1.2, z: 0, yaw: -Math.PI / 2 - 0.4 },
      { x: 0.4, z: 0, yaw: -Math.PI / 2 - 0.4, set: (s) => ((s.out = true), (s.cue = CUE_TORPOR), (s.cueStart = at(25))) },
      { x: -0.4, z: 0, yaw: -Math.PI / 2 - 0.4, set: (s) => void (s.out = true) },
      { x: -1.2, z: 0, yaw: -Math.PI / 2 - 0.4, set: (s) => ((s.out = true), (s.layer = LAYER_EAT), (s.layerStart = at(12))) },
    ], tick);
    aim(view, 0, 1.3, -2.6, 0, 0.15, 0, 0.9);
    return;
  }
  if (shot.startsWith("hurt") || shot.startsWith("decay")) {
    // Side on in a row, the worst on the right. A corpse is drawn lying as one knocked out lies, its belly to the camera.
    const dead = shot.startsWith("decay");
    const d = shot.endsWith("10m") ? 10 : 2;
    place(view, [0, 1, 2, 3].map((k) => ({ x: (1.5 - k) * 0.85, z: 0, yaw: dead ? Math.PI / 2 + 0.3 : -Math.PI / 2 - 0.25, seed: k * 5, set: (s: AnimState) => (dead ? Object.assign(s, { out: true, dead: true, decay: k }) : Object.assign(s, { hurt: k })) })), tick);
    aim(view, 0, 1.62, -d, 0, dead ? 0.1 : 0.32, 0);
    return;
  }
  if (shot === "lying") {
    place(view, [
      { x: 0.35, z: 0, yaw: -Math.PI / 2 - 0.3, set: (s) => void (s.out = true) },
      { x: -0.45, z: 0.25, yaw: Math.PI / 2 + 0.3, set: (s) => void (s.out = true) },
    ], tick);
    aim(view, 0, 0.75, -1.5, -0.05, 0.12, 0.1, 0.62);
    return;
  }
  // dead: two birds die, one standing and one knocked out; a third stays alive beside them.
  const r = view.remote;
  place(view, [
    { x: 0.8, z: 0, yaw: -Math.PI / 2 - 0.4 },
    { x: -0.3, z: 0.1, yaw: -Math.PI / 2 + 0.5, set: (s) => void (s.out = true) },
    { x: -1.5, z: 0.6, yaw: Math.PI - 0.5 },
  ], 100);
  const cam = view.cam;
  aim(view, -0.3, 1.1, -2.1, -0.3, 0.1, 0.25, 0.75);
  // Each frame carries its uploads to the card, as settle's do, so that what it fetched is there when the shot is drawn.
  const frame = (): void => {
    view.scene.now += 1000 / 60;
    view.port?.advance(view.scene.now);
    const p = view.scene.build(cam, r);
    p.drawCount = p.tileCount = 0;
    view.raster.render(p);
  };
  frame();
  r.tick += 0.5;
  frame();
  r.died = new Map([[r.id[0]!, r.tick], [r.id[1]!, r.tick]]);
  for (const k of ["id", "kind", "x", "y", "z", "yaw", "flags", "anim", "cue", "span", "grown", "seat", "hasLook"] as const) r[k][0] = r[k][2]!;
  r.colors.copyWithin(0, 12, 18);
  r.count = 1;
  for (let f = 0; f < 6 * 60; f++) {
    r.tick += 0.5;
    frame();
  }
}

/** Where the point (x, up, z) about the patch's middle falls in the picture, in pixels. */
function project(view: ProvingView, x: number, up: number, z: number): [number, number] {
  const { cam, hf } = view;
  const m = cam.viewProj;
  const [rx, ry, rz] = [CX + x - cam.x, hf.heightAt(CX + x, CZ + z) + up - cam.y, CZ + z - cam.z];
  const w = m[3]! * rx + m[7]! * ry + m[11]! * rz;
  return [(((m[0]! * rx + m[4]! * ry + m[8]! * rz) / w) * 0.5 + 0.5) * W, (0.5 - ((m[1]! * rx + m[5]! * ry + m[9]! * rz) / w) * 0.5) * H];
}

/** The pixels about (px, py) blown up `k` times, each a square, so the bird can be seen as drawn at that distance. */
function enlarged(color: Uint8ClampedArray, px: number, py: number, k: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(W * H * 4);
  const x0 = Math.min(Math.max(Math.round(px - W / k / 2), 0), W - Math.ceil(W / k));
  const y0 = Math.min(Math.max(Math.round(py - H / k / 2), 0), H - Math.ceil(H / k));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out.set(color.subarray(((y0 + Math.floor(y / k)) * W + x0 + Math.floor(x / k)) * 4, ((y0 + Math.floor(y / k)) * W + x0 + Math.floor(x / k)) * 4 + 4), (y * W + x) * 4);
  return out;
}

/** For the distance shots, the point to enlarge about and how many times. */
const CROPS: Partial<Record<Shot, [number, number, number, number]>> = { "2m": [0, 0.33, 0, 2], "6m": [0.4, 0.3, 1.6, 3], "20m": [0.4, 0.3, 1.6, 6], hurt_10m: [0, 0.32, 0, 3], decay_10m: [0, 0.1, 0, 3] };

for (const tier of tiers) {
  for (const shot of shots) {
    const t0 = performance.now();
    const view = provingView(W, H, {}, files);
    view.scene.assets.tier = tierOf(tier);
    view.scene.viewHeight = H;
    scene(view, shot);
    settle(view);
    const out = join(dir, `${shot}_${tier}.png`);
    writeFileSync(out, encodePng(W, H, view.raster.color));
    const crop = CROPS[shot];
    if (crop) {
      const [px, py] = project(view, crop[0], crop[1], crop[2]);
      writeFileSync(join(dir, `${shot}_${tier}_x${crop[3]}.png`), encodePng(W, H, enlarged(view.raster.color, px, py, crop[3])));
    }
    console.log(`${out}  ${(performance.now() - t0).toFixed(0)} ms`);
  }
}
