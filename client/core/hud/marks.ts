// Marks over the world in view: another survivor's glass glinting at the viewer (CUE_SCOPED, D1083), and the creatures
// the tribe spotted (MARK_SPOT, D1082).

import { CUE_DEAD, CUE_SCOPED } from "../../../shared/anim/pose.ts";
import { PI, TAU } from "../../../shared/math/scalar.ts";
import { HIT_NONE, castWorld } from "../../../shared/world/ray.ts";
import { MARK_SPOT } from "../../../shared/world/tactical.ts";
import { K_PANEL } from "../ui/nodes.ts";
import { S_CROSS } from "../ui/style.ts";
import { band, type HudWidget } from "./widget.ts";

/** A spotted creature's mark over it in the view (D1082), and its ink. */
export const KEY_SPOT = 5200;
export const SPOT_INK = 0xff6a3d;
const SPOT_SIDE = 9;
/** Another survivor's glass glinting at the viewer (D1083). */
export const KEY_GLINT = 5230;
const GLINT_INK = 0xfff6d8;
/** A glint shows within this of straight at the viewer, radians, and past this many metres. */
const GLINT_HALF = 0.12;
const GLINT_NEAR = 20;
/** Metres over the ground a spotted creature's mark is drawn. */
const SPOT_RISE = 3;
const VIEW_FLAG_PLAYER = 4;

export interface MarksModel {
  /** Where on the screen other survivors' glasses glint at the viewer, and how brightly. */
  glints: { u: number; v: number; alpha: number }[];
  glintCount: number;
  /** Where on the screen the creatures the tribe spotted stand, 0 to 1 with y down, as many as `spotCount`. */
  spots: { u: number; v: number }[];
  spotCount: number;
}

const spot = [0, 0, 0];

export const MARKS: HudWidget<MarksModel> = {
  name: "marks in view",
  bands: [band(KEY_SPOT, 8), band(KEY_GLINT, 4)],
  make: () => ({ glints: [], glintCount: 0, spots: [], spotCount: 0 }),
  fill(m, c) {
    const a = c.frame;
    if (!a) return;
    const { cam, world, reg } = a;
    // Brighter the straighter the glass looks at the viewer.
    const r = c.remote;
    m.glintCount = 0;
    for (let i = 0; i < r.count && m.glintCount < 4; i++) {
      if ((r.cue[i]! & CUE_SCOPED) === 0 || (r.flags[i]! & VIEW_FLAG_PLAYER) === 0 || (r.cue[i]! & CUE_DEAD) !== 0) continue;
      const dx = cam.x - r.x[i]!, dz = cam.z - r.z[i]!, far = Math.hypot(dx, dz);
      let off = Math.abs(Math.atan2(dx, dz) - r.yaw[i]!) % TAU;
      if (off > PI) off = TAU - off;
      if (far < GLINT_NEAR || off > GLINT_HALF) continue;
      const y = r.y[i]! + reg.bodyHeight[r.kind[i]!]! * 0.9;
      if (!cam.project(r.x[i]!, y, r.z[i]!, spot) || spot[0]! < 0 || spot[0]! > 1 || spot[1]! < 0 || spot[1]! > 1) continue;
      const ey = y - cam.y, d = Math.hypot(dx, ey, dz);
      if (castWorld(world, cam.x, cam.y, cam.z, -dx / d, ey / d, -dz / d, d - 0.5) !== HIT_NONE) continue;
      const g = (m.glints[m.glintCount++] ??= { u: 0, v: 0, alpha: 0 });
      g.u = spot[0]!;
      g.v = spot[1]!;
      g.alpha = 1 - off / GLINT_HALF;
    }
    const marks = c.session.tactical.marks;
    m.spotCount = 0;
    for (let i = 0; i < marks.count && m.spotCount < 8; i++) {
      if (marks.kind[i] !== MARK_SPOT) continue;
      const x = marks.x[i]!, z = marks.z[i]!;
      if (!cam.project(x, world.hf.heightAt(x, z) + SPOT_RISE, z, spot) || spot[0]! < 0 || spot[0]! > 1 || spot[1]! < 0 || spot[1]! > 1) continue;
      const out = (m.spots[m.spotCount++] ??= { u: 0, v: 0 });
      out.u = spot[0]!;
      out.v = spot[1]!;
    }
  },
  build(f, m, at) {
    const { W, H } = at;
    // Another's glass glinting at the viewer.
    for (let i = 0; i < m.glintCount && i < 4; i++) {
      const g = m.glints[i]!, side = 4 + 8 * g.alpha;
      const n = f.add(KEY_GLINT + i, K_PANEL, g.u * W - side / 2, g.v * H - side / 2, side, side, S_CROSS);
      n.tint = GLINT_INK;
      n.alpha = 0.35 + 0.65 * g.alpha;
    }
    // What the tribe spotted, over it where it stands in view.
    for (let i = 0; i < m.spotCount && i < 8; i++) {
      const s = m.spots[i]!;
      const n = f.add(KEY_SPOT + i, K_PANEL, s.u * W - SPOT_SIDE / 2, s.v * H - SPOT_SIDE / 2, SPOT_SIDE, SPOT_SIDE, S_CROSS);
      n.tint = SPOT_INK;
      n.alpha = 0.9;
    }
  },
};
