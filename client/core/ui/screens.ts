import { MARKER_DEATH } from "../../../shared/net/protocol.ts";
import { latLonText, latOf, lonOf, mapU, mapV, xOfU, zOfV } from "../../../shared/world/coords.ts";
import { MAX_MARKERS, type HudModel } from "../hud.ts";
import type { ClientSession } from "../session.ts";
import { ZOOMS, wholeMap } from "../tactical.ts";
import { IMAGE_ARROW, arrowSheet, placeArrow } from "./arrow.ts";
import { IMAGE_MAP, MARKER_STYLE, MARKER_TINT } from "./hud.ts";
import { K_BUTTON, K_IMAGE, K_PANEL, lineHeight, type UiFrame } from "./nodes.ts";
import type { Screen, ScreenCtx } from "./screen.ts";
import { S_BUTTON, S_FRAME, S_LABEL, S_MARK_DEATH, S_PANEL, S_TITLE } from "./style.ts";

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

/** The map screen as a row of SCREENS. M opens it; its picture and zoom live on the HUD's chart. */
export class MapScreen implements Screen {
  readonly name = "map";
  readonly layer = "modal";
  readonly group = "bag";
  readonly hotkey = "KeyM";
  readonly quiet = true;
  readonly bareHud = true;
  readonly bands = [{ from: KEY_MAP_PANEL, count: KEY_MAP_LINE + 17 - KEY_MAP_PANEL }, { from: KEY_MAP_MARK, count: MAX_MARKERS }];
  open = false;

  isOpen(): boolean {
    return this.open;
  }

  show(): void {
    this.open = true;
  }

  close(): void {
    this.open = false;
  }

  build(f: UiFrame, c: ScreenCtx): void {
    if (c.session && c.hud) buildMap(f, c.session, c.hud);
  }

  pointer(kind: number, key: number, x: number, y: number, _button: number, c: ScreenCtx): boolean {
    return c.hud !== null && mapPointer(c.hud, kind, key, x, y, c.finger);
  }
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
  const view = chart ? chart.full.view : wholeMap(hf);
  let line = "";
  if (chart) {
    // Opened afresh it looks at its reader, or at the middle of the map if the reader may not be shown where it is.
    if (hud.mapSeen < hud.frames - 1) {
      chart.look(session.mapLocation ? mapU(hf, session.own.x) : 0.5, session.mapLocation ? mapV(hf, session.own.z) : 0.5);
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
    line = `zoom ${chart.fullZoom + 1} of ${ZOOMS}   ${hud.pointedU < 0 ? "arrows, - and =, click" : latLonText(latOf(hf.dims, zOfV(hf, hud.pointedV)), lonOf(hf.dims, xOfU(hf, hud.pointedU)))}`;
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
    if (k.kind !== "creature" && k.kind !== "death" && k.kind !== "self" && k.kind !== "dropPip") pin(KEY_MAP_MARK + i, k.u, k.v, k.kind === "drop" ? 4 : 3, MARKER_STYLE[k.kind], (k.tint ?? -1) >= 0 ? k.tint : MARKER_TINT[k.kind]);
  }
  const now = session.serverTick;
  for (let i = 0; i < deaths.length && i < 16; i++) {
    const m = deaths[i]!;
    pin(KEY_MAP_PIN + i, mapU(hf, m.x), mapV(hf, m.z), 4, S_MARK_DEATH);
    const minutes = Math.max(0, Math.floor((now - m.tick) / 1800));
    f.text(KEY_MAP_LINE + i, x, top + size + 6 + i * lh, size, S_LABEL, `died  ${latLonText(latOf(hf.dims, m.z), lonOf(hf.dims, m.x))}  ${minutes} min ago`);
  }
  if (line !== "") f.text(KEY_MAP_LINE + 16, x, top + size + 6 + Math.min(deaths.length, 16) * lh, size, S_LABEL, line);
  // A server rule can hide the reader's own position.
  // An arrow the way the reader faces.
  if (session.mapLocation !== false) {
    const px = (mapU(hf, session.own.x) - view.u0) / view.du, py = (mapV(hf, session.own.z) - view.v0) / view.dv;
    f.images[IMAGE_ARROW] ??= arrowSheet();
    if (px >= 0 && px <= 1 && py >= 0 && py <= 1) placeArrow(f.add(KEY_MAP_PIN + 16, K_IMAGE, x + px * size - MAP_ARROW / 2, top + py * size - MAP_ARROW / 2, MAP_ARROW, MAP_ARROW, S_FRAME), hud.dial.heading);
  }
}

/** The reader's arrow on the map screen, in units. */
const MAP_ARROW = 30;

/** The fingers on the map: the one that drags it, where it was last and whether it has moved, and a second that pinches with it. */
const held = { first: 0, x: 0, y: 0, moved: false, second: 0, x2: 0, y2: 0, apart: 0 };
/** How far two fingers part, or close, for one step of the map's zoom, as a share of where they began. */
const PINCH = 1.35;

/**
 * A click on the map looks there, and its two buttons zoom. A finger (`finger` above 0) drags the map under it, looks
 * where it taps, and with a second finger pinches the zoom a step at a time. The place pointed at, or the nearest place
 * on the map to it, is kept for the line under the map. Returns true if the map used the event.
 */
export function mapPointer(hud: HudModel, kind: number, key: number, x: number, y: number, finger = 0): boolean {
  const chart = hud.chart;
  if (!chart || key < KEY_MAP_IMAGE || key > KEY_MAP_ZOOM + 1 || key === KEY_MAP_TITLE) return false;
  if (key !== KEY_MAP_IMAGE) {
    if (kind === 0) chart.zoomFull(key === KEY_MAP_ZOOM ? -1 : 1);
    return true;
  }
  const view = chart.full.view;
  hud.pointedU = Math.max(0, Math.min(1, view.u0 + ((x - hud.mapBox.x) / hud.mapBox.size) * view.du));
  hud.pointedV = Math.max(0, Math.min(1, view.v0 + ((y - hud.mapBox.y) / hud.mapBox.size) * view.dv));
  if (finger === 0) {
    if (kind === 0) chart.look(hud.pointedU, hud.pointedV);
    return true;
  }
  if (kind === 0) {
    if (held.first === 0) { held.first = finger; held.x = x; held.y = y; held.moved = false; }
    else if (held.second === 0 && finger !== held.first) { held.second = finger; held.x2 = x; held.y2 = y; held.apart = Math.hypot(x - held.x, y - held.y); held.moved = true; }
  } else if (kind === 2) {
    if (finger === held.second) { held.x2 = x; held.y2 = y; }
    else if (finger !== held.first) return true;
    else if (held.second === 0) {
      // One finger: the map goes with it.
      if (Math.hypot(x - held.x, y - held.y) > 3) held.moved = true;
      if (held.moved) chart.look(Math.max(0, Math.min(1, chart.fullU - ((x - held.x) / hud.mapBox.size) * view.du)), Math.max(0, Math.min(1, chart.fullV - ((y - held.y) / hud.mapBox.size) * view.dv)));
      if (held.moved) { held.x = x; held.y = y; }
    } else { held.x = x; held.y = y; }
    if (held.second !== 0 && held.apart > 0) {
      const now = Math.hypot(held.x2 - held.x, held.y2 - held.y);
      if (now >= held.apart * PINCH || now <= held.apart / PINCH) { chart.zoomFull(now > held.apart ? 1 : -1); held.apart = now; }
    }
  } else if (finger === held.second) held.second = 0;
  else if (finger === held.first) {
    // A tap looks where it landed; a drag has already taken the map there.
    if (!held.moved) chart.look(hud.pointedU, hud.pointedV);
    held.first = held.second = 0;
  }
  return true;
}
