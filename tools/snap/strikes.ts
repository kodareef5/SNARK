// A blow as a sheet of moments, one body a tile: a row for each of the two moves a hold strikes with by turns, a column
// every half tick or tick of the swing. `bun tools/snap.ts --strikes fists|hatchet|pick` writes it.
// Seen from outside: --face DEGREES turns the body from the camera, --look STEPS pitches its look, --crouch, --speed N, --close.
// --columns N tiles a row, the first at tick --from, each --step ticks on; --size WxH is a tile.

import { AnimState } from "../../shared/anim/pose.ts";
import { STANCE_CROUCH, STANCE_STAND } from "../../shared/sim/character.ts";
import { GEAR_COUNT, GEAR_HELD } from "../../shared/sim/entities.ts";
import { ACT_NONE, ACT_SWING, FISTS, SWING_TICKS, poseHold } from "../../shared/sim/weapon.ts";
import { settle, type ProvingView } from "../snap.ts";

export interface StrikeSheet {
  /** "fists", or an item's name in the core content: "hatchet", "pick". */
  what: string;
  /** Radians the body is turned from facing the camera. */
  face: number;
  /** The look's pitch, in the pose word's steps. */
  look: number;
  crouch: boolean;
  speed: number;
  /** Frames the chest and arms alone. */
  close: boolean;
  /** Columns, the tick of the first, and the ticks between them. */
  columns: number;
  from: number;
  step: number;
  /** A tile's size in pixels. */
  width: number;
  height: number;
}

const BASE_TICK = 4000;

/** Draws the sheet into `pixels`, `columns` tiles wide and two high. `view` is `width` by `height`. */
export function strikeSheet(view: ProvingView, o: StrikeSheet, pixels: Uint8ClampedArray): void {
  const r = view.remote;
  const kind = view.reg.index.get("core:survivor")!;
  const item = o.what === "fists" ? 0 : view.reg.index.get(`core:${o.what}`)!;
  const weapon = view.reg.weapon[item] ?? FISTS;
  const st = new AnimState();
  const x = 256, z = 228;
  const y = view.hf.heightAt(x, z);
  const cam = view.cam;
  // A narrow view from a little above the chest keeps the body's parts their sizes.
  const far = 7.5;
  cam.x = x;
  cam.z = z - far;
  cam.y = y + (o.close ? 1.42 : 1.25);
  cam.yaw = 0;
  cam.pitch = -0.02;
  cam.fovY = o.close ? 0.2 : 0.33;
  const W = o.width * o.columns;
  for (let row = 0; row < 2; row++) {
    for (let c = 0; c < o.columns; c++) {
      const e = o.from + c * o.step;
      // An even first tick strikes with the first move and an odd one with the second.
      const start = BASE_TICK + row;
      r.count = 1;
      r.tick = start + e;
      r.id[0] = 1024;
      r.kind[0] = kind;
      r.x[0] = x;
      r.y[0] = y;
      r.z[0] = z;
      r.yaw[0] = Math.PI + o.face;
      st.speed = o.speed;
      st.dir = 0;
      st.pitch = o.look;
      st.stance = o.crouch ? STANCE_CROUCH : STANCE_STAND;
      st.grounded = true;
      if (e > SWING_TICKS) st.setAction(ACT_NONE, poseHold(weapon), 0);
      else st.setAction(ACT_SWING, poseHold(weapon), start);
      r.gear.fill(0, 0, GEAR_COUNT);
      r.gear[GEAR_HELD] = item;
      r.flags[0] = 1;
      r.anim[0] = st.pack();
      settle(view);
      const from = view.raster.color;
      for (let py = 0; py < o.height; py++) pixels.set(from.subarray(py * o.width * 4, (py + 1) * o.width * 4), ((row * o.height + py) * W + c * o.width) * 4);
    }
  }
}
