// The ball drawn by the twin (orb.ts orbLight, orbShown), pixel by pixel with no card: for the contact sheet
// (tools/orb/sheet.ts) and the Screens page's preview. The frame's lanes are written as a scene writes them.
import type { Tier } from "../assets/tiers.ts";
import type { SupplyList } from "../../../shared/sim/supply.ts";
import type { OrbSite } from "../../../shared/world/orb.ts";
import type { TideEyeSite } from "../../../shared/world/tide-eye.ts";
import { ORB_SCREEN, orbLight, orbShown, writeOrb, type OrbScreen } from "./orb.ts";
import { FRAME_FLOATS, ORB_AT } from "./packet.ts";
import { postFrame } from "./post.ts";
import { skyFrame, theSky } from "./sky.ts";

const RATE = 30;

/** A moment: the server's seconds and hour, the bearing the ball is seen from (0 from the north), and a drop in flight. */
export interface OrbMoment {
  readonly seconds: number;
  readonly hour: number;
  readonly from: number;
  readonly supply?: SupplyList | null;
}

export class OrbView {
  readonly frame = new Float32Array(FRAME_FLOATS);
  private readonly light = [0, 0, 0];
  private readonly hit = [0, 0, 0];

  readonly site: OrbSite;
  readonly eyes: readonly TideEyeSite[];
  readonly tier: Tier;
  readonly screen: OrbScreen;

  constructor(site: OrbSite, eyes: readonly TideEyeSite[], tier: Tier, screen: OrbScreen) {
    this.site = site;
    this.eyes = eyes;
    this.tier = tier;
    this.screen = screen;
  }

  /** The frame's lanes for a moment of scene `which`, the eye at (x, y, z). The screen scene is shown for good, with no wipe. */
  lanes(which: number, m: OrbMoment, x: number, y: number, z: number): void {
    const frame = this.frame;
    frame.fill(0);
    skyFrame(m.hour, theSky(), frame);
    postFrame(frame, this.tier, m.hour, 1080);
    const tick = Math.round(m.seconds * RATE), screen = which === ORB_SCREEN;
    writeOrb(frame, [this.site], this.eyes, m.seconds, m.hour, x, y, z, m.supply ?? null, tick, RATE, screen ? -1 : which, 1, screen ? this.screen : null);
    if (screen) frame[ORB_AT + 9] = ORB_SCREEN;
  }

  /**
   * A picture `w` by `h` into `pixels` (RGBA, `stride` pixels a row) at (left, top), of the ball from `distance` metres from
   * its axis on the moment's bearing, the eye `lift` metres up and aimed at its centre, `across` its angle of view.
   */
  view(pixels: Uint8ClampedArray, stride: number, left: number, top: number, w: number, h: number, which: number, m: OrbMoment, distance: number, across: number, lift = 2): void {
    const site = this.site, screen = this.screen, frame = this.frame, light = this.light, hit = this.hit;
    const ex = site.x + distance * Math.sin(m.from), ey = site.y + lift, ez = site.z + distance * Math.cos(m.from);
    const cx = site.x - ex, cy = site.y + site.centre - ey, cz = site.z - ez, r = site.radius, far = Math.hypot(cx, cy, cz);
    // The view's forward, right and up.
    const fx = cx / far, fy = cy / far, fz = cz / far;
    const rl = Math.hypot(fz, fx), rx = -fz / rl, rz = fx / rl;
    const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
    screen.upX = ux;
    screen.upY = uy;
    screen.upZ = uz;
    this.lanes(which, m, ex, ey, ez);
    const span = Math.tan(across / 2) / (w / 2);
    /** Where the ray through pixel (px, py) meets the shell, into `hit`; false where it misses or meets it under its cut. */
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
        orbLight(frame, x, y, z, wide, light, this.tier.orb.octaves, this.tier.orb.pucks);
        orbShown(pixels, light, frame, o);
      }
    }
  }
}
