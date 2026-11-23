// A drone's feed over the view (client/core/air-feed.ts), as a camera's monitor prints it: a frame at the corners, REC
// blinking, the feed's name and clock, a heading tape, speed and height either side of the reticle, the link's bars, the
// zoom, the fuel with its bar, warnings, and the keys. On a tier with no finishing pass (Tier.post) the scanlines and the
// vignette are panels here; with one the finish draws them (render/feed.ts). The tracking boxes are hud/tracks.ts. While
// a drone is flown the rest of the HUD is not built: ui.ts builds this and the boxes in its place.

import { HIT_NONE, castWorld, rayHit } from "../../../shared/world/ray.ts";
import { FEED_ZOOM_MAX, FEED_ZOOM_MIN } from "../air-feed.ts";
import { OPTIC_HEAT, OPTIC_NIGHT } from "../render/packet.ts";
import { K_BAR, K_PANEL, type UiFrame } from "../ui/nodes.ts";
import { S_CROSS, S_DARK, S_FEED, S_FEED_BIG, S_FEED_REC, S_FEED_RIGHT, S_FEED_SMALL, S_FEED_WARN, S_HEALTH, S_OXYGEN, S_SCANLINES, S_VIGNETTE } from "../ui/style.ts";
import { headingOf } from "./state.ts";
import { buildTracks, type TracksModel } from "./tracks.ts";
import type { HudWidget } from "./widget.ts";

/** The feed's nodes: its frame and words, its heading tape, and its two scales. */
export const KEY_FEED = 46000;
const KEY_TAPE = KEY_FEED + 100;
const KEY_SCALE = KEY_FEED + 200;
/** The feed's ink, and its warm accent. */
const INK = 0xe9f3f7;
const WARM = 0xffb04a;
/** The link's bars, and the signal under which it warns. */
const BARS = 5;
const WEAK = 0.3;

export interface FeedModel {
  feed: boolean;
  /** "BAY 4 · SRV-04": its bay and the drone's serial; the game's clock, "14:32:07". */
  feedName: string;
  feedClock: string;
  feedFuel: number;
  feedSignal: number;
  /** Metres a second, metres over what is under it, and degrees: heading clockwise from north and the camera's elevation. */
  feedSpeed: number;
  feedAgl: number;
  feedHeading: number;
  feedPitch: number;
  /** The feed's view (OPTIC_FEED, OPTIC_NIGHT, OPTIC_HEAT), its zoom, a frame held, and the time (ms). */
  feedMode: number;
  feedZoom: number;
  feedFrozen: boolean;
  feedNow: number;
  /** The tier has a finishing pass, which draws the scanlines and vignette itself. */
  feedPost: boolean;
}

let named = -1, name = "";

/** "14:32:07" from an hour of the day. */
function clockOf(hour: number): string {
  const s = Math.floor((((hour % 24) + 24) % 24) * 3600);
  const two = (n: number): string => (n < 10 ? "0" : "") + n;
  return `${two(Math.floor(s / 3600))}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`;
}

export const FEED: HudWidget<FeedModel> = {
  name: "drone feed",
  make: () => ({ feed: false, feedName: "", feedClock: "", feedFuel: 0, feedSignal: 0, feedSpeed: 0, feedAgl: 0, feedHeading: 0, feedPitch: 0, feedMode: 0, feedZoom: 1, feedFrozen: false, feedNow: 0, feedPost: false }),
  fill(m, c) {
    const a = c.frame, s = c.session, v = s.airFeed;
    m.feed = a !== null && v.active;
    if (!m.feed || !a) return;
    const flight = s.airSupport.flight;
    if (flight !== named) {
      named = flight;
      name = `BAY ${v.bay + 1} · SRV-${String(flight % 100).padStart(2, "0")}`;
    }
    m.feedName = name;
    m.feedClock = clockOf(m.hour);
    m.feedFuel = v.fuel;
    m.feedSignal = v.signal;
    m.feedSpeed = v.speed;
    const cam = a.cam, world = a.world;
    m.feedAgl = Math.max(0, castWorld(world, cam.x, cam.y, cam.z, 0, -1, 0, 3000) !== HIT_NONE ? rayHit.t : cam.y - world.hf.heightAt(cam.x, cam.z));
    m.feedHeading = headingOf(v.yaw);
    m.feedPitch = (v.pitch * 180) / Math.PI;
    const shown = a.feed;
    m.feedMode = shown?.mode ?? 0;
    m.feedZoom = shown?.zoom ?? 1;
    m.feedFrozen = shown?.frozen ?? false;
    m.feedNow = c.nowMs ?? 0;
    m.feedPost = a.scene.assets.tier.post !== null;
  },
};

/** Where the drone's buttons stand by touch (ui/air-support.ts), over the keys' line: x, y and each one's width. */
export function feedButtons(f: UiFrame): { x: number; y: number; w: number } {
  const w = Math.min(150, (f.width - f.left - f.right - 60) / 2);
  return { x: f.width / 2 - w - 4, y: f.height - f.bottom - 78, w };
}

/** The feed and its tracking boxes, into `f`; `device` is the input's (0 keys, 1 a pad, 2 touch). */
export function buildFeed(f: UiFrame, m: FeedModel & TracksModel, device: number): void {
  if (!m.feed) return;
  const W = f.width, H = f.height, L = f.left + 22, R = W - f.right - 22, T = f.top + 18, B = H - f.bottom - 18;
  let k = KEY_FEED;
  const ink = (x: number, y: number, w: number, h: number, alpha = 0.9, tint = INK): void => {
    const n = f.add(k++, K_PANEL, x, y, w, h, S_CROSS);
    n.tint = tint;
    n.alpha = alpha;
  };
  if (!m.feedPost) {
    f.add(k++, K_PANEL, 0, 0, W, H, S_SCANLINES).alpha = 0.22;
    f.add(k++, K_PANEL, 0, 0, W, H, S_VIGNETTE).alpha = 0.6;
  } else k += 2;
  buildTracks(f, m, W, H);
  // The frame's corners.
  const arm = 34;
  for (const [x, sx] of [[L, 1], [R, -1]] as const) {
    for (const [y, sy] of [[T, 1], [B, -1]] as const) {
      ink(sx > 0 ? x : x - arm, sy > 0 ? y : y - 2, arm, 2, 0.85);
      ink(sx > 0 ? x : x - 2, sy > 0 ? y : y - arm, 2, arm, 0.85);
    }
  }
  // Top left: REC blinking, the feed's name, its clock and view.
  const x = L + 12, y = T + 10, on = m.feedNow % 1300 < 800;
  ink(x, y + 4, 8, 8, on ? 1 : 0.15, 0xff4a3d);
  f.text(k++, x + 13, y, 34, S_FEED_REC, "REC").alpha = on ? 1 : 0.55;
  f.text(k++, x + 50, y, 190, S_FEED, m.feedName);
  const view = m.feedMode === OPTIC_NIGHT ? "NV" : m.feedMode === OPTIC_HEAT ? "IR WHT" : "EO";
  f.text(k++, x, y + 18, 200, S_FEED, `${m.feedClock}  ${view}`);
  if (m.feedFrozen) f.text(k++, x, y + 36, 200, S_FEED_REC, "FRAME HOLD");
  else k++;
  // Top right: the link's bars and strength, the zoom.
  const signal = Math.max(0, Math.min(1, m.feedSignal)), lit = Math.ceil(signal * BARS - 0.05);
  for (let i = 0; i < BARS; i++) {
    const bh = 4 + i * 3;
    ink(R - 12 - (BARS - i) * 6, y + 15 - bh, 4, bh, i < lit ? 0.95 : 0.25, signal < WEAK ? WARM : INK);
  }
  f.text(k++, R - 230, y, 180, S_FEED_RIGHT, signal <= 0.02 ? "NO LINK" : `LINK ${Math.round(signal * 100)}%`);
  f.text(k++, R - 230, y + 18, 218, S_FEED_RIGHT, `ZOOM ${m.feedZoom < 10 ? m.feedZoom.toFixed(1) : Math.round(m.feedZoom)}x`);
  // The zoom's rungs beside it, from its least at the foot to its most.
  const zt = (Math.log(m.feedZoom / FEED_ZOOM_MIN) / Math.log(FEED_ZOOM_MAX / FEED_ZOOM_MIN)) * 40;
  ink(R - 4, y + 22, 1, 40, 0.4);
  ink(R - 8, y + 62 - zt - 1, 9, 2, 0.95);
  buildTape(f, m, W / 2, T + 4, Math.min(320, R - L - 470));
  // Speed on the left of the reticle, height over the ground on its right, each on a scale that rolls by.
  const mid = H / 2, gap = Math.min(250, (R - L) / 2 - 70);
  buildScale(f, KEY_SCALE, W / 2 - gap, mid, -1, m.feedSpeed * 3.6, "SPD", "KM/H");
  buildScale(f, KEY_SCALE + 50, W / 2 + gap, mid, 1, m.feedAgl, "AGL", "M");
  // The reticle: a cross with its middle open, a dot, and a box about it.
  const cx = W / 2, cy = H / 2;
  ink(cx - 18, cy - 0.75, 11, 1.5); ink(cx + 7, cy - 0.75, 11, 1.5);
  ink(cx - 0.75, cy - 18, 1.5, 11); ink(cx - 0.75, cy + 7, 1.5, 11);
  ink(cx - 1, cy - 1, 2, 2, 1);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    ink(sx < 0 ? cx - 34 : cx + 26, sy < 0 ? cy - 34 : cy + 33, 8, 1, 0.6);
    ink(sx < 0 ? cx - 34 : cx + 33, sy < 0 ? cy - 34 : cy + 26, 1, 8, 0.6);
  }
  f.text(k++, cx - 60, cy + 40, 120, S_FEED_SMALL, `EL ${m.feedPitch >= 0 ? "+" : "−"}${Math.abs(Math.round(m.feedPitch))}°`).alpha = 0.85;
  // Bottom left: the fuel and its bar.
  // By touch the boost button holds the corner, so the fuel stands over it.
  const fy = device === 2 ? B - 150 : B - 40, low = m.feedFuel < 0.2;
  f.text(k++, x, fy, 160, low ? S_FEED_REC : S_FEED, `FUEL ${Math.round(m.feedFuel * 100)}%`);
  f.add(k++, K_BAR, x, fy + 20, 150, 4, low ? S_HEALTH : S_OXYGEN).value = m.feedFuel;
  // Warnings under the reticle.
  const blink = m.feedNow % 900 < 600;
  const warn = signal <= 0.02 ? "SIGNAL LOST" : signal < WEAK ? "WEAK SIGNAL" : low ? "LOW FUEL" : "";
  if (warn !== "") f.text(k++, cx - 100, cy + 62, 200, S_FEED_WARN, warn).alpha = blink ? 1 : 0.35;
  else k++;
  // The keys.
  const keys = device === 1 ? "L3 BOOST   Y PAYLOAD   R3 LEAVE   LB+RB VIEW   D-PAD ZOOM   X MARK"
    : device === 2 ? "DRAG TO STEER   HOLD BOOST"
      : "SHIFT BOOST   E PAYLOAD   J LEAVE   V VIEW   WHEEL ZOOM   N MARK";
  f.text(k++, L, B - 24, R - L, S_FEED_SMALL, keys).alpha = 0.85;
}

/** The heading tape at the top, `width` wide about `cx`: a tick each 5 degrees, the quarters lettered, the heading boxed. */
function buildTape(f: UiFrame, m: FeedModel, cx: number, y: number, width: number): void {
  if (width < 120) return;
  let k = KEY_TAPE;
  const key = (): number => k++;
  const span = 45, scale = width / 2 / span, h = m.feedHeading;
  for (let deg = Math.ceil((h - span) / 5) * 5; deg <= h + span; deg += 5) {
    const d = deg - h, at = ((deg % 360) + 360) % 360, x = cx + d * scale, fade = 1 - (d / span) ** 2;
    const big = at % 15 === 0;
    const n = f.add(key(), K_PANEL, x - 0.5, y + (big ? 0 : 4), 1, big ? 9 : 5, S_CROSS);
    n.tint = INK;
    n.alpha = 0.85 * fade;
    if (at % 30 === 0 && Math.abs(d) > 7) {
      const word = at === 0 ? "N" : at === 90 ? "E" : at === 180 ? "S" : at === 270 ? "W" : String(at).padStart(3, "0");
      f.text(key(), x - 20, y + 10, 40, S_FEED_SMALL, word).alpha = fade;
    }
  }
  f.add(key(), K_PANEL, cx - 24, y + 10, 48, 20, S_DARK).alpha = 0.55;
  const edge = f.add(key(), K_PANEL, cx - 24, y + 10, 48, 1, S_CROSS);
  edge.tint = INK;
  f.text(key(), cx - 24, y + 10, 48, S_FEED_BIG, String(Math.round(h) % 360).padStart(3, "0"));
  const caret = f.add(key(), K_PANEL, cx - 0.75, y, 1.5, 10, S_CROSS);
  caret.tint = WARM;
}

/**
 * A readout beside the reticle at (x, y), on the `side` away from it (-1 left, 1 right): a scale of ticks that rolls by
 * as `value` changes, and the value boxed with its name and unit.
 */
function buildScale(f: UiFrame, first: number, x: number, y: number, side: number, value: number, label: string, unit: string): void {
  let k = first;
  const key = (): number => k++;
  const step = 10, gap = 14, rows = 6, base = Math.floor(value / step);
  for (let r = -rows; r <= rows; r++) {
    const at = y - (r - (value / step - base)) * gap;
    if (Math.abs(at - y) > rows * gap) continue;
    const big = (base + r) % 5 === 0, len = big ? 10 : 5;
    const n = f.add(key(), K_PANEL, side < 0 ? x - len : x, at - 0.5, len, 1, S_CROSS);
    n.tint = INK;
    n.alpha = 0.7 * (1 - Math.abs(at - y) / (rows * gap + 1));
  }
  const bx = side < 0 ? x - 82 : x + 14;
  f.add(key(), K_PANEL, bx, y - 11, 68, 22, S_DARK).alpha = 0.5;
  const rim = f.add(key(), K_PANEL, side < 0 ? bx + 67 : bx, y - 11, 1, 22, S_CROSS);
  rim.tint = INK;
  f.text(key(), bx, y - 11, 68, S_FEED_BIG, String(Math.round(value)));
  f.text(key(), bx, y - 28, 68, S_FEED_SMALL, label);
  f.text(key(), bx, y + 12, 68, S_FEED_SMALL, unit);
}

