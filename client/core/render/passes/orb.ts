// The orbs (shared/world/orb.ts): each a shell whose skin is a screen, on a plinth. The map head places a site once, so
// it is drawn at any distance, whatever chunks a client holds. What the screen shows is the frame block's (../orb.ts
// writeOrb), which holds one orb, the nearest: its shell is the screen, and any other's is drawn as plain steel.

import type { OrbSite } from "../../../../shared/world/orb.ts";
import { SIZE_UNITS } from "../../../../shared/world/nodes.ts";
import type { Assets } from "../../assets/assets.ts";
import { ORB_FAR, ORB_SHELL, nearestOrb } from "../orb.ts";
import { BONE_FLOATS, DRAW_ORB, DRAW_PLAIN, DRAW_SIZED, DRAW_SKINNED, MAX_BONES, MAX_DRAWS, TRANSIENT_BUFFER } from "../packet.ts";
import type { Frame, Pass } from "../pass.ts";

export class Orbs implements Pass {
  /** The shell, made ORB_SHELL in radius about the ball's centre, and the plinth, made about the ground under its axis. Under 0 while the art has none. */
  private readonly shell: number;
  private readonly plinth: number;

  constructor(assets: Assets) {
    this.shell = assets.table.find("core:orb/shell");
    this.plinth = assets.table.find("core:orb/plinth");
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
    f.put.draw(mesh, level, TRANSIENT_BUFFER, first, 1, 0, 0, 0, flags, cam.passes(x - r, y - r, z - r, x + r, y + r, z + r));
  }
}
