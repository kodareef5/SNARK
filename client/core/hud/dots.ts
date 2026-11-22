// Laser dots on the screen (client/core/render/laser.ts): the own laser's and those of bodies whose laser is on, each
// where the world or a body first meets its beam, and only where the camera sees that spot (weapons-plan.md, M10).

import { handleIndex } from "../../../shared/ids.ts";
import { PI, TAU } from "../../../shared/math/scalar.ts";
import { HIT_NONE, castWorld, lookDirection } from "../../../shared/world/ray.ts";
import { MAX_DOTS, daylight } from "../render/laser.ts";
import { K_PANEL } from "../ui/nodes.ts";
import { S_CROSS } from "../ui/style.ts";
import type { HudWidget } from "./widget.ts";

/** One mark per laser dot, MAX_DOTS at most. */
export const KEY_DOT = 5010;
/** A laser's dot and its size, in canvas units. */
const LASER_RED = 0xff2a22;
const DOT = 4;

export interface DotsModel {
  /** As fractions of the screen. Only the first `dotCount` are current. */
  dots: { u: number; v: number; alpha: number }[];
  dotCount: number;
}

const way = [0, 0, 0];
const spot = [0, 0, 0];

/** Laser dots lie on the world, so under everything else. */
export const DOTS: HudWidget<DotsModel> = {
  name: "laser dots",
  make: () => ({ dots: [], dotCount: 0 }),
  fill(m, c) {
    const f = c.frame;
    if (!f) return;
    const { lasers, world, cam, reg, sightAt: at } = f;
    const session = c.session, r = c.remote, d = way, s = spot;
    const day = daylight(m.hour);
    lookDirection((at.yaw / TAU) * 65536, (at.pitch / (PI / 2)) * 16384, d);
    lasers.clear();
    if (at.laser) lasers.cast(reg, world, r, at.x, at.y, at.z, d[0]!, d[1]!, d[2]!, day, 0, handleIndex(session.ownHandle), f.seatedAim, session.own.seat - 1, session.own.seatGen);
    lasers.remotes(reg, world, r, day, f.seatedAim);
    let n = 0;
    for (let i = 0; i < lasers.count; i++) {
      const dot = lasers.dots[i]!;
      const dx = dot.x - cam.x;
      const dy = dot.y - cam.y;
      const dz = dot.z - cam.z;
      const far = Math.sqrt(dx * dx + dy * dy + dz * dz);
      // A dot behind something the camera sees first is not drawn.
      if (far > 0.05 && castWorld(world, cam.x, cam.y, cam.z, dx / far, dy / far, dz / far, far - 0.05) !== HIT_NONE) continue;
      if (!cam.project(dot.x, dot.y, dot.z, s)) continue;
      const out = (m.dots[n++] ??= { u: 0, v: 0, alpha: 0 });
      out.u = s[0]!;
      out.v = s[1]!;
      out.alpha = dot.alpha;
    }
    m.dotCount = n;
  },
  build(f, m, at) {
    const { W, H } = at;
    for (let i = 0; i < m.dotCount && i < MAX_DOTS; i++) {
      const d = m.dots[i]!;
      if (d.u < 0 || d.u > 1 || d.v < 0 || d.v > 1 || !(d.alpha > 0.02)) continue;
      const n = f.add(KEY_DOT + i, K_PANEL, d.u * W - DOT / 2, d.v * H - DOT / 2, DOT, DOT, S_CROSS);
      n.tint = LASER_RED;
      n.alpha = d.alpha;
    }
  },
};
