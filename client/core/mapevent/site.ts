// A site as the client draws it: a column of smoke or of light standing on the ground where it is, from the tick it
// shows to the tick it goes, or while its event lasts and a little after, thinning. One draw, the stand-in cone.

import { TICK_RATE } from "../../../shared/coords.ts";
import { DRAW_BLEND, DRAW_EMISSIVE } from "../render/packet.ts";
import type { EventKit } from "../render/passes/map-events.ts";
import { SMOKE_FADE } from "./craft.ts";
import type { ShownSite } from "./shown.ts";

/** Seconds a column takes to rise and to go. */
const RISE = 2;
/** The share of its distance a column's radius never falls under: about three pixels across. */
const COLUMN_FLOOR = 0.002;

/** How much of a site's column stands at `tick`, 0 to 1. */
export function columnLeft(s: ShownSite, tick: number): number {
  const row = s.row;
  if (tick < row.from) return 0;
  let left = Math.min(1, (tick - row.from) / (RISE * TICK_RATE));
  if (row.to > 0) left = Math.min(left, (row.to - tick) / (RISE * TICK_RATE));
  else if (s.event.ended > 0) left = Math.min(left, 1 - (tick - s.event.ended) / (SMOKE_FADE * TICK_RATE));
  return left > 0 ? left : 0;
}

export function wantSite(k: EventKit, s: ShownSite, tick: number): void {
  if (s.row.to > 0 && tick >= s.row.to) return;
  const cam = k.f.cam, row = s.row;
  k.wantCoarsest(k.cone, Math.sqrt((row.x - cam.x) * (row.x - cam.x) + (row.y - cam.y) * (row.y - cam.y) + (row.z - cam.z) * (row.z - cam.z)));
}

export function drawSite(k: EventKit, s: ShownSite, tick: number): void {
  const left = columnLeft(s, tick);
  if (left <= 0.02) return;
  const cam = k.f.cam, row = s.row, look = s.look;
  const x = row.x - cam.x, y = row.y - cam.y, z = row.z - cam.z;
  const far = Math.sqrt(x * x + y * y + z * z);
  const wide = Math.max(look.wide, far * COLUMN_FLOOR) * (0.6 + 0.4 * left);
  const tall = look.height * (0.5 + 0.5 * left);
  // A column's width is the radius of its top; smoke is thinner than light.
  const fade = (look.kind === "light" ? 0.3 : 0.4) + 0.6 * (1 - left);
  const light = look.kind === "light";
  k.turn(0, 1, 0, 0);
  if (light) k.glow(tick / TICK_RATE, look.rgb, left);
  if (k.put(k.cone, x, y, z, wide, tall, Math.max(wide, tall * 0.5), 0.5, k.tint(look.rgb), DRAW_BLEND | (light ? DRAW_EMISSIVE : 0), fade)) k.columns++;
  if (light) k.glow(0, 0, 0);
}
