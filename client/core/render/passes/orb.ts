// The orbs (shared/world/orb.ts): each a shell whose skin is a screen, on a plinth. The map head places a site once, so
// it is drawn at any distance, whatever chunks a client holds. What the screen shows is the frame block's (../orb.ts
// writeOrb), which holds one orb, the nearest: its shell is the screen, and any other's is drawn as plain steel.
//
// By night the nearest lights what is round it (../orb.ts OrbCast): a halo in the haze about it here, and the ground
// and what stands on it in the lit programs (../orb-light.ts). Low poly, which lights nothing, has the halo alone: a
// flat sheet of light on the ground, as this drew once, lay under the ground on one side of a ball and over it on the other.

import type { OrbSite } from "../../../../shared/world/orb.ts";
import { SIZE_UNITS } from "../../../../shared/world/nodes.ts";
import type { Assets } from "../../assets/assets.ts";
import { HAZE_DENSITY, HAZE_HEIGHT, hazeAmount } from "../atmosphere.ts";
import { linearToSrgb } from "../color-space.ts";
import { ORB_FAR, ORB_SHELL, OrbCast, nearestOrb } from "../orb.ts";
import { BONE_FLOATS, DETAIL, DETAIL_GLOW, DRAW_ORB, DRAW_PLAIN, DRAW_SIZED, DRAW_SKINNED, FRAME, GLOW_STEPS, MAX_BONES, MAX_DRAWS, ORB_AT, TRANSIENT_BUFFER } from "../packet.ts";
import type { Frame, Pass } from "../pass.ts";
import { VehicleCards } from "../vehicle-cards.ts";

/**
 * The halo: a card about the ball's middle across the view, HALO_SIZE radii across its half with no haze between and
 * HALO_GROWS more with all of it. It shows HALO_SHOWS of the light's brightness, of which HALO_NEAR with no haze between
 * and the rest by the haze, so across the map the ball stands in a dome of light.
 */
export const HALO_SIZE = 2.2, HALO_GROWS = 4;
export const HALO_SHOWS = 5, HALO_NEAR = 0.08;

/** The card of the light the nearest orb casts: light with no surface, added over what is behind it (packet.ts DETAIL_GLOW). */
class OrbCards extends VehicleCards {
  constructor() {
    super(1);
  }

  /** A card at (x, y, z) from the camera with half axes along and across it, in the colour `tint` (RGBA bytes), `shows` of 255 at its middle. */
  card(x: number, y: number, z: number, lx: number, ly: number, lz: number, ax: number, ay: number, az: number, tint: number, shows: number): void {
    if (shows < 1) return;
    const i = this.next(), card = this.cards;
    card[i] = x; card[i + 1] = y; card[i + 2] = z;
    card[i + DETAIL.along] = lx; card[i + DETAIL.along + 1] = ly; card[i + DETAIL.along + 2] = lz;
    card[i + DETAIL.across] = ax; card[i + DETAIL.across + 1] = ay; card[i + DETAIL.across + 2] = az;
    card[i + DETAIL.floor] = 0;
    this.words[i + DETAIL.colourA] = this.words[i + DETAIL.colourB] = tint;
    this.words[i + DETAIL.misc] = ((GLOW_STEPS << 24) | (Math.min(255, Math.round(shows)) << 16) | (DETAIL_GLOW << 8)) >>> 0;
  }
}

export class Orbs implements Pass {
  /** The shell, made ORB_SHELL in radius about the ball's centre, and the plinth, made about the ground under its axis. Under 0 while the art has none. */
  private readonly shell: number;
  private readonly plinth: number;
  /** The colour of the light the nearest orb casts, and its halo, which the scene draws among its details. */
  readonly cast = new OrbCast();
  readonly cards = new OrbCards();
  /** Whether the halo is drawn (passes.ts `orbglow`). */
  glow = true;

  constructor(assets: Assets) {
    this.shell = assets.table.find("core:orb/shell");
    this.plinth = assets.table.find("core:orb/plinth");
  }

  update(f: Frame): void {
    const frame = f.packet.frame, cards = this.cards, shown = this.cast.shown;
    this.cast.step(frame, f.now);
    cards.begin();
    const bright = Math.max(shown[0]!, shown[1]!, shown[2]!), radius = frame[ORB_AT + 3]!;
    if (!this.glow || bright <= 0) return;
    // The light's hue as the card's colour, and its brightness as how much of it shows.
    const tint = (Math.round(255 * linearToSrgb(shown[0]! / bright)) | (Math.round(255 * linearToSrgb(shown[1]! / bright)) << 8) | (Math.round(255 * linearToSrgb(shown[2]! / bright)) << 16) | (255 << 24)) >>> 0;
    const x = frame[ORB_AT]!, y = frame[ORB_AT + 1]!, z = frame[ORB_AT + 2]!, far = Math.hypot(x, y, z);
    if (far <= radius) return;
    const haze = hazeAmount(HAZE_DENSITY, HAZE_HEIGHT, frame[FRAME.eyeHeight]!, far, y / far);
    // The eye's right and up (camera.ts): the halo lies across the view at one depth, so it is in one depth range.
    const cam = f.cam, sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw), sp = Math.sin(cam.pitch), cp = Math.cos(cam.pitch);
    const size = radius * (HALO_SIZE + HALO_GROWS * haze);
    cards.card(x, y, z, -sy * sp * size, cp * size, -cy * sp * size, -cy * size, 0, sy * size, tint, 255 * Math.min(1, HALO_SHOWS * bright * (HALO_NEAR + haze)));
  }

  draw(f: Frame): void {
    const sites = f.world.orbs;
    if (!sites) return;
    const cam = f.cam, screen = nearestOrb(sites, cam.x, cam.y, cam.z);
    for (let i = 0; i < sites.length; i++) {
      const site = sites[i]!, scale = site.radius / ORB_SHELL;
      const x = site.x - cam.x, y = site.y - cam.y, z = site.z - cam.z;
      this.piece(f, site, this.shell, x, y + site.centre, z, site.radius, scale, i === screen ? DRAW_ORB : 0);
      if (this.plinth >= 0) this.piece(f, site, this.plinth, x, y, z, f.assets.table.radius[this.plinth]! * scale, scale, 0);
    }
  }

  /** One mesh of a site at `scale`, its origin at (x, y, z) from the camera and reaching `r` from it. */
  private piece(f: Frame, site: OrbSite, mesh: number, x: number, y: number, z: number, r: number, scale: number, flags: number): void {
    if (mesh < 0) return;
    const p = f.packet, cam = f.cam;
    if (!cam.boxVisible(x - r, y - r, z - r, x + r, y + r, z + r)) return;
    if (p.transientCount >= p.transientIds.length || p.drawCount + f.put.doubled >= MAX_DRAWS) return;
    // A size is a byte of SIZE_UNITS: a ball too big for one is sized by a bone.
    const boned = scale > 255 / SIZE_UNITS;
    if (boned && p.boneCount >= Math.min(p.tier.bones, MAX_BONES)) return;
    const first = p.transientCount++;
    const distance = Math.max(1, Math.hypot(x, y, z) - r);
    const errors = f.assets.table.error[mesh]!;
    const level = distance >= ORB_FAR ? Math.max(0, errors.length - 1) : f.assets.choose(errors, distance / scale, -1);
    // The screen is drawn flat; the plinth with its materials.
    if ((flags & DRAW_ORB) !== 0) f.assets.want(mesh, level, distance);
    else f.assets.wantTextured(mesh, level, distance);
    flags |= DRAW_PLAIN;
    if (boned) {
      const bone = p.boneCount++, pose = p.bones, row = bone * BONE_FLOATS;
      const yaw = (site.yaw * Math.PI) / 32768, c = Math.cos(yaw) * scale, s = Math.sin(yaw) * scale;
      pose[row] = c; pose[row + 1] = 0; pose[row + 2] = s; pose[row + 3] = x;
      pose[row + 4] = 0; pose[row + 5] = scale; pose[row + 6] = 0; pose[row + 7] = y;
      pose[row + 8] = -s; pose[row + 9] = 0; pose[row + 10] = c; pose[row + 11] = z;
      f.transient.setSkinned(first, bone, 0);
      flags |= DRAW_SKINNED;
    } else {
      f.transient.set(first, x, y, z, site.yaw, 0);
      if (scale !== 1) {
        f.transient.size(first, Math.round(scale * SIZE_UNITS));
        flags |= DRAW_SIZED;
      }
    }
    p.transientIds[first] = 0;
    const from = p.drawCount;
    f.put.draw(mesh, level, TRANSIENT_BUFFER, first, 1, 0, 0, 0, flags, cam.passes(x - r, y - r, z - r, x + r, y + r, z + r));
    // Its bounds, so that what hides it leaves it out (occlusion.ts) and its step draws it at its own depth.
    f.put.boxRows(from, p.drawCount, x - r, y - r, z - r, x + r, y + r, z + r);
  }
}
