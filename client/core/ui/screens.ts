import { CMD_RESPAWN, MARKER_DEATH, SESSION_DEAD } from "../../../shared/net/protocol.ts";
import { latLonText, latOf, lonOf } from "../../../shared/world/coords.ts";
import { MAX_MARKERS, type HudModel } from "../hud.ts";
import type { ClientSession } from "../session.ts";
import { WHOLE_MAP, ZOOMS } from "../tactical.ts";
import { IMAGE_MAP, MARKER_STYLE, MARKER_TINT } from "./hud.ts";
import { K_BUTTON, K_IMAGE, K_PANEL, lineHeight, type UiFrame } from "./nodes.ts";
import { S_BUTTON, S_FRAME, S_LABEL, S_MARK_DEATH, S_MARK_SELF, S_PANEL, S_TITLE } from "./style.ts";

export const KEY_RESPAWN_PANEL = 900;
export const KEY_RESPAWN_TITLE = 901;
export const KEY_RESPAWN_BUTTON = 910;
export const KEY_MAP_PANEL = 950;
export const KEY_MAP_IMAGE = 951;
export const KEY_MAP_TITLE = 952;
/** The button that zooms out, then the one that zooms in. */
export const KEY_MAP_ZOOM = 953;
export const KEY_MAP_PIN = 960;
/** A line for each death, then one that says the zoom and the place pointed at. */
export const KEY_MAP_LINE = 980;
/** One mark for each marker but deaths and the reader, which have pins. */
export const KEY_MAP_MARK = 4300;
/** The most pixels a side the map screen's picture is made at. */
const MAP_PIXELS = 1024;

/** Shown while dead. A click sends the choice, and the server decides. */
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
    // A bed that someone has just risen from has a wait.
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

/** The map screen: a window on the map at one of its zooms, moved by the arrows or a click and zoomed by Minus and Equal or its buttons. */
export function buildMap(f: UiFrame, session: ClientSession, hud: HudModel): void {
  const world = session.world;
  if (!world) return;
  const hf = world.hf;
  const lh = lineHeight(S_LABEL);
  const deaths = session.markers.filter((m) => m.kind === MARKER_DEATH);
  const listH = (deaths.length + 1) * lh + 8;
  const size = Math.floor(Math.min(f.width - 48, f.height - 100 - listH));
  const x = Math.round((f.width - size) / 2);
  const y = Math.round((f.height - size - listH - 44) / 2);
  const top = y + 28;
  f.add(KEY_MAP_PANEL, K_PANEL, x - 12, y - 12, size + 24, size + listH + 60, S_PANEL);
  f.text(KEY_MAP_TITLE, x, y - 4, size - 60, S_TITLE, `Map  ${latLonText(hud.lat, hud.lon)}`);
  const picture = f.add(KEY_MAP_IMAGE, K_IMAGE, x, top, size, size, S_FRAME);
  picture.image = IMAGE_MAP;
  const chart = hud.chart;
  const view = chart ? chart.full.view : WHOLE_MAP;
  let line = "";
  if (chart) {
    // Opened afresh it looks at its reader, or at the middle of the map if the reader may not be shown where it is.
    if (hud.mapSeen < hud.frames - 1) {
      chart.look(session.mapLocation ? hud.lon / 100 : 0.5, session.mapLocation ? hud.lat / 100 : 0.5);
      hud.pointedU = -1;
    }
    hud.mapSeen = hud.frames;
    chart.drawFull(session.tactical, session.tribe.team, Math.min(MAP_PIXELS, Math.round(size * hud.scale)));
    hud.mapBox.x = x;
    hud.mapBox.y = top;
    hud.mapBox.size = size;
    picture.interactive = true;
    for (let i = 0; i < 2; i++) {
      const b = f.add(KEY_MAP_ZOOM + i, K_BUTTON, x + size - 54 + i * 28, y - 8, 26, 24, S_BUTTON);
      b.text = i === 0 ? "-" : "+";
      b.interactive = true;
    }
    line = `zoom ${chart.fullZoom + 1} of ${ZOOMS}   ${hud.pointedU < 0 ? "arrows, - and =, click" : latLonText(hud.pointedV * 100, hud.pointedU * 100)}`;
  }
  /** A mark `half` wide each way at a place on the map, if the window shows it. */
  const pin = (key: number, u: number, v: number, half: number, style: number, tint = -1): void => {
    const px = (u - view.u0) / view.du;
    const py = (v - view.v0) / view.dv;
    if (px >= 0 && px <= 1 && py >= 0 && py <= 1) f.add(key, K_PANEL, x + px * size - half, top + py * size - half, half * 2, half * 2, style).tint = tint;
  };
  // Creatures in view belong to the minimap. The most important marker is drawn last, so it is on top.
  for (let i = Math.min(hud.markers.length, MAX_MARKERS) - 1; i >= 0; i--) {
    const k = hud.markers[i]!;
    if (k.kind !== "creature" && k.kind !== "death" && k.kind !== "self") pin(KEY_MAP_MARK + i, k.u, k.v, 3, MARKER_STYLE[k.kind], MARKER_TINT[k.kind]);
  }
  const now = session.serverTick;
  for (let i = 0; i < deaths.length && i < 16; i++) {
    const m = deaths[i]!;
    pin(KEY_MAP_PIN + i, lonOf(hf, m.x) / 100, latOf(hf, m.z) / 100, 4, S_MARK_DEATH);
    const minutes = Math.max(0, Math.floor((now - m.tick) / 1800));
    f.text(KEY_MAP_LINE + i, x, top + size + 6 + i * lh, size, S_LABEL, `died  ${latLonText(latOf(hf, m.z), lonOf(hf, m.x))}  ${minutes} min ago`);
  }
  if (line !== "") f.text(KEY_MAP_LINE + 16, x, top + size + 6 + Math.min(deaths.length, 16) * lh, size, S_LABEL, line);
  // A server rule can hide the reader's own position.
  if (session.mapLocation !== false) pin(KEY_MAP_PIN + 16, lonOf(hf, session.own.x) / 100, latOf(hf, session.own.z) / 100, 4, S_MARK_SELF);
}

/** A click on the map looks there, and its two buttons zoom. The place pointed at is kept for the line under the map. Returns true if the map used the event. */
export function mapPointer(hud: HudModel, kind: number, key: number, x: number, y: number): boolean {
  const chart = hud.chart;
  if (!chart || key < KEY_MAP_IMAGE || key > KEY_MAP_ZOOM + 1 || key === KEY_MAP_TITLE) return false;
  if (key !== KEY_MAP_IMAGE) {
    if (kind === 0) chart.zoomFull(key === KEY_MAP_ZOOM ? -1 : 1);
    return true;
  }
  const view = chart.full.view;
  hud.pointedU = view.u0 + ((x - hud.mapBox.x) / hud.mapBox.size) * view.du;
  hud.pointedV = view.v0 + ((y - hud.mapBox.y) / hud.mapBox.size) * view.dv;
  if (kind === 0) chart.look(hud.pointedU, hud.pointedV);
  return true;
}
