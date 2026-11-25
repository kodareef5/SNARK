// Map event feeds made by hand, as the server's engine would send them (shared/mapevent/wire.ts): the UFO's look and a
// stand-in's, craft and site rows, and a feed sent to a client the way the server sends S_MAPEVENT, as one blob.

import type { ClientSession } from "../../client/core/session.ts";
import type { ColumnLook, CraftLook } from "../../shared/mapevent/parts.ts";
import { MAPEVENT_BYTES, MAPEVENT_LIVE, writeMapEvents, type CraftRow, type MapEventFeed, type MapEventRow, type SiteRow } from "../../shared/mapevent/wire.ts";
import { BitWriter } from "../../shared/net/codec.ts";
import { S_MAPEVENT } from "../../shared/net/protocol.ts";
import type { PathPoint } from "../../shared/sim/craft.ts";
import type { Harness } from "./net.ts";

/** The UFO as its module would describe it: three pieces turning apart, its wreck, a cyan glow, a beam and smoke. */
export const UFO_LOOK: CraftLook = {
  pieces: [{ mesh: "core:ufo_craft", spin: 0 }, { mesh: "core:ufo_rim", spin: 0.3 }, { mesh: "core:ufo_ring", spin: -5 }],
  fallback: "core:event_disc", wreck: "core:ufo_wreck", glow: 0x40e8ff, broken: 0xf4f8ff, ember: 0x1a5a66,
  beam: { rgb: 0x40e8ff, wide: 28, drop: 2.4 }, smoke: { rgb: 0x6a6660, height: 320, wide: 24 }, lean: 1 / 900, sound: "core:ufo",
};
/** A look whose meshes no pack has: it is drawn as the stand-in disc. */
export const STAND_IN_LOOK: CraftLook = { ...UFO_LOOK, pieces: [{ mesh: "test:no_such_craft", spin: 1 }], fallback: "", wreck: "", sound: "" };
export const SMOKE_COLUMN: ColumnLook = { kind: "smoke", rgb: 0x553311, height: 200, wide: 8, sound: "" };
export const LIGHT_COLUMN: ColumnLook = { kind: "light", rgb: 0xffd040, height: 400, wide: 6, sound: "" };

/** A craft row on `points`, the UFO's hull, flying unhurt; `more` changes any of it. */
export function craftRow(points: PathPoint[], more: Partial<CraftRow> = {}): CraftRow {
  return { type: "craft", id: 1, look: 0, after: 0, radius: 11, half: 3.2, gravity: 7.5, bleed: 30 / 255, points, stage: 0, shieldUntil: 0, down: 0, impact: 0, rx: 0, ry: 0, rz: 0, ...more };
}

export function siteRow(x: number, y: number, z: number, more: Partial<SiteRow> = {}): SiteRow {
  return { type: "site", id: 2, look: 1, x, y, z, from: 0, to: 0, ...more };
}

/** An event of `kind` that came at `start`, called 45 s before. */
export function eventRow(start: number, parts: MapEventRow["parts"], more: Partial<MapEventRow> = {}): MapEventRow {
  return { id: 7, kind: "ufo", sound: "core:ufo", state: MAPEVENT_LIVE, called: Math.max(0, start - 45 * 30), start, ended: 0, parts, ...more };
}

/** A path that hovers nearly still about (x, y, z), there and back over `seconds`, flown low (beam on) or not. */
export function hover(x: number, y: number, z: number, low = false, seconds = 600): PathPoint[] {
  const speed = 1;
  const span = (seconds * speed) / 2;
  return [
    { x, y, z, speed, low },
    { x: x + span / 2, y, z, speed, low },
    { x, y, z: z + 0.5, speed, low },
  ];
}

/** The feed's bytes as the server writes them. */
export function feedBytes(feed: MapEventFeed): Uint8Array {
  const w = new BitWriter(MAPEVENT_BYTES);
  writeMapEvents(w, feed);
  if (w.overflow) throw new Error("the feed is more than MAPEVENT_BYTES");
  return w.bytes();
}

/** Sends `s` the feed as the server sends S_MAPEVENT: the kind, then one blob of the feed's bytes. */
export function tell(h: Harness, s: ClientSession, feed: MapEventFeed): void {
  const c = h.client(s);
  if (!c) throw new Error(`${s.name} is not joined`);
  const w = new BitWriter(MAPEVENT_BYTES);
  writeMapEvents(w, feed);
  h.host.game.begin(S_MAPEVENT).blobOf(w);
  h.host.game.endOwn(c);
}
