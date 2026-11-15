// The dodo in the game's world: a flock on the proving ground east of the pool, where its beach table puts them, drawn
// as a client on the high tier draws them with the pictures the pack names, from near, from a survivor's height and from
// far. Each bird has colours rolled from its species' set as a wild one's are, the nearest the default bird, and a
// survivor stands among them for size. Writes near.png, standing.png and far.png beside this file.
//
//   bun assets/source/core/creatures/dodo/ref/world/snap.ts

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tierOf } from "../../../../../../../client/core/assets/tiers.ts";
import { AnimState } from "../../../../../../../shared/anim/pose.ts";
import { Rng } from "../../../../../../../shared/rng.ts";
import { rollWild } from "../../../../../../../shared/sim/genome.ts";
import { GEAR_COUNT } from "../../../../../../../shared/sim/entities.ts";
import { ACT_NONE, ACT_SWING, HOLD_HANDS } from "../../../../../../../shared/sim/weapon.ts";
import { PROVING_POOL } from "../../../../../../../shared/world/proving.ts";
import { SOURCE } from "../../../../../../../tools/art/source.ts";
import { provingView, settle, type ProvingView } from "../../../../../../../tools/snap.ts";
import { gameFiles } from "../../../../../../../tools/snap/files.ts";
import { encodePng } from "../../../../../../../tools/snap/png.ts";

const [W, H] = [1280, 720];
const files = await gameFiles(SOURCE);
// The flock's middle, east of the pool on its flat rim.
const [CX, CZ] = [PROVING_POOL.x + 30, PROVING_POOL.z];

/** Six dodos about (CX, CZ): x, z from the middle, facing in radians (0 is +z), metres a second, pecking. */
const BIRDS: readonly (readonly [number, number, number, number, boolean])[] = [
  [0, 0, -1.9, 0, false],
  [-1.1, 0.9, -1.2, 0, true],
  [1.2, 0.6, -2.6, 0.5, false],
  [0.4, 2.2, -1.6, 0, false],
  [-2.3, 2.6, -0.9, 1.3, false],
  [2.6, 3.4, -2.2, 0, false],
];

function scene(view: ProvingView, tick: number): void {
  const r = view.remote;
  const reg = view.reg;
  const kind = reg.index.get("core:dodo")!;
  const set = reg.colorSet[kind]!;
  const rng = new Rng(7);
  const st = new AnimState();
  r.count = 0;
  r.tick = tick;
  const put = (k: number, x: number, z: number, yaw: number): number => {
    const n = r.count++;
    r.id[n] = 2048 * (n + 1) + n * 37;
    r.kind[n] = k;
    r.x[n] = CX + x;
    r.z[n] = CZ + z;
    r.y[n] = view.hf.heightAt(CX + x, CZ + z);
    r.yaw[n] = yaw;
    r.flags[n] = 1;
    r.gear.fill(0, n * GEAR_COUNT, (n + 1) * GEAR_COUNT);
    r.span[n] = r.grown[n] = r.seat[n] = r.hasLook[n] = 0;
    return n;
  };
  BIRDS.forEach(([x, z, yaw, speed, peck], i) => {
    const n = put(kind, x, z, yaw);
    const g = rollWild(rng, 1 + rng.int(30), set);
    for (let q = 0; q < 6; q++) r.colors[n * 6 + q] = i === 0 ? set.palette[set.start[q]!]! : g.colors[q]!;
    st.speed = speed;
    st.mode = 1;
    st.grounded = true;
    st.setAction(peck ? ACT_SWING : ACT_NONE, HOLD_HANDS, peck ? tick - 4 : 0);
    r.anim[n] = st.pack();
  });
  const man = put(reg.index.get("core:survivor")!, 1.9, -0.6, -2.2);
  st.speed = 0;
  st.setAction(ACT_NONE, HOLD_HANDS, 0);
  r.anim[man] = st.pack();
  r.colors.fill(0, man * 6, man * 6 + 6);
}

/** Draws the flock with the camera `back` metres from its middle, `up` metres above the ground, turned `yaw`. */
function shot(name: string, back: number, side: number, up: number, yaw: number, pitch: number, fov: number): void {
  const view = provingView(W, H, {}, files);
  view.scene.assets.tier = tierOf("high");
  view.scene.viewHeight = H;
  scene(view, 40);
  const cam = view.cam;
  cam.x = CX + side;
  cam.z = CZ - back;
  cam.y = view.hf.heightAt(cam.x, cam.z) + up;
  cam.yaw = yaw;
  cam.pitch = pitch;
  cam.fovY = fov;
  settle(view);
  const out = join(import.meta.dir, `${name}.png`);
  writeFileSync(out, encodePng(W, H, view.raster.color));
  console.log(out);
}

shot("near", 1.6, -0.9, 0.75, 0.5, -0.12, 0.7);
shot("standing", 4, -1.5, 1.62, 0.35, -0.3, 0.9);
shot("far", 22, -9, 1.62, 0.35, -0.05, 0.9);
