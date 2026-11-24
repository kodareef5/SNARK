// The launcher and its round as the game draws them: the software rasterizer drawing what a client on a graphics tier
// draws, on the proving ground's grass. Each shot is written under artifacts/art/core/launcher/ as <shot>_<tier>.png:
//
//   held     two survivors holding the launcher, from the front at three quarters
//   side     the same from behind their right shoulders
//   near     close on the launcher in the first survivor's hands, from its sight's side
//   grip     close on it from its other side
//   eye      from over the first survivor's own head
//   first    from where the first survivor's own eye is, as a player holding it sees it
//   lying    the launcher lying on the grass as a dropped bag of one shows it, close
//   round    the round alone, half a metre over the grass, close, from its side
//   left, right, back, front   the launcher alone, upright half a metre over the grass, close from that side of it
//
//   bun assets/source/core/items/weapons/launcher/snap.ts [shot ...] [--tier high] [--at X,Y,Z] [--name SUFFIX]
//
// --at moves the eye of `first`, in metres from where the survivor stands: across, up and ahead. --name ends the
// file's name, to keep one run's pictures beside another's. Not part of the build. The pictures are not kept: the
// sheet `bun run art -- core:launcher --sheet` draws shows every level and where each tier takes it up.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tierOf } from "../../../../../../client/core/assets/tiers.ts";
import { defaultLook, LOOK_HAIR, LOOK_SEX, LOOK_SKIN } from "../../../../../../shared/anim/look.ts";
import { AnimState, bodySeed } from "../../../../../../shared/anim/pose.ts";
import { SKIN_TONES } from "../../../../../../shared/pack/palette.ts";
import { GEAR_COUNT, GEAR_HELD } from "../../../../../../shared/sim/entities.ts";
import { ACT_NONE, HOLD_RIFLE } from "../../../../../../shared/sim/weapon.ts";
import { SOURCE } from "../../../../../../tools/art/source.ts";
import { provingView, settle, type ProvingView } from "../../../../../../tools/snap.ts";
import { gameFiles } from "../../../../../../tools/snap/files.ts";
import { encodePng } from "../../../../../../tools/snap/png.ts";

const [W, H] = [1600, 900];
/** A patch of grass beyond the plaza, where the other weapons' pictures stand. */
const [CX, CZ] = [160, 360];
const SHOTS = ["held", "side", "near", "grip", "eye", "first", "lying", "left", "right", "back", "front", "round"] as const;
type Shot = (typeof SHOTS)[number];

const args = process.argv.slice(2);
const value = (name: string): string | undefined => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const valued = new Set(["--tier", "--at", "--name"].flatMap((f) => (args.includes(f) ? [args.indexOf(f) + 1] : [])));
const asked = args.filter((a, i) => !a.startsWith("--") && !valued.has(i));
const shots = asked.length > 0 ? (asked as Shot[]) : [...SHOTS];
const tier = value("tier") ?? "high";
const files = await gameFiles(resolve(SOURCE));
const OUT = resolve(import.meta.dir, "../../../../../../artifacts/art/core/launcher");
mkdirSync(OUT, { recursive: true });

const LAUNCHER = "core:rocket_launcher";
/** Where the first survivor's eye is, about, from where he stands: across, up, ahead. He faces -Z, so behind him is +Z. */
const EYE = (value("at") ?? "0.06,1.63,0.12").split(",").map(Number) as [number, number, number];
/** Prop kinds of the core content, each drawn here as another mesh. */
const BORROWED = ["core:egg_dodo"];

function idFor(n: number, seed: number): number {
  for (let id = 1024 * (n + 1); id < 1024 * (n + 2); id++) if (bodySeed(id) === seed) return id;
  return 1024 * (n + 1);
}

function aim(view: ProvingView, x: number, up: number, z: number, tx: number, at: number, tz: number, fov: number): void {
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

/** Survivors holding the launcher, each at (x, z) from the patch's middle, facing -Z. */
function holders(view: ProvingView, at: readonly (readonly [number, number])[], bald = false): void {
  const r = view.remote;
  const item = view.reg.index.get(LAUNCHER)!;
  const kind = view.reg.index.get("core:survivor")!;
  const st = new AnimState();
  r.count = 0;
  r.tick = 400;
  at.forEach(([x, z], i) => {
    const n = r.count++;
    const look = defaultLook();
    look[LOOK_SEX] = i % 2;
    look[LOOK_HAIR] = bald ? 0 : 1 + (i % 4);
    look[LOOK_SKIN] = (i * 3) % SKIN_TONES;
    r.id[n] = idFor(n, (n * 5) % 32);
    r.kind[n] = kind;
    r.x[n] = CX + x;
    r.z[n] = CZ + z;
    r.y[n] = view.hf.heightAt(r.x[n]!, r.z[n]!);
    r.yaw[n] = Math.PI;
    r.flags[n] = 1;
    r.hasLook[n] = 1;
    r.look.set(look, n * look.length);
    r.gear.fill(0, n * GEAR_COUNT, (n + 1) * GEAR_COUNT);
    r.gear[n * GEAR_COUNT + GEAR_HELD] = item;
    st.unpack(0);
    st.mode = 1;
    st.grounded = true;
    // The launcher's item says which pose this hold is: the tube on the shoulder.
    st.setAction(ACT_NONE, HOLD_RIFLE, 0);
    r.anim[n] = st.pack();
    r.cue[n] = st.packCue();
  });
}

/** Meshes lying on the grass, each as a borrowed prop: (mesh, x, z, yaw). */
function lying(view: ProvingView, meshes: readonly (readonly [string, number, number, number])[], up = 0): void {
  const r = view.remote;
  const scene = view.scene;
  const table = scene.assets.table;
  r.count = 0;
  r.tick = 400;
  meshes.forEach(([mesh, x, z, yaw], k) => {
    const kind = view.reg.index.get(BORROWED[k]!)!;
    scene.meshOfKind[kind] = table.find(mesh);
    scene.colorOfKind[kind] = 0;
    const n = r.count++;
    r.id[n] = idFor(n, 0);
    r.kind[n] = kind;
    r.x[n] = CX + x;
    r.z[n] = CZ + z;
    r.y[n] = view.hf.heightAt(r.x[n]!, r.z[n]!) + up;
    r.yaw[n] = yaw;
    r.flags[n] = 1 | 8;
    r.gear.fill(0, n * GEAR_COUNT, (n + 1) * GEAR_COUNT);
    for (let q = 0; q < 6; q++) r.colors[n * 6 + q] = 0;
    r.span[n] = 1000;
    r.grown[n] = 1400;
    r.seat[n] = r.hasLook[n] = 0;
    r.anim[n] = 0;
    r.cue[n] = 0;
  });
}

function shoot(setup: (view: ProvingView) => void): Uint8ClampedArray {
  const view = provingView(W, H, {}, files);
  view.scene.assets.tier = tierOf(tier);
  view.scene.viewHeight = H;
  setup(view);
  settle(view);
  return view.raster.color;
}

for (const shot of shots) {
  const t0 = performance.now();
  const picture = shoot((view) => {
    if (shot === "lying") {
      lying(view, [[`${LAUNCHER}/dropped`, 0.0, 0.25, Math.PI / 2]]);
      aim(view, 0.0, 0.55, -0.62, 0.0, 0.03, 0.12, 0.85);
      return;
    }
    if (shot === "left" || shot === "right" || shot === "back" || shot === "front") {
      // The held mesh as a prop: its muzzle toward +X of the picture's ground.
      lying(view, [[LAUNCHER, 0, 0, Math.PI / 2]], 0.5);
      if (shot === "left") aim(view, 0.15, 0.78, 0.95, 0.0, 0.58, 0, 0.62);
      else if (shot === "right") aim(view, -0.15, 0.72, -0.95, 0.0, 0.56, 0, 0.62);
      else if (shot === "back") aim(view, -0.78, 0.82, 0.3, -0.05, 0.6, 0.02, 0.6);
      else aim(view, 0.85, 0.72, 0.28, 0.2, 0.58, 0.0, 0.6);
      return;
    }
    if (shot === "round") {
      lying(view, [["core:rocket_round", -0.3, 0, Math.PI / 2]], 0.5);
      aim(view, 0.0, 0.72, -0.7, 0.0, 0.5, 0.05, 0.62);
      return;
    }
    if (shot === "first") {
      holders(view, [[0, 0]], true);
      aim(view, EYE[0], EYE[1], EYE[2], EYE[0] - 0.02, EYE[1] - 0.06, -3, 1.2);
      return;
    }
    holders(view, [[0.45, 0], [-0.45, 0]]);
    if (shot === "held") aim(view, -0.6, 1.45, -2.0, 0.0, 1.15, 0, 0.75);
    else if (shot === "side") aim(view, 1.1, 1.6, 1.9, 0.0, 1.15, 0, 0.75);
    else if (shot === "near") aim(view, 1.25, 1.5, -0.75, 0.45, 1.3, -0.25, 0.7);
    else if (shot === "grip") aim(view, -0.35, 1.25, -0.8, 0.45, 1.25, -0.2, 0.7);
    else aim(view, 0.62, 1.66, 0.42, 0.3, 1.38, -1.0, 1.05);
  });
  const out = join(OUT, `${shot}_${tier}${value("name") ? `_${value("name")}` : ""}.png`);
  writeFileSync(out, encodePng(W, H, picture));
  console.log(`${out}  ${(performance.now() - t0).toFixed(0)} ms`);
}
