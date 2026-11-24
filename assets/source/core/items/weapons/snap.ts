// The weapons as the game draws them: the software rasterizer drawing what a client on a graphics tier draws, on the
// proving ground's grass. Each shot is written beside this file under ref/, as <shot>_<tier>.png:
//
//   held     survivors holding the bow, the crossbow, the long rifle and the revolver, from the front at three quarters
//   held2    the same, holding the shotgun, the flare gun, the grenade and the bola
//   side     the first four from behind their right shoulders
//   side2    the second four from behind their right shoulders
//   held3    survivors holding the plasma rifle and the plasma pistol, from the front at three quarters
//   side3    the same from behind their right shoulders
//   bolt     the plasma bolt, lying as the projectile it is drawn as
//   lying    each item lying on the grass as a bag of one shows it
//   close    the revolver, the flare gun and the grenade lying, close
//   flown    the arrow, the dart and the live grenade, lying as the projectiles they are drawn as
//
//   bun assets/source/core/items/weapons/snap.ts [shot ...] [--tier high] [--source DIR] [--name SUFFIX]
//
// --source draws another tree's asset folders (the main checkout's, for the boxes these replace). A weapon whose item
// does not exist yet (the shotgun, the flare gun, the bola) is drawn in the hand of a borrowed item; one whose mesh is
// not in the pack is left out. The pictures kept are under ref/game/, as JPEG: these at the high tier, the boxes'
// (`_boxes`), and the bow held (`_bow_trial`), drawn once from a copy of bows/asset.ts that named the held bow
// (bows/ref/TRAITS.md, "The bow in the left hand").

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tierOf } from "../../../../../client/core/assets/tiers.ts";
import { defaultLook, LOOK_HAIR, LOOK_SEX, LOOK_SKIN } from "../../../../../shared/anim/look.ts";
import { AnimState, bodySeed } from "../../../../../shared/anim/pose.ts";
import { SKIN_TONES } from "../../../../../shared/pack/palette.ts";
import { GEAR_COUNT, GEAR_HELD } from "../../../../../shared/sim/entities.ts";
import { ACT_NONE, HOLD_BOW, HOLD_PISTOL, HOLD_RIFLE, HOLD_TOOL } from "../../../../../shared/sim/weapon.ts";
import { SOURCE } from "../../../../../tools/art/source.ts";
import { provingView, settle, type ProvingView } from "../../../../../tools/snap.ts";
import { gameFiles } from "../../../../../tools/snap/files.ts";
import { encodePng } from "../../../../../tools/snap/png.ts";

const [W, H] = [1600, 900];
/** A patch of grass beyond the plaza (the dodo's and the eggs' snaps stand there too). */
const [CX, CZ] = [160, 360];
const SHOTS = ["held", "held2", "held3", "side", "side2", "side3", "lying", "close", "flown", "bolt"] as const;
type Shot = (typeof SHOTS)[number];

const args = process.argv.slice(2);
const value = (name: string): string | undefined => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const valued = new Set(["--tier", "--source", "--name"].flatMap((f) => (args.includes(f) ? [args.indexOf(f) + 1] : [])));
const asked = args.filter((a, i) => !a.startsWith("--") && !valued.has(i));
const shots = asked.length > 0 ? (asked as Shot[]) : [...SHOTS];
const tier = value("tier") ?? "high";
const source = resolve(value("source") ?? SOURCE);
const suffix = value("name") ? `_${value("name")}` : "";
const files = await gameFiles(source);
const OUT = join(import.meta.dir, "ref");
mkdirSync(OUT, { recursive: true });

/** Each weapon in the hand: its item (or one to borrow), its mesh, the hold its item has. */
const HELD = [
  { item: "core:bow", mesh: "core:bow", hold: HOLD_BOW },
  { item: "core:crossbow", mesh: "core:crossbow", hold: HOLD_RIFLE },
  { item: "core:rifle", mesh: "core:rifle", hold: HOLD_RIFLE },
  { item: "core:pistol", mesh: "core:pistol", hold: HOLD_PISTOL },
  // A borrowed item is drawn in its own hold: the shotgun in the rifle's, the flare gun in the pistol's.
  { item: "core:rifle", mesh: "core:shotgun", hold: HOLD_RIFLE },
  { item: "core:pistol", mesh: "core:flare_gun", hold: HOLD_PISTOL },
  { item: "core:grenade", mesh: "core:grenade", hold: HOLD_TOOL },
  { item: "core:hatchet", mesh: "core:bola", hold: HOLD_TOOL },
  { item: "core:rifle_plasma", mesh: "core:rifle_plasma", hold: HOLD_RIFLE },
  { item: "core:pistol_plasma", mesh: "core:pistol_plasma", hold: HOLD_PISTOL },
];
/** Where each row of four begins in HELD, by the number its shot ends in. */
const rowOf = (shot: string): number => (shot.endsWith("3") ? 8 : shot.endsWith("2") ? 4 : 0);
/** Lying: each mesh drawn as a borrowed prop kind. */
const LYING = ["core:bow/dropped", "core:crossbow/dropped", "core:rifle/dropped", "core:shotgun/dropped", "core:pistol/dropped",
  "core:flare_gun/dropped", "core:grenade/dropped", "core:bola/dropped"];
const FLOWN = ["core:arrow", "core:dart", "core:grenade_thrown"];
const BOLT = ["core:plasma_bolt"];
/** The core content's prop kinds, every one drawn as one of these meshes. */
const BORROWED = ["core:egg_dodo", "core:egg_raptor", "core:egg_parasaur", "core:cache", "core:bag", "core:feces", "core:corpse", "core:arrow_stuck",
  "core:grenade_live"];

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

function heldRow(view: ProvingView, from: number, to: number): void {
  const r = view.remote;
  const reg = view.reg;
  const table = view.scene.assets.table;
  // The characters' table of held meshes by item, which a borrowed item's entry is pointed at another mesh in.
  const held = (view.scene.characters as unknown as { held: ({ mesh: number; bone: number } | null)[] }).held;
  const kind = reg.index.get("core:survivor")!;
  const st = new AnimState();
  r.count = 0;
  r.tick = 400;
  const shown = HELD.slice(from, to).filter((h) => table.find(h.mesh) >= 0);
  shown.forEach((h, i) => {
    const item = reg.index.get(h.item)!;
    const mesh = table.find(h.mesh);
    held[item] = { mesh, bone: table.bone[mesh]! };
    const n = r.count++;
    const look = defaultLook();
    look[LOOK_SEX] = i % 2;
    look[LOOK_HAIR] = 1 + (i % 4);
    look[LOOK_SKIN] = (i * 3) % SKIN_TONES;
    r.id[n] = idFor(n, (n * 5) % 32);
    r.kind[n] = kind;
    r.x[n] = CX + (shown.length / 2 - 0.5 - i) * 0.9;
    r.z[n] = CZ;
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
    st.setAction(ACT_NONE, h.hold, 0);
    r.anim[n] = st.pack();
    r.cue[n] = st.packCue();
  });
}

function lyingRow(view: ProvingView, meshes: readonly string[]): void {
  const r = view.remote;
  const reg = view.reg;
  const scene = view.scene;
  const table = scene.assets.table;
  r.count = 0;
  r.tick = 400;
  const shown = meshes.filter((m) => table.find(m) >= 0);
  shown.forEach((m, k) => {
    const kind = reg.index.get(BORROWED[k]!)!;
    scene.meshOfKind[kind] = table.find(m);
    scene.colorOfKind[kind] = 0;
    const n = r.count++;
    // The long ones across the view in rows, one behind another; the small ones in a row in front.
    const long = k < 4 && meshes === LYING;
    r.id[n] = idFor(n, 0);
    r.kind[n] = kind;
    r.x[n] = CX + (long ? 0.1 : meshes === LYING ? 0.95 - (k - 4) * 0.6 : 0.5 - k * 0.45);
    r.z[n] = CZ + (long ? 0.5 + k * 0.42 : 0);
    r.y[n] = view.hf.heightAt(r.x[n]!, r.z[n]!);
    r.yaw[n] = long ? Math.PI / 2 : meshes === LYING ? 2.2 : Math.PI / 2 + 0.3;
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

for (const shot of shots) {
  const t0 = performance.now();
  const view = provingView(W, H, {}, files);
  view.scene.assets.tier = tierOf(tier);
  view.scene.viewHeight = H;
  if (shot === "lying" || shot === "close" || shot === "flown" || shot === "bolt") {
    lyingRow(view, shot === "flown" ? FLOWN : shot === "bolt" ? BOLT : LYING);
    if (shot === "close") aim(view, 0.62, 0.42, -0.42, 0.62, 0.0, 0.0, 0.7);
    else if (shot === "lying") aim(view, 0.0, 1.55, -1.25, 0.05, 0.0, 0.55, 0.95);
    else aim(view, 0.0, 0.45, -0.75, 0.0, 0.0, 0.0, 0.75);
  } else if (shot.startsWith("side")) {
    heldRow(view, rowOf(shot), rowOf(shot) + 4);
    aim(view, 1.3, 1.6, 2.3, -0.1, 1.0, 0, 0.8);
  } else {
    heldRow(view, rowOf(shot), rowOf(shot) + 4);
    aim(view, -0.7, 1.45, -2.5, -0.15, 1.05, 0, 0.75);
  }
  settle(view);
  const out = join(OUT, `${shot}_${tier}${suffix}.png`);
  writeFileSync(out, encodePng(W, H, view.raster.color));
  console.log(`${out}  ${(performance.now() - t0).toFixed(0)} ms`);
}
