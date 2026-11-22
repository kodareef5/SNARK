// The compass: a heading tape at the top of the screen, in the middle. Ticks and letters slide by as the view turns, and the
// heading they show follows the true one on a light spring, so a quick turn swings a degree or two past and settles, as a
// needle in oil does; N brightens a moment as it crosses the mark. Friends, tames, a body and the places to rise show as pips
// at their bearings, pinned to the nearer end when behind. Nothing here rotates: the tape is panels and text that move
// sideways. The degrees show while H is held, as the HUD's other numbers do (planning/reference/ui-hud-art-direction.md).

import type { HudModel, MarkerKind } from "../hud.ts";
import { K_PANEL, type UiFrame } from "./nodes.ts";
import { S_COMPASS, S_COMPASS_NORTH, S_CROSS, S_DARK, S_MARK_DEATH, S_MARK_SELF, S_MARK_SPAWN } from "./style.ts";

/** The tape's nodes: its ticks and their shadows, letters, pips, the mark, the degrees. */
export const KEY_COMPASS = 6600;
const KEY_TICK = KEY_COMPASS;
const KEY_LETTER = KEY_COMPASS + 60;
const KEY_PIP = KEY_COMPASS + 80;
const KEY_CARET = KEY_COMPASS + 98;
const KEY_DEGREES = KEY_COMPASS + 99;
const MAX_PIPS = 16;

/** The spring the shown heading rides: its natural rate (per second) and damping, a little under critical. */
const OMEGA = 16;
const ZETA = 0.78;
/** A turn larger than this at once (rising, a teleport) is jumped, not swung through. */
const SNAP = 120;
/** How long N stays bright after crossing the mark, in ms. */
const GLOW_MS = 400;

const LETTERS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
/** Pale ice for the ticks; their shadow keeps them read over snow and sky. */
const ICE = 0xc9e7f3;
const WARM = 0xf2a477;

/** Degrees from `a` to `b` the short way round, in (-180, 180]. */
export function turnTo(a: number, b: number): number {
  const d = (((b - a) % 360) + 540) % 360 - 180;
  return d === -180 ? 180 : d;
}

/** The heading the compass shows. `shown` is unwrapped, so its crossings of north can be counted. */
export class Compass {
  shown = 0;
  rate = 0;
  /** The time of the last step, and of the last crossing of north (ms). */
  now = 0;
  northAt = -Infinity;
  private started = false;

  /** Degrees clockwise from north, 0 to 360. */
  get heading(): number {
    return ((this.shown % 360) + 360) % 360;
  }

  /** Shows `heading` at once. */
  set(heading: number, nowMs = this.now): void {
    this.shown += turnTo(this.shown, heading);
    this.rate = 0;
    this.now = nowMs;
    this.started = true;
  }

  /** Follows `heading` (degrees clockwise from north) to the time `nowMs`. */
  step(heading: number, nowMs: number): void {
    const off = turnTo(this.shown, heading);
    if (!this.started || Math.abs(off) > SNAP) return this.set(heading, nowMs);
    let dt = Math.min(0.1, Math.max(0, (nowMs - this.now) / 1000));
    this.now = nowMs;
    const before = this.shown;
    // Small fixed steps, so a slow frame does not make the spring ring.
    while (dt > 1e-6) {
      const h = Math.min(dt, 1 / 240);
      const pull = turnTo(this.shown, heading);
      this.rate += (OMEGA * OMEGA * pull - 2 * ZETA * OMEGA * this.rate) * h;
      this.shown += this.rate * h;
      dt -= h;
    }
    if (Math.floor(before / 360) !== Math.floor(this.shown / 360)) this.northAt = nowMs;
  }
}

/** A pip's colour by the marker's kind; kinds not shown on the tape are absent. */
const PIP: Partial<Record<MarkerKind, { style: number; tint: number }>> = {
  mate: { style: S_MARK_SELF, tint: 0x6fd0ff },
  tame: { style: S_MARK_SELF, tint: 0xe8d24a },
  death: { style: S_MARK_DEATH, tint: -1 },
  spawn: { style: S_MARK_SPAWN, tint: -1 },
  // A supply drop's pip is its tier's colour, which the marker carries.
  drop: { style: S_MARK_SELF, tint: 0xffffff },
  dropPip: { style: S_MARK_SELF, tint: 0xffffff },
};

/** Bearing in degrees clockwise from north from the map place (u0, v0) to (u, v), on a map `sizeX` by `sizeZ` metres. */
export function bearingOf(u0: number, v0: number, u: number, v: number, sizeX: number, sizeZ: number): number {
  // u runs east and v south across the map's picture.
  const east = (u - u0) * sizeX, north = (v0 - v) * sizeZ;
  return ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
}

/** Where the tape stands: its middle and top, its width, and the degrees either side of the middle it shows. */
export interface TapeLayout {
  x: number;
  y: number;
  width: number;
  span: number;
}

export const TAPE_HEIGHT = 18;

/**
 * The tape for this canvas, in the middle of the room between `from` and `to` (what holds the top's corners: a finger's
 * bar, the minimap), or null where there is not room for it.
 */
export function tapeLayout(f: UiFrame, from: number, to: number): TapeLayout | null {
  const narrow = f.width < 640;
  const width = narrow ? 150 : 220;
  const left = from + 8, right = to - 8;
  if (right - left < width) return null;
  const x = Math.max(left + width / 2, Math.min(right - width / 2, f.width / 2));
  return { x, y: f.top + 6, width, span: narrow ? 45 : 60 };
}

/** Builds the tape into `f`. `degrees` shows the number under the mark. */
export function buildCompass(f: UiFrame, m: HudModel, at: TapeLayout, degrees: boolean): void {
  const c = m.dial;
  const h = c.heading;
  const scale = at.width / 2 / at.span;
  const fade = (d: number): number => Math.max(0, 1 - (d / at.span) * (d / at.span));
  let k = KEY_TICK;
  // Every 15 degrees in sight: a short tick, a tall one at each quarter, and a letter at each eighth.
  const first = Math.ceil((h - at.span) / 15) * 15;
  let letters = 0;
  for (let deg = first; deg <= h + at.span && k < KEY_LETTER - 1; deg += 15) {
    const d = deg - h;
    const a = fade(d);
    if (a <= 0.02) continue;
    const x = at.x + d * scale;
    const at360 = ((deg % 360) + 360) % 360;
    const major = at360 % 90 === 0;
    const eighth = at360 % 45 === 0;
    const th = major ? 7 : 4, tw = major ? 2 : 1;
    const shade = f.add(k++, K_PANEL, x - tw / 2 + 1, at.y + TAPE_HEIGHT - th + 1, tw, th, S_DARK);
    shade.alpha = a * 0.5;
    const tick = f.add(k++, K_PANEL, x - tw / 2, at.y + TAPE_HEIGHT - th, tw, th, S_CROSS);
    tick.tint = at360 === 0 ? WARM : ICE;
    tick.alpha = a * (major ? 0.95 : 0.6);
    if (eighth && letters < 12) {
      const north = at360 === 0;
      const glow = north ? Math.max(0, 1 - (c.now - c.northAt) / GLOW_MS) : 0;
      const n = f.text(KEY_LETTER + letters++, x - 15, at.y - 2, 30, north ? S_COMPASS_NORTH : S_COMPASS, LETTERS[at360 / 45]!);
      n.alpha = Math.min(1, a * (major ? 1 : 0.7) + glow * 0.6);
    }
  }
  // Pips at the bearings of what matters, from where the reader stands; none where a rule hides that.
  const self = m.markers[0];
  if (self?.kind === "self") {
    let pips = 0;
    for (let i = 1; i < m.markers.length && pips < MAX_PIPS; i++) {
      const mk = m.markers[i]!;
      const look = PIP[mk.kind];
      if (!look || (mk.u === self.u && mk.v === self.v)) continue;
      const d = turnTo(h, bearingOf(self.u, self.v, mk.u, mk.v, m.mapSizeX, m.mapSizeZ));
      const behind = Math.abs(d) > at.span;
      const x = at.x + Math.max(-at.span, Math.min(at.span, d)) * scale;
      const p = f.add(KEY_PIP + pips++, K_PANEL, x - 2, at.y + TAPE_HEIGHT + 2, 4, 4, look.style);
      p.tint = (mk.tint ?? -1) >= 0 ? mk.tint! : look.tint;
      p.alpha = behind ? 0.45 : 0.95;
    }
  }
  // The mark at the middle, under the tape, and the heading under it while asked for.
  const caret = f.add(KEY_CARET, K_PANEL, at.x - 1, at.y + TAPE_HEIGHT + 1, 2, 5, S_CROSS);
  caret.tint = ICE;
  if (degrees) f.text(KEY_DEGREES, at.x - 20, at.y + TAPE_HEIGHT + 6, 40, S_COMPASS, String(Math.round(h) % 360).padStart(3, "0"));
}
