// The crosshair and the held weapon's cone about it. The app's sight says whether it shows (hud/sight.ts SightShown);
// what a holo-scope's is on, which colours it, is found here.

import { handleIndex } from "../../../shared/ids.ts";
import { PI, TAU } from "../../../shared/math/scalar.ts";
import { HIT_NONE, HIT_STRUCTURE, castWorld, lookDirection, rayBox, rayHit } from "../../../shared/world/ray.ts";
import { K_PANEL } from "../ui/nodes.ts";
import { S_CROSS } from "../ui/style.ts";
import type { HudFill, HudFrame, HudWidget } from "./widget.ts";

export const KEY_CROSS = 30;
/** Four strokes about the crosshair at the held weapon's cone. */
export const KEY_CONE = 24;
/** The cone's strokes: their length, and how near the dot they come, in canvas units. */
const CONE_STROKE = 6;
const CONE_MIN = 5;

export interface CrosshairModel {
  /** The orbit camera is in use: the middle of the screen is not where the body aims, so no crosshair is drawn there. */
  orbit: boolean;
  /** The view is from behind a body on foot: a shot goes along the eye's line, not through the middle of the screen, so no crosshair is drawn. */
  behind: boolean;
  /**
   * The held weapon's cone about the crosshair, as a share of half the view's height (the tangent of the cone over that of
   * half the field of view), or -1 for nothing held that has one.
   */
  cone: number;
  /**
   * The view of a holo-scope fitted: its crosshair shows even unaimed and even where the rules hide the crosshair,
   * coloured by what it is on (`crossTint`, 0xRRGGBB, or -1 for the crosshair's own colour).
   */
  holo: boolean;
  crossTint: number;
}

/** Metres a holo-scope's crosshair finds what it is on, and its colours (Holo-Scope Attachment). */
const HOLO_REACH = 300;
const HOLO_FRIEND = 0x48e05a;
const HOLO_FOE = 0xff3a30;
const HOLO_OTHER = 0xf2d23a;
const way = [0, 0, 0];

/**
 * What a holo-scope's crosshair is on, as its colour: "a yellow crosshair for wild animals or structures from another
 * tribe, a red crosshair for untamed animals or players from other tribes and a green one for tamed animals, structures
 * and players from the same tribe" (Holo-Scope Attachment). The page has wild animals both yellow and red; here wild
 * creatures and another tribe's structures are yellow, another tribe's survivors and tames red, and the tribe's own green.
 * -1 for nothing in reach.
 */
function holoTint(c: HudFill, f: HudFrame): number {
  const eye = f.sightAt, session = c.session, reg = f.reg, world = f.world, r = c.remote, d = way;
  lookDirection((eye.yaw / TAU) * 65536, (eye.pitch / (PI / 2)) * 16384, d);
  const team = session.tribe.team;
  let t = castWorld(world, eye.x, eye.y, eye.z, d[0]!, d[1]!, d[2]!, HOLO_REACH) === HIT_NONE ? Infinity : rayHit.t;
  let tint = -1;
  if (t < Infinity && rayHit.kind === HIT_STRUCTURE) {
    const ref = rayHit.ref;
    const owner = world.structs.chunks[Math.floor(ref / 65536)]!.owner[ref & 0xffff]!;
    if (owner !== 0) tint = team !== 0 && owner === team ? HOLO_FRIEND : HOLO_OTHER;
  }
  for (let i = 0; i < r.count; i++) {
    const kind = r.kind[i]!;
    const rad = reg.bodyRadius[kind]!;
    if (reg.move[kind] === null || !(rad > 0) || r.id[i] === session.driving || r.id[i] === handleIndex(session.ownHandle) || (r.id[i] === session.own.seat - 1 && r.gen[i] === session.own.seatGen)) continue;
    const posed = f.seatedAim.ray(r, i, eye.x, eye.y, eye.z, d[0]!, d[1]!, d[2]!, t);
    const hit = posed ?? rayBox(eye.x, eye.y, eye.z, d[0]!, d[1]!, d[2]!, r.x[i]! - rad, r.y[i]!, r.z[i]! - rad, r.x[i]! + rad, r.y[i]! + reg.bodyHeight[kind]!, r.z[i]! + rad);
    if (!(hit > 0 && hit < t)) continue;
    t = hit;
    const mine = team !== 0 && r.team[i] === team;
    tint = mine ? HOLO_FRIEND : r.team[i] === 0 ? HOLO_OTHER : HOLO_FOE;
  }
  return tint;
}

export const CROSSHAIR: HudWidget<CrosshairModel> = {
  name: "crosshair",
  make: () => ({ orbit: false, behind: false, cone: -1, holo: false, crossTint: -1 }),
  fill(m, c) {
    const f = c.frame;
    if (!f) return;
    const s = f.sight;
    m.orbit = s.orbit; m.behind = s.behind; m.cone = s.cone; m.holo = s.holo;
    m.crossTint = f.alive && s.holo ? holoTint(c, f) : -1;
  },
  build(f, m, at) {
    const { W, H } = at;
    // Through a scope its reticle (built under the rest) stands in for the crosshair. A holo-scope's crosshair shows whatever
    // the rules say of the crosshair, coloured by what it is on.
    if (!m.orbit && !m.behind && !((m.scope || m.visor) && m.banner === "") && (m.crosshair || (m.holo && m.banner === ""))) {
      const cross = f.add(KEY_CROSS, K_PANEL, W / 2 - 2, H / 2 - 2, 4, 4, S_CROSS);
      if (m.holo) cross.tint = m.crossTint;
      if (m.cone >= 0) {
        // The strokes stand where the cone's edge is on the screen, and never on the dot.
        const r = Math.min(H / 2 - CONE_STROKE, Math.max(CONE_MIN, (m.cone * H) / 2));
        f.add(KEY_CONE, K_PANEL, W / 2 - 1, H / 2 - r - CONE_STROKE, 2, CONE_STROKE, S_CROSS);
        f.add(KEY_CONE + 1, K_PANEL, W / 2 - 1, H / 2 + r, 2, CONE_STROKE, S_CROSS);
        f.add(KEY_CONE + 2, K_PANEL, W / 2 - r - CONE_STROKE, H / 2 - 1, CONE_STROKE, 2, S_CROSS);
        f.add(KEY_CONE + 3, K_PANEL, W / 2 + r, H / 2 - 1, CONE_STROKE, 2, S_CROSS);
      }
    }
  },
};
