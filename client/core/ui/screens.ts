// The respawn screen and the map screen.

import { CMD_RESPAWN, MARKER_DEATH, SESSION_DEAD } from "../../../shared/net/protocol.ts";
import type { HudModel } from "../hud.ts";
import { mapU, mapV } from "../hud.ts";
import type { ClientSession } from "../session.ts";
import { IMAGE_MINIMAP } from "./hud.ts";
import { K_BUTTON, K_IMAGE, K_PANEL, lineHeight, type UiFrame } from "./nodes.ts";
import { S_BUTTON, S_FRAME, S_LABEL, S_MARK_DEATH, S_MARK_SELF, S_PANEL, S_TITLE } from "./style.ts";

export const KEY_RESPAWN_PANEL = 900;
export const KEY_RESPAWN_TITLE = 901;
export const KEY_RESPAWN_BUTTON = 910;
export const KEY_MAP_PANEL = 950;
export const KEY_MAP_IMAGE = 951;
export const KEY_MAP_TITLE = 952;
export const KEY_MAP_PIN = 960;
export const KEY_MAP_LINE = 980;

/** While dead: a list of places to return at. A click sends the choice; the server decides. */
export function buildRespawn(f: UiFrame, session: ClientSession): void {
  if (session.sessionState !== SESSION_DEAD) return;
  const points = session.respawnPoints;
  const w = 280;
  const rowH = 34;
  const h = 56 + points.length * (rowH + 6) + 8;
  const x = Math.round((f.width - w) / 2);
  const y = Math.round(f.height * 0.3);
  f.add(KEY_RESPAWN_PANEL, K_PANEL, x, y, w, h, S_PANEL);
  f.text(KEY_RESPAWN_TITLE, x + 16, y + 14, w - 32, S_TITLE, "Return to life at");
  for (let i = 0; i < points.length && i < 16; i++) {
    const b = f.add(KEY_RESPAWN_BUTTON + i, K_BUTTON, x + 16, y + 52 + i * (rowH + 6), w - 32, rowH, S_BUTTON);
    // A bed someone has just risen from must be waited for.
    b.text = points[i]!.wait > 0 ? `${points[i]!.name}  (in ${points[i]!.wait} s)` : points[i]!.name;
    b.interactive = true;
  }
}

export function respawnClick(key: number, session: ClientSession): boolean {
  const i = key - KEY_RESPAWN_BUTTON;
  if (session.sessionState !== SESSION_DEAD || i < 0 || i >= session.respawnPoints.length) return false;
  session.command(CMD_RESPAWN, (w) => w.u8(i));
  return true;
}

/** The whole map with the survivor on it and a pin where it died, and those places listed by coordinates. */
export function buildMap(f: UiFrame, session: ClientSession, hud: HudModel): void {
  const world = session.world;
  if (!world) return;
  const lh = lineHeight(S_LABEL);
  const deaths = session.markers.filter((m) => m.kind === MARKER_DEATH);
  const listH = (deaths.length + 1) * lh + 8;
  const size = Math.floor(Math.min(f.width - 48, f.height - 100 - listH));
  const x = Math.round((f.width - size) / 2);
  const y = Math.round((f.height - size - listH - 44) / 2);
  f.add(KEY_MAP_PANEL, K_PANEL, x - 12, y - 12, size + 24, size + listH + 60, S_PANEL);
  f.text(KEY_MAP_TITLE, x, y - 4, size, S_TITLE, `Map  ${hud.lat.toFixed(1)} lat  ${hud.lon.toFixed(1)} lon`);
  const top = y + 28;
  f.add(KEY_MAP_IMAGE, K_IMAGE, x, top, size, size, S_FRAME).image = IMAGE_MINIMAP;
  const pin = (key: number, wx: number, wz: number, style: number): void => {
    f.add(key, K_PANEL, x + mapU(world.hf, wx) * size - 4, top + mapV(world.hf, wz) * size - 4, 8, 8, style);
  };
  const now = session.serverTick;
  for (let i = 0; i < deaths.length && i < 16; i++) {
    const m = deaths[i]!;
    pin(KEY_MAP_PIN + i, m.x, m.z, S_MARK_DEATH);
    const minutes = Math.max(0, Math.floor((now - m.tick) / 1800));
    f.text(KEY_MAP_LINE + i, x, top + size + 6 + i * lh, size, S_LABEL, `died  ${(mapV(world.hf, m.z) * 100).toFixed(1)} lat  ${(mapU(world.hf, m.x) * 100).toFixed(1)} lon  ${minutes} min ago`);
  }
  pin(KEY_MAP_PIN + 16, session.own.x, session.own.z, S_MARK_SELF);
}
