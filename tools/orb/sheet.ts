// The orb's contact sheet: every scene at six moments, each as the whole ball, as the ball close up where its pucks
// show, and as the ball far off, about 40 pixels across, in one PNG. Every pixel is the twin's (client/core/render/orb.ts
// orbLight, orbShown), with the frame's lanes written as a scene writes them and the hour's own exposure and grade on
// medium, so it is what the tests and the probe hold the card to.
//
//   bun tools/orb/sheet.ts            var/orb/sheet.png, and a strip a scene beside it
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { orbLight, orbShown, strikeAt, writeOrb } from "../../client/core/render/orb.ts";
import { FRAME_FLOATS, ORB_AT } from "../../client/core/render/packet.ts";
import { postFrame } from "../../client/core/render/post.ts";
import { skyFrame, theSky } from "../../client/core/render/sky.ts";
import type { SupplyList } from "../../shared/sim/supply.ts";
import { ORB_SCENES, type OrbSite } from "../../shared/world/orb.ts";
import type { TideEyeSite } from "../../shared/world/tide-eye.ts";
import { GLYPH_HEIGHT, GLYPH_WIDTH, glyphPixel } from "../snap/font.ts";
import { encodePng } from "../snap/png.ts";

const RATE = 30;
/** Las Vegas's, as its map has them: the ball, and the blue eye 210 m north of it. */
const SITE: OrbSite = { name: "Sphere", x: 4000, y: 620, z: 4000, yaw: 0, radius: 78, centre: 34 };
const BLUE: TideEyeSite = { name: "Sphere", x: 4000, y: 620, z: 4210, yaw: 0, color: "blue", radius: 28 };
const TIER = tierOf("medium");

/** A moment: its words, the server's seconds and hour, the bearing the ball is seen from (0 from the north, a quarter turn from the west), and a drop in flight or none. */
interface Moment {
  label: string;
  seconds: number;
  hour: number;
  from: number;
  drop?: boolean;
}
const WEST = Math.PI / 2, SOUTH = Math.PI, NORTH = 0;
/** Seconds at which the blue eye is `phase` into its cycle, some cycles in. */
const at = (phase: number, cycle = 3): number => cycle * 120 + phase;
const MOMENTS: Record<(typeof ORB_SCENES)[number], Moment[]> = {
  watcher: [
    { label: "17:30 at the low sun", seconds: at(70), hour: 17.5, from: WEST },
    { label: "noon at the sun", seconds: at(72.5), hour: 12, from: WEST },
    { label: "night at a falling drop", seconds: at(50), hour: 22, from: WEST, drop: true },
    { label: "the eye at power", seconds: at(20), hour: 22, from: NORTH },
    { label: "17:30 mid blink", seconds: at(70, 0) + 0.2, hour: 17.5, from: WEST },
    { label: "night at the moon, from behind", seconds: at(90), hour: 22, from: WEST },
  ],
  moon: [
    { label: "20:00 from the south", seconds: at(40), hour: 20, from: SOUTH },
    { label: "midnight from the south", seconds: at(60), hour: 0, from: SOUTH },
    { label: "04:00 from the east", seconds: at(80), hour: 4, from: -WEST },
    { label: "06:00 dawn, the planet rising", seconds: at(100), hour: 6, from: SOUTH },
    { label: "09:00 planet", seconds: at(10), hour: 9, from: SOUTH },
    { label: "13:00 planet, a turn on", seconds: at(10, 4), hour: 13, from: SOUTH },
  ],
  core: [
    { label: "night, the eye off", seconds: at(2), hour: 23, from: SOUTH },
    { label: "night, charging", seconds: at(11.5), hour: 23, from: SOUTH },
    { label: "night, full power", seconds: at(20), hour: 23, from: SOUTH },
    { label: "night, full power, a beat on", seconds: at(21.4), hour: 23, from: SOUTH },
    { label: "noon, fading", seconds: at(33), hour: 12, from: SOUTH },
    { label: "dusk, quiet", seconds: at(80), hour: 18.3, from: WEST },
  ],
  storm: [
    { label: "night, quiet", seconds: at(60.3), hour: 23, from: SOUTH },
    { label: "night, heat lightning", seconds: 0, hour: 23, from: SOUTH },
    { label: "night, the eye strikes", seconds: 0, hour: 23, from: SOUTH },
    { label: "night, another strike", seconds: 0, hour: 23, from: SOUTH },
    { label: "noon", seconds: at(70), hour: 12, from: SOUTH },
    { label: "dusk", seconds: at(100), hour: 18.3, from: NORTH },
  ],
  tide: [
    { label: "noon, just drained", seconds: at(22), hour: 12, from: SOUTH },
    { label: "noon, a third", seconds: at(55), hour: 12, from: SOUTH },
    { label: "dusk, two thirds", seconds: at(92), hour: 18, from: SOUTH },
    { label: "night, nearly full", seconds: at(8, 4), hour: 23, from: SOUTH },
    { label: "night, full, the cast due", seconds: at(15.8, 4), hour: 2, from: SOUTH },
    { label: "dawn, draining", seconds: at(18.2, 4), hour: 6.3, from: -WEST },
  ],
};

/** A drop in flight toward the west of the ball at `tick`. */
function dropAt(tick: number): SupplyList {
  const row = { id: 1, tier: 0, cls: 0, ringed: false, landed: false, opened: false, announce: 0, sender: 0, eye: 0, look: 0, called: tick - 600, release: tick - 300, land: tick + 300, brake: 90, end: tick + 9000, left: 0, ox: BLUE.x, oy: 2790, oz: BLUE.z, x: SITE.x + 900, y: SITE.y, z: SITE.z - 120 };
  return { tiers: [], classes: [], rows: [row] };
}

const frame = new Float32Array(FRAME_FLOATS), light = [0, 0, 0];
/** The frame's lanes for a moment of scene `which`, the eye at (x, y, z). */
function lanes(which: number, m: Moment, x: number, y: number, z: number): void {
  frame.fill(0);
  skyFrame(m.hour, theSky(), frame);
  postFrame(frame, TIER, m.hour, 1080);
  const tick = Math.round(m.seconds * RATE);
  writeOrb(frame, [SITE], [BLUE], m.seconds, m.hour, x, y, z, m.drop ? dropAt(tick) : null, tick, RATE, which);
}

/** A picture `w` by `h` of the ball from `distance` metres from its axis on bearing `from`, the eye 2 m up and aimed at its centre, with `across` its angle of view. */
function view(pixels: Uint8ClampedArray, stride: number, left: number, top: number, w: number, h: number, which: number, m: Moment, distance: number, across: number): void {
  const ex = SITE.x + distance * Math.sin(m.from), ey = SITE.y + 2, ez = SITE.z + distance * Math.cos(m.from);
  lanes(which, m, ex, ey, ez);
  const cx = frame[ORB_AT]!, cy = frame[ORB_AT + 1]!, cz = frame[ORB_AT + 2]!, r = SITE.radius, far = Math.hypot(cx, cy, cz);
  // The view's forward, right and up.
  const fx = cx / far, fy = cy / far, fz = cz / far;
  const rl = Math.hypot(fz, fx), rx = -fz / rl, rz = fx / rl;
  const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
  const span = Math.tan(across / 2) / (w / 2);
  /** Where the ray through pixel (px, py) meets the shell, into `hit`; false where it misses or meets it under its cut. */
  const hit = [0, 0, 0];
  const cast = (px: number, py: number): boolean => {
    const a = (px - w / 2) * span, b = (h / 2 - py) * span;
    let dx = fx + a * rx + b * ux, dy = fy + b * uy, dz = fz + a * rz + b * uz;
    const dl = Math.hypot(dx, dy, dz);
    dx /= dl; dy /= dl; dz /= dl;
    const along = dx * cx + dy * cy + dz * cz, disc = along * along - (far * far - r * r);
    if (disc <= 0) return false;
    const t = along - Math.sqrt(disc);
    hit[0] = dx * t; hit[1] = dy * t; hit[2] = dz * t;
    return hit[1]! - cy > -40;
  };
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const o = ((top + py) * stride + left + px) * 4;
      pixels[o] = pixels[o + 1] = pixels[o + 2] = 10;
      pixels[o + 3] = 255;
      if (!cast(px + 0.5, py + 0.5)) continue;
      const x = hit[0]!, y = hit[1]!, z = hit[2]!;
      // The metres a pixel spans there, as the card's fwidth has them: the place a pixel across and a pixel down.
      let wide = Math.hypot(x, y, z) * span * 1.5;
      if (cast(px + 1.5, py + 0.5)) {
        const ax = hit[0]! - x, ay = hit[1]! - y, az = hit[2]! - z;
        if (cast(px + 0.5, py + 1.5)) wide = Math.hypot(Math.abs(ax) + Math.abs(hit[0]! - x), Math.abs(ay) + Math.abs(hit[1]! - y), Math.abs(az) + Math.abs(hit[2]! - z));
      }
      orbLight(frame, x, y, z, wide, light, TIER.orb.octaves, TIER.orb.pucks);
      orbShown(pixels, light, frame, o);
    }
  }
}

function words(pixels: Uint8ClampedArray, stride: number, left: number, top: number, text: string): void {
  for (let i = 0; i < text.length; i++) for (let col = 0; col < GLYPH_WIDTH; col++) for (let row = 0; row < GLYPH_HEIGHT; row++) {
    if (!glyphPixel(text.charCodeAt(i), col, row)) continue;
    const o = ((top + row) * stride + left + i * (GLYPH_WIDTH + 1) + col) * 4;
    pixels[o] = pixels[o + 1] = pixels[o + 2] = 235;
  }
}

/** Seconds from `from` on at which the frame's lanes say `when`, by tenths. */
function seek(which: number, hour: number, from: number, when: () => boolean): number {
  for (let s = from; s < from + 600; s += 0.1) {
    lanes(which, { label: "", seconds: s, hour, from: 0 }, SITE.x, SITE.y, SITE.z + 400);
    if (when()) return s;
  }
  return from;
}

const WHOLE = 240, NEAR = 160, FAR = 48, GAP = 6, TEXT = 12;
const cellW = WHOLE + GAP + NEAR + GAP + FAR + GAP * 2, cellH = WHOLE + TEXT + GAP;
const out = resolve("var/orb");
mkdirSync(out, { recursive: true });
const sheetW = cellW * 6, sheetH = cellH * ORB_SCENES.length;
const sheet = new Uint8ClampedArray(sheetW * sheetH * 4).fill(255);
for (let i = 0; i < sheet.length; i += 4) sheet[i] = sheet[i + 1] = sheet[i + 2] = 24;

// The storm's lit moments are found on the clock: the eye's strike by the lane, its own lightning between strikes.
const storm = ORB_SCENES.indexOf("storm");
/** Whether the eye is striking hard on the side of the ball seen from the south. */
const struckSouth = (): boolean => frame[ORB_AT + 23]! > 0.7 && strikeAt(frame[ORB_AT + 24]!)[2]! < -0.5;
MOMENTS.storm[2]!.seconds = seek(storm, 23, at(14), struckSouth);
MOMENTS.storm[3]!.seconds = seek(storm, 23, MOMENTS.storm[2]!.seconds + 1, struckSouth);
MOMENTS.storm[1]!.seconds = at(60.3) + 2.3;

ORB_SCENES.forEach((scene, s) => {
  MOMENTS[scene].forEach((m, k) => {
    const left = k * cellW + GAP, top = s * cellH + TEXT;
    words(sheet, sheetW, left, top - TEXT + 2, `${scene}: ${m.label}`);
    // The whole ball from 400 m; its skin from 25 m off its foot, where a puck is some four pixels; and the ball 40 pixels across.
    view(sheet, sheetW, left, top, WHOLE, WHOLE, s, m, 400, 2 * Math.asin(78 / 400) * (WHOLE / 220));
    view(sheet, sheetW, left + WHOLE + GAP, top, NEAR, NEAR, s, m, 78 + 25, 0.7);
    view(sheet, sheetW, left + WHOLE + GAP + NEAR + GAP, top, FAR, FAR, s, m, 400, 2 * Math.asin(78 / 400) * (FAR / 40));
  });
  const strip = new Uint8ClampedArray(sheetW * cellH * 4);
  strip.set(sheet.subarray(s * cellH * sheetW * 4, (s + 1) * cellH * sheetW * 4));
  writeFileSync(resolve(out, `${scene}.png`), encodePng(sheetW, cellH, strip));
});
const path = resolve(out, "sheet.png");
writeFileSync(path, encodePng(sheetW, sheetH, sheet));
console.log(path);
