// What the session says of the body and where it is: the widgets after this one read it. It draws the dark panel over
// the world of a body knocked out, and, last of all, the status line and the banner (WORDS).

import { CHOOSE_DIED, SESSION_ALIVE, SESSION_DEAD, SESSION_SPECTATING } from "../../../shared/net/protocol.ts";
import { MF_OUT } from "../../../shared/sim/character.ts";
import { latOf, lonOf } from "../../../shared/world/coords.ts";
import { K_PANEL, lineHeight } from "../ui/nodes.ts";
import { S_BANNER, S_DARK, S_TEXT } from "../ui/style.ts";
import type { HudWidget } from "./widget.ts";

/** The dark panel over the world while unconscious. */
export const KEY_OUT = 36;
export const KEY_STATUS = 31;
export const KEY_BANNER = 32;

export interface StateModel {
  /** Counts updates. */
  frames: number;
  /** Screen pixels to a unit of the interface, so the map's pictures are made at the size they are shown. */
  scale: number;
  /** Device pixels to a CSS pixel, for a picture painted at the size it is shown. */
  dpr: number;
  /** Hours since midnight as the sky shows them (client/core/sky.ts), set by the app each frame. */
  hour: number;
  lat: number;
  lon: number;
  x: number;
  y: number;
  z: number;
  /** Degrees clockwise from north, and its point of the compass. */
  heading: number;
  compass: string;
  /** The map's size in metres, east to west and north to south, for bearings between places on it. */
  mapSizeX: number;
  mapSizeZ: number;
  speed: number;
  /** The body is unconscious. */
  out: boolean;
  /** Connection state, or "". */
  status: string;
  /** A word across the top such as "SPECTATING" or "DEAD", or "". */
  banner: string;
  /** The rules and the body's state let a crosshair show. */
  crosshair: boolean;
  /** The map screen or the choice of where to rise covers the HUD: no compass. */
  bare: boolean;
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export function headingOf(yaw: number): number {
  const deg = (-yaw * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

export const STATE: HudWidget<StateModel> = {
  name: "state",
  make: () => ({ frames: 0, scale: 1, dpr: 1, hour: 12, lat: 0, lon: 0, x: 0, y: 0, z: 0, heading: 0, compass: "N", mapSizeX: 1, mapSizeZ: 1, speed: 0, out: false, status: "", banner: "", crosshair: true, bare: false }),
  fill(m, c) {
    const session = c.session, b = session.own, hf = session.world!.hf;
    m.frames++;
    m.scale = c.scale;
    m.x = b.x;
    m.y = b.y;
    m.z = b.z;
    m.lon = lonOf(hf.dims, b.x);
    m.lat = latOf(hf.dims, b.z);
    m.heading = headingOf(session.ownYaw);
    m.compass = COMPASS[Math.round(m.heading / 45) % 8]!;
    m.mapSizeX = hf.sizeX;
    m.mapSizeZ = hf.sizeZ;
    m.speed = Math.hypot(b.vx, b.vz);
    m.out = session.sessionState === SESSION_ALIVE && (b.mflags & MF_OUT) !== 0;
    m.banner = session.sessionState === SESSION_SPECTATING ? "SPECTATING" : session.sessionState === SESSION_DEAD ? (session.choosing === CHOOSE_DIED ? "DEAD" : "") : m.out ? "UNCONSCIOUS" : "";
    m.crosshair = m.banner === "" && session.crosshair;
  },
  // The dark panel goes first, under everything else.
  build(f, m, at) {
    if (m.out) f.add(KEY_OUT, K_PANEL, 0, 0, at.W, at.H, S_DARK).alpha = 0.82;
  },
};

/** The status line and the banner, over the rest. */
export const WORDS: HudWidget = {
  name: "words",
  build(f, m, at) {
    const { W, H, left, right } = at;
    if (m.status !== "") f.text(KEY_STATUS, left, H / 2 - 100, right - left, S_TEXT, m.status.slice(0, Math.floor((right - left) / 7.8)));
    if (m.banner !== "") {
      const bw = 240;
      const n = f.add(KEY_BANNER, K_PANEL, W / 2 - bw / 2, 56, bw, lineHeight(S_BANNER) + 8, S_BANNER);
      n.text = m.banner;
    }
  },
};
