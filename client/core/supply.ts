// The supply drops as a client draws them (planning/workstreams/supply.md), from the list the server tells every
// session (S_SUPPLY) and the pose every party works out from a drop's ticks (shared/sim/supply.ts): a shaft where each
// will land or has landed, in its tier's colour and seen from any distance, and its capsule while it flies, brakes and
// leaves. A landed capsule within sight is the server's own prop, which the scene draws as it draws any.
//
// This is the flat path: a column and a box. The capsule's model and the shaft's light take its place where the
// renderer can draw them.

import { TICK_RATE } from "../../shared/coords.ts";
import type { Registry } from "../../shared/content/registry.ts";
import type { Pack } from "../../shared/pack/pack.ts";
import { defaultPalette, nearestColour } from "../../shared/pack/palette.ts";
import { POSE_BRAKING, POSE_COMING, POSE_FLYING, POSE_GONE, POSE_LANDED, POSE_LEAVING, newPose, supplyPose, type SupplyList, type SupplyRow } from "../../shared/sim/supply.ts";
import { Assets } from "./assets/assets.ts";
import type { Camera } from "./render/camera.ts";
import type { Characters } from "./render/characters.ts";
import type { FramePacket } from "./render/packet.ts";

/** Metres the shaft stands, and its width at hand. */
export const SHAFT_HEIGHT = 600;
export const SHAFT_WIDTH = 0.7;
/** The width it is never thinner than, as a share of its distance: about two pixels of a screen 1,080 high. */
const SHAFT_FLOOR = 0.002;
/** Metres from the eye past which the capsule in flight is drawn as large as it must be to be a few pixels. */
const BOX_FLOOR = 0.004;
/** Metres within which a landed capsule is the server's prop, which the scene draws: the bodies a session is sent. */
const PROP_RANGE = 150;

export class SupplyView {
  /** The drops as last told, and the tick to draw them at. The app sets both. */
  list: SupplyList | null = null;
  tick = 0;
  /** How many shafts and capsules the last frame drew. */
  shafts = 0;
  capsules = 0;
  /** The scene draws the capsules from their model (render/scene.ts showSupply), and this the shafts alone. */
  modelled = false;
  private readonly box: number;
  private readonly beam: number;
  private readonly palette = defaultPalette();
  private readonly tints = new Map<number, number>();
  private readonly pose = newPose();

  constructor(reg: Registry, pack: Pack) {
    const { table } = new Assets(reg, pack);
    this.box = table.find("core:supply_box");
    this.beam = table.find("core:supply_beam");
  }

  /** The palette colour nearest a tier's. */
  private tint(rgb: number): number {
    let at = this.tints.get(rgb);
    if (at === undefined) this.tints.set(rgb, (at = nearestColour(this.palette, (rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255)));
    return at;
  }

  /** What a drop is doing at the tick it is drawn at: a POSE_. */
  stateOf(row: SupplyRow): number {
    return supplyPose(row, this.tick, TICK_RATE, this.pose).state;
  }

  draw(ch: Characters, p: FramePacket, cam: Camera): void {
    // Where the pack has the capsule's model the scene draws it all, shafts too (render/scene.ts showSupply).
    if (this.modelled) return;
    this.shafts = this.capsules = 0;
    const list = this.list;
    if (!list || this.beam < 0) return;
    const pose = this.pose;
    for (const row of list.rows) {
      supplyPose(row, this.tick, TICK_RATE, pose);
      if (pose.state === POSE_GONE) continue;
      const tint = this.tint(list.tiers[row.tier]?.rgb ?? 0xffffff);
      const x = row.x - cam.x;
      const y = row.y - cam.y;
      const z = row.z - cam.z;
      const far = Math.hypot(x, z);
      // The shaft: thinner as it comes up and as it goes, and never under two pixels wide.
      if (pose.shaft > 0.02) {
        const wide = Math.max(SHAFT_WIDTH, far * SHAFT_FLOOR) * pose.shaft;
        if (cam.boxVisible(x - wide, y, z - wide, x + wide, y + SHAFT_HEIGHT, z + wide)) {
          if (!ch.loose(p, this.beam, x, y, z, 0, 1, 0, SHAFT_HEIGHT, wide, tint)) return;
          this.shafts++;
        }
      }
      // The capsule: in the air, and on the ground where the server's prop is not in sight to be drawn.
      if (this.box < 0 || pose.state === POSE_COMING) continue;
      if (pose.state === POSE_LANDED && Math.hypot(x, y, z) < PROP_RANGE) continue;
      const cx = pose.x - cam.x;
      const cy = pose.y - cam.y;
      const cz = pose.z - cam.z;
      const size = Math.max(1, (Math.hypot(cx, cy, cz) * BOX_FLOOR) / 2.2);
      if (!cam.boxVisible(cx - size, cy, cz - size, cx + size, cy + 2.4 * size, cz + size)) continue;
      if (!ch.loose(p, this.box, cx, cy, cz, 0, 1, 0, size, size, tint)) return;
      this.capsules++;
    }
  }
}

export { POSE_BRAKING, POSE_FLYING, POSE_LANDED, POSE_LEAVING };
