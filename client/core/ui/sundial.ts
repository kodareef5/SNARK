// The Creative screen's sundial: a dial of the day on which an admin turns the sun, and the world's time of day with it.
// Noon is at the top and midnight at the foot, and each hour sits as far round as the ticks it takes on this server's clock,
// so a quick day takes less of the dial than a slow night (shared/sim/clock.ts). The face is painted here for each clock and size;
// the sun, the numerals and the time are nodes over it. A turn reaches the server as CMD_CLOCK at most every SEND_TICKS.

import { TICK_RATE } from "../../../shared/coords.ts";
import { CMD_CLOCK } from "../../../shared/net/protocol.ts";
import { SUNRISE, SUNSET, cycleTicks, dayTickOfHour, formatHour, hourOfDay, shareOfHour, type ClockScales } from "../../../shared/sim/clock.ts";
import type { HudModel } from "../hud.ts";
import type { ClientSession } from "../session.ts";
import { K_BUTTON, K_DIAL, K_IMAGE, K_PANEL, lineHeight, wrapText, type UiFrame, type UiImage } from "./nodes.ts";
import { S_DIAL_HOUR, S_HUD_HIT, S_ICE, S_KEY, S_KEY_SMALL, S_LABEL, S_MENU_NOTE } from "./style.ts";

export const IMAGE_DIAL = 4;
/** The face's side in pixels is the dial's on the screen, in steps of DIAL_STEP, from the least to the most here. */
export const DIAL_STEP = 64;
export const DIAL_LEAST = 256;
export const DIAL_MOST = 1024;
/** The markers on the sheet's last row, each a square MARKER of the face's side: the sun, the sun low in the sky, the moon. */
export const SPRITE_SUN = 0;
export const SPRITE_LOW = 1;
export const SPRITE_MOON = 2;

// Radii as shares of the dial's half-width.
const RIM = 0.985;
export const BAND_OUT = 0.935;
export const BAND_IN = 0.745;
/** Where the marker rides, the middle of the band. */
export const SUN_RADIUS = (BAND_OUT + BAND_IN) / 2;
const TICK_OUT = 0.718;
const TICK_HOUR = 0.682;
const TICK_MAJOR = 0.632;
const TICK_QUARTER = 0.7;
export const NUMERAL_RADIUS = 0.548;
export const INNER = 0.44;
/** A marker's side, as a share of the dial's. */
export const MARKER = 0.21;
/** Elevation of the sun below which it is drawn low and warm. */
const LOW_SUN = 0.26;

export const KEY_SUNDIAL = 7100;
const KEY_SUNDIAL_FACE = 7101;
const KEY_SUNDIAL_SUN = 7102;
const KEY_SUNDIAL_TIME = 7103;
const KEY_SUNDIAL_NEXT = 7104;
const KEY_SUNDIAL_NUMERAL = 7110;
const KEY_SUNDIAL_FOCUS = 7120;
export const KEY_SUNDIAL_PRESET = 7130;
const KEY_SUNDIAL_LINE = 7140;

/** The hours a button sets at once, each its own turn. */
export const PRESETS: readonly (readonly [hour: number, name: string])[] = [[SUNRISE, "Sunrise"], [12, "Noon"], [SUNSET, "Sunset"], [0, "Midnight"]];

/** Ticks between the messages of a turn: 10 a second. */
export const SEND_TICKS = 3;
/** Ticks after the last key or pad nudge that a turn by keys ends. */
export const NUDGE_TICKS = 15;
/** Ticks the hand keeps the hour it let go of while the server's hour comes. */
const SETTLE_TICKS = 2 * TICK_RATE;
/** Hours within which the server's hour is the one let go of. */
const SETTLED_HOURS = 0.05;
/** Shares of the dial's half-width from the middle, within which a press does not turn it: the hour is read there. */
const DEAD_MIDDLE = 0.3;

const TAU = Math.PI * 2;
const frac = (x: number): number => x - Math.floor(x);

/** Turns of the dial, clockwise from the top, at which `hour` sits: 0 to 1. */
export function angleOfHour(hour: number, c: ClockScales): number {
  return frac((dayTickOfHour(hour, c) - dayTickOfHour(12, c)) / cycleTicks(c));
}

/** The hour at `turns` of the dial, clockwise from the top. */
export function hourOfAngle(turns: number, c: ClockScales): number {
  const cycle = cycleTicks(c);
  return hourOfDay(frac(turns + dayTickOfHour(12, c) / cycle) * cycle, 0, c);
}

/** Turns clockwise from the top at which a point lies from the dial's middle. `dy` grows downward, as the canvas does. */
export function turnsOf(dx: number, dy: number): number {
  return frac(Math.atan2(dx, -dy) / TAU);
}

/** How high the sun stands: 1 at noon, 0 at sunrise and sunset, -1 at midnight, a sine of the ticks into the day or the night. */
export function elevation(hour: number, c: ClockScales): number {
  const rise = dayTickOfHour(SUNRISE, c), set = dayTickOfHour(SUNSET, c), cycle = cycleTicks(c), t = dayTickOfHour(hour, c);
  return t >= rise && t < set ? Math.sin((Math.PI * (t - rise)) / (set - rise)) : -Math.sin((Math.PI * frac((t - set) / cycle) * cycle) / (cycle - (set - rise)));
}

/** A span of real time as a player reads it: "45 s", "25 min", "1 h 10 min". */
export function span(seconds: number): string {
  if (seconds < 59.5) return `${Math.max(1, Math.round(seconds))} s`;
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min` : m % 60 === 0 ? `${m / 60} h` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** The band's colour at an elevation of the sun: midnight's blue, a violet dusk, the horizon's amber, then the day's ice. */
const SKY: readonly (readonly [number, number])[] = [[-1, 0x0f2546], [-0.5, 0x163563], [-0.13, 0x3d4277], [0, 0xe2946a], [0.11, 0xf0c38e], [0.34, 0x79bddb], [1, 0xa8dcf0]];

function sky(e: number): number {
  let i = 1;
  while (i < SKY.length - 1 && e > SKY[i]![0]) i++;
  const [e0, c0] = SKY[i - 1]!, [e1, c1] = SKY[i]!;
  return mixColour(c0, c1, Math.max(0, Math.min(1, (e - e0) / (e1 - e0))));
}

function mixColour(a: number, b: number, t: number): number {
  const ch = (s: number): number => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
/** Coverage of a pixel by the ring from `lo` to `hi`, `px` wide, as a box filter. */
const ring = (r: number, lo: number, hi: number, px: number): number => clamp01((r - lo) / px + 0.5) * clamp01((hi - r) / px + 0.5);
/** Coverage of a pixel `d` from the middle of a stroke `width` wide. */
const stroke = (d: number, width: number, px: number): number => clamp01((width / 2 - Math.abs(d)) / px + 0.5);

/** Paints one pixel by layers, back to front, in premultiplied colour, and writes it. */
class Pen {
  r = 0;
  g = 0;
  b = 0;
  a = 0;
  clear(): void {
    this.r = this.g = this.b = this.a = 0;
  }
  over(colour: number, alpha: number): void {
    if (alpha <= 0) return;
    const k = alpha > 1 ? 1 : alpha;
    this.r = this.r * (1 - k) + ((colour >> 16) & 255) * k;
    this.g = this.g * (1 - k) + ((colour >> 8) & 255) * k;
    this.b = this.b * (1 - k) + (colour & 255) * k;
    this.a = this.a * (1 - k) + k;
  }
  put(data: Uint8ClampedArray, at: number): void {
    if (this.a <= 0) return;
    data[at] = this.r / this.a;
    data[at + 1] = this.g / this.a;
    data[at + 2] = this.b / this.a;
    data[at + 3] = this.a * 255;
  }
}

/** The side of a marker on the sheet of a face `size` pixels square. */
export const spritePixels = (size: number): number => Math.round(size * MARKER);

/** The face's side in pixels for a dial `units` wide on a canvas shown `pixels` device pixels to a unit. */
export function dialPixels(units: number, pixels: number): number {
  return Math.max(DIAL_LEAST, Math.min(DIAL_MOST, Math.ceil((units * pixels) / DIAL_STEP) * DIAL_STEP));
}

/**
 * The face for a clock, `size` pixels square, and under it the three markers. Rings, the band of the sky, the hour ticks
 * and the stars are measured from the clock, so they agree with angleOfHour to the pixel.
 */
export function paintDial(c: ClockScales, size: number): UiImage {
  const sprite = spritePixels(size), width = size, height = size + sprite;
  const data = new Uint8ClampedArray(width * height * 4);
  const pen = new Pen();
  const px = 2 / size;
  const cycle = cycleTicks(c), noon = dayTickOfHour(12, c) / cycle;
  // The quarter hours' angles, and the band's colour at each of 720 steps round it.
  const quarters = Array.from({ length: 96 }, (_, q) => angleOfHour(q / 4, c));
  const BAND_STEPS = 720;
  const band = Array.from({ length: BAND_STEPS }, (_, i) => sky(elevation(hourOfDay(frac((i + 0.5) / BAND_STEPS + noon) * cycle, 0, c), c)));
  const rise = angleOfHour(SUNRISE, c), set = angleOfHour(SUNSET, c);
  for (let py = 0; py < size; py++) {
    for (let pxl = 0; pxl < size; pxl++) {
      const x = (pxl + 0.5) * px - 1, y = (py + 0.5) * px - 1, r = Math.hypot(x, y);
      if (r > 1) continue;
      pen.clear();
      // The glass, a shade lighter toward the upper left as the panels are.
      pen.over(mixColour(0x0b1f33, 0x1a3a52, clamp01(0.5 - (x + y) * 0.35)), 0.6 * ring(r, -1, RIM, px));
      const turns = turnsOf(x, y);
      // The sky across the day, darker at its inner edge.
      const inBand = ring(r, BAND_IN, BAND_OUT, px);
      if (inBand > 0) {
        const depth = (r - BAND_IN) / (BAND_OUT - BAND_IN);
        pen.over(mixColour(0x050d18, band[Math.min(BAND_STEPS - 1, Math.floor(turns * BAND_STEPS))]!, 0.8 + 0.2 * clamp01(depth)), 0.92 * inBand);
      }
      pen.over(0xa6e3f4, 0.4 * stroke(r - BAND_IN, px, px));
      pen.over(0xa6e3f4, 0.4 * stroke(r - BAND_OUT, px, px));
      pen.over(0x9fd3e6, 0.78 * stroke(r - RIM, 1.3 * px, px));
      // The middle, where the hour is read: deeper glass with a fine edge.
      pen.over(0x050f1b, 0.4 * ring(r, -1, INNER, px));
      pen.over(0xa6e3f4, 0.26 * stroke(r - INNER, px, px));
      // Sunrise and sunset, a warm notch across the rim.
      for (const at of [rise, set]) {
        let d = turns - at;
        d -= Math.round(d);
        pen.over(0xf2b07e, 0.9 * stroke(r * Math.sin(d * TAU), 1.6 * px, px) * ring(r, BAND_OUT, RIM + px, px) * (Math.abs(d) < 0.25 ? 1 : 0));
      }
      // Hour ticks, longer every six hours, and a fine one each quarter. Only the two nearest are near enough to show.
      if (r > TICK_MAJOR - px && r < TICK_OUT + px) {
        const q0 = Math.floor(hourOfAngle(turns, c) * 4);
        for (const q of [q0 - 1, q0, q0 + 1, q0 + 2]) {
          const k = ((q % 96) + 96) % 96;
          let d = turns - quarters[k]!;
          d -= Math.round(d);
          if (Math.abs(d) > 0.1) continue;
          const major = k % 24 === 0, hour = k % 4 === 0;
          const inner = major ? TICK_MAJOR : hour ? TICK_HOUR : TICK_QUARTER;
          const along = r * Math.cos(d * TAU);
          pen.over(0xd8f3fb, (major ? 0.95 : hour ? 0.62 : 0.3) * stroke(r * Math.sin(d * TAU), (major ? 1.9 : hour ? 1.3 : 1) * px, px) * ring(along, inner, TICK_OUT, px));
        }
      }
      pen.put(data, (py * width + pxl) * 4);
    }
  }
  stars(data, width, size, c);
  marker(data, width, size, sprite, SPRITE_SUN, 0xfffbef, 0xffdf9c, 0xffcf86, 0.5);
  marker(data, width, size, sprite, SPRITE_LOW, 0xfff0d2, 0xffae6e, 0xff9358, 0.55);
  marker(data, width, size, sprite, SPRITE_MOON, 0xe8f2f8, 0xd2e3ee, 0x9fc6de, 0.26);
  return { width, height, data, version: 1, smooth: true };
}

/** A few stars in the band where the night is deepest, the same each time for a clock. */
function stars(data: Uint8ClampedArray, width: number, size: number, c: ClockScales): void {
  let seed = 0x2f6b1d;
  const rand = (): number => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 70; i++) {
    const turns = rand(), along = BAND_IN + 0.02 + rand() * (BAND_OUT - BAND_IN - 0.04), bright = rand();
    const e = elevation(hourOfAngle(turns, c), c);
    if (e > -0.3) continue;
    const sx = (1 + along * Math.sin(turns * TAU)) * size / 2, sy = (1 - along * Math.cos(turns * TAU)) * size / 2;
    const glow = Math.min(1, (-e - 0.3) * 2.2) * (0.35 + 0.65 * bright), reach = (size / 640) * (0.9 + bright * 0.5);
    for (let y = Math.floor(sy - 1 - reach); y <= sy + 1 + reach; y++) for (let x = Math.floor(sx - 1 - reach); x <= sx + 1 + reach; x++) {
      const k = glow * clamp01(1.25 - Math.hypot(x + 0.5 - sx, y + 0.5 - sy) / reach);
      const at = (y * width + x) * 4;
      if (k <= 0 || data[at + 3] === 0) continue;
      for (let ch = 0; ch < 3; ch++) data[at + ch] = data[at + ch]! + (0xe8 + (ch === 2 ? 0x17 : 0) - data[at + ch]!) * k;
    }
  }
}

/** A marker on the sheet's last row: a soft glow, the ring a hand grips, and a disc, the moon's a crescent over its dark side. */
function marker(data: Uint8ClampedArray, width: number, size: number, side: number, which: number, core: number, edge: number, glow: number, glowAlpha: number): void {
  const pen = new Pen();
  const half = side / 2, px = 1 / half, moon = which === SPRITE_MOON;
  for (let py = 0; py < side; py++) {
    for (let pxl = 0; pxl < side; pxl++) {
      const x = (pxl + 0.5) / half - 1, y = (py + 0.5) / half - 1, q = Math.hypot(x, y);
      if (q > 1) continue;
      pen.clear();
      pen.over(glow, glowAlpha * (1 - clamp01((q - 0.18) / 0.82)) ** 2);
      pen.over(0xe9f8ff, 0.85 * stroke(q - 0.42, 1.5 * px, px));
      const disc = ring(q, -1, moon ? 0.25 : 0.27, px);
      if (moon) {
        pen.over(0x30475a, 0.75 * disc);
        // The lit crescent: the disc less a disc set toward the upper right.
        pen.over(core, disc * (1 - ring(Math.hypot(x - 0.11, y + 0.07), -1, 0.22, px)));
      } else pen.over(mixColour(core, edge, clamp01(q / 0.27)), disc);
      pen.put(data, ((size + py) * width + which * side + pxl) * 4);
    }
  }
}

/** The face and markers last drawn, painted again only for another clock or another size on the screen. */
let painted: { key: string; image: UiImage } | null = null;

function faceFor(f: UiFrame, c: ClockScales, size: number): UiImage {
  const key = `${c.cycle}/${c.day}/${c.night}/${size}`;
  if (painted?.key !== key) painted = { key, image: paintDial(c, size) };
  if (f.images[IMAGE_DIAL] !== painted.image) {
    painted.image.version = (f.images[IMAGE_DIAL]?.version ?? 0) + 1;
    f.images[IMAGE_DIAL] = painted.image;
  }
  return painted.image;
}

/** Where the dial was last laid out, for reading a pointer. */
export interface DialBox {
  cx: number;
  cy: number;
  radius: number;
}

/**
 * The sundial's state on this client: the hour in the admin's hand, and the turn that carries it to the server. A turn starts
 * with a press or a nudge and ends with the release, or NUDGE_TICKS after the last nudge; the server journals it once.
 */
export class Sundial {
  readonly name = "Sundial";
  readonly first = KEY_SUNDIAL;
  /** The hour the hand holds, which the sky shows at once: during a turn, and after it until the server's hour agrees. NaN for none. */
  held = NaN;
  readonly box: DialBox = { cx: 0, cy: 0, radius: 1 };
  private clock: ClockScales = { cycle: 1, day: 1, night: 1 };
  private dragging = false;
  private turning = false;
  private nudged = false;
  private nudgedAt = -1;
  private dirty = false;
  private sentShare = -1;
  private sentAt = -Infinity;
  private settleBy = 0;
  /** The hour last drawn. */
  private shown = 12;

  /** The hour under a point of the canvas, or NaN too near the middle to say. */
  hourAt(x: number, y: number, near = DEAD_MIDDLE): number {
    const { cx, cy, radius } = this.box;
    return Math.hypot(x - cx, y - cy) < near * radius ? NaN : hourOfAngle(turnsOf(x - cx, y - cy), this.clock);
  }

  private set(hour: number): void {
    if (Number.isNaN(hour)) return;
    this.held = ((hour % 24) + 24) % 24;
    this.turning = true;
    this.dirty = true;
  }

  /** `kind` 0 for a press, 1 for a release, 2 for a move. Returns true if it was the dial's. */
  pointer(kind: number, key: number, x: number, y: number, session: ClientSession): boolean {
    if (kind === 0 && key >= KEY_SUNDIAL_PRESET && key < KEY_SUNDIAL_PRESET + PRESETS.length) {
      if (!this.dragging) {
        this.held = PRESETS[key - KEY_SUNDIAL_PRESET]![0];
        this.turning = true;
        this.finish(session);
      }
      return true;
    }
    if (key !== KEY_SUNDIAL) return false;
    if (kind === 0) {
      const hour = this.hourAt(x, y);
      if (Number.isNaN(hour)) return true;
      this.dragging = true;
      this.set(hour);
    } else if (kind === 2 && this.dragging) this.set(this.hourAt(x, y, 0.08));
    else if (kind === 1 && this.dragging) {
      this.dragging = false;
      this.finish(session);
    }
    return true;
  }

  /** A key or the pad nudges the hour by a quarter, or with `coarse` by a whole hour, to the next mark that way. */
  adjust(key: number, by: number, coarse: boolean): boolean {
    if (key !== KEY_SUNDIAL || by === 0 || this.dragging) return false;
    const base = Number.isNaN(this.held) ? this.shown : this.held;
    const step = coarse ? 1 : 0.25;
    this.set(by > 0 ? (Math.floor(base / step + 1e-6) + 1) * step : (Math.ceil(base / step - 1e-6) - 1) * step);
    this.nudged = true;
    return true;
  }

  /** Each frame: sends the turn at most every SEND_TICKS, ends a turn by keys, and lets go of the hour once the server has it. */
  pump(session: ClientSession, open: boolean): void {
    const tick = session.serverTick;
    if (!open && this.dragging) {
      this.dragging = false;
      this.finish(session);
    }
    if (this.nudged) {
      this.nudged = false;
      this.nudgedAt = tick;
    }
    if (this.turning && !this.dragging && this.nudgedAt >= 0 && tick - this.nudgedAt >= NUDGE_TICKS) this.finish(session);
    else if (this.turning && this.dirty && tick - this.sentAt >= SEND_TICKS) this.send(session, false);
    if (!this.turning && !Number.isNaN(this.held)) {
      let d = Math.abs(hourOfDay(tick, session.dayOffset, session.clock) - this.held);
      d = Math.min(d, 24 - d);
      if (d < SETTLED_HOURS || tick >= this.settleBy) this.held = NaN;
    }
  }

  private finish(session: ClientSession): void {
    this.send(session, true);
    this.turning = false;
    this.nudgedAt = -1;
    this.settleBy = session.serverTick + SETTLE_TICKS;
  }

  private send(session: ClientSession, last: boolean): void {
    const share = shareOfHour(this.held);
    this.dirty = false;
    if (!last && share === this.sentShare) return;
    session.command(CMD_CLOCK, (w) => {
      w.u16(share);
      w.bool(last);
    });
    this.sentShare = last ? -1 : share;
    this.sentAt = session.serverTick;
  }

  /**
   * Lays the dial out in the area at `x`, `y`, `w` wide and `h` high: the dial, the four hours a button sets, and two lines
   * on what it does. The face is painted at the size the screen shows it (hud.scale, hud.dpr), and the hour is the sky's.
   */
  build(f: UiFrame, x: number, y: number, w: number, h: number, session: ClientSession, hud: HudModel, focus: number): void {
    const c = session.clock;
    this.clock = { cycle: c.cycle, day: c.day, night: c.night };
    const shown = Number.isNaN(this.held) ? hud.hour : this.held;
    this.shown = shown;
    const lines: string[] = [];
    const cycle = cycleTicks(c), day = dayTickOfHour(SUNSET, c) - dayTickOfHour(SUNRISE, c);
    wrapText(`Everyone here sees the hour you set. A day lasts ${span(cycle / TICK_RATE)}: ${span(day / TICK_RATE)} of light, ${span((cycle - day) / TICK_RATE)} of dark.`, w, S_MENU_NOTE, lines);
    wrapText("Drag the sun round, or turn it with the arrow keys, a quarter hour at a time or an hour with Shift.", w, S_MENU_NOTE, lines);
    const lh = 18, below = 14 + 34 + 14 + lines.length * lh;
    const d = Math.floor(Math.min(w, h - below)), radius = d / 2;
    const left = Math.round(x + (w - d) / 2), cx = left + radius, cy = y + radius;
    this.box.cx = cx;
    this.box.cy = cy;
    this.box.radius = radius;

    const face = f.add(KEY_SUNDIAL_FACE, K_IMAGE, left, y, d, d, S_LABEL);
    const size = dialPixels(d, hud.scale * hud.dpr), side = spritePixels(size);
    faceFor(f, c, size);
    face.image = IMAGE_DIAL;
    face.sw = face.sh = size;
    // The numerals, every three hours, those of midnight, sunrise, noon and sunset the larger.
    for (let i = 0; i < 8; i++) {
      const at = angleOfHour(i * 3, c), major = i % 2 === 0, style = major ? S_KEY : S_KEY_SMALL;
      const nx = cx + radius * NUMERAL_RADIUS * Math.sin(at * TAU), ny = cy - radius * NUMERAL_RADIUS * Math.cos(at * TAU);
      f.text(KEY_SUNDIAL_NUMERAL + i, Math.round(nx - 15), Math.round(ny - lineHeight(style) / 2), 30, style, `${i * 3 < 10 ? "0" : ""}${i * 3}`).alpha = major ? 0.95 : 0.6;
    }
    // The marker rides the band: the sun, low and warm near the horizon, or the moon.
    const e = elevation(shown, c), at = angleOfHour(shown, c), m = Math.round(d * MARKER);
    const sun = f.add(KEY_SUNDIAL_SUN, K_IMAGE, cx + radius * SUN_RADIUS * Math.sin(at * TAU) - m / 2, cy - radius * SUN_RADIUS * Math.cos(at * TAU) - m / 2, m, m, S_LABEL);
    sun.image = IMAGE_DIAL;
    sun.sx = (e >= LOW_SUN ? SPRITE_SUN : e >= 0 ? SPRITE_LOW : SPRITE_MOON) * side;
    sun.sy = size;
    sun.sw = sun.sh = side;
    // The hour as the game writes it, and how long, in real time, until the sun next rises or sets.
    f.text(KEY_SUNDIAL_TIME, cx - radius * INNER, cy - 40, radius * INNER * 2, S_DIAL_HOUR, formatHour(shown));
    const t = dayTickOfHour(shown, c), rise = dayTickOfHour(SUNRISE, c), set = dayTickOfHour(SUNSET, c), up = t >= rise && t < set;
    const next = up ? set - t : frac((rise - t) / cycle) * cycle;
    f.text(KEY_SUNDIAL_NEXT, cx - radius * INNER, cy + 12, radius * INNER * 2, S_KEY, `${up ? "sunset" : "sunrise"} in ${span(next / TICK_RATE)}`).alpha = 0.8;
    const hit = f.add(KEY_SUNDIAL, K_DIAL, left, y, d, d, S_HUD_HIT);
    hit.interactive = true;
    hit.label = `Time of day ${formatHour(shown)}. Drag the sun, or use the arrow keys.`;
    // Held by the keyboard or a pad, the dial has a mark at each corner.
    if (focus === KEY_SUNDIAL) {
      const arm = 16;
      for (let k = 0; k < 4; k++) {
        const fx = k % 2 === 0 ? left - 6 : left + d + 6, fy = k < 2 ? y - 6 : y + d + 6, sx = k % 2 === 0 ? 1 : -1, sy = k < 2 ? 1 : -1;
        f.add(KEY_SUNDIAL_FOCUS + k * 2, K_PANEL, sx > 0 ? fx : fx - arm, sy > 0 ? fy : fy - 1.5, arm, 1.5, S_ICE).alpha = 0.9;
        f.add(KEY_SUNDIAL_FOCUS + k * 2 + 1, K_PANEL, sx > 0 ? fx : fx - 1.5, sy > 0 ? fy : fy - arm, 1.5, arm, S_ICE).alpha = 0.9;
      }
    }
    // The four hours a press sets, then what the dial does.
    const by = y + d + 14, gap = 8, bw = (w - gap * (PRESETS.length - 1)) / PRESETS.length;
    PRESETS.forEach(([hours, name], i) => {
      const key = KEY_SUNDIAL_PRESET + i;
      const b = f.add(key, K_BUTTON, x + i * (bw + gap), by, bw, 34, S_HUD_HIT);
      b.text = name;
      b.label = `Set the time to ${name.toLowerCase()}, ${formatHour(hours)}`;
      b.interactive = true;
      f.add(90000 + key, K_PANEL, x + i * (bw + gap) + 8, by + 33, bw - 16, 1, S_ICE).alpha = focus === key ? 0.9 : 0.25;
    });
    lines.forEach((line, i) => (f.text(KEY_SUNDIAL_LINE + i, x, by + 48 + i * lh, w, S_MENU_NOTE, line).alpha = 0.85));
  }
}
