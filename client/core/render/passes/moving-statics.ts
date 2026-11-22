// The map's statics that move when used (../motion.ts): a yacht's sails and rig, a bridge's leaves. Each part is a draw on
// one bone, posed while it moves and as it was while it rests.

import { MAX_MOVING_REACH, type Registry } from "../../../../shared/content/registry.ts";
import type { MapStatics } from "../../../../shared/world/mapfile.ts";
import type { Assets } from "../../assets/assets.ts";
import type { FarLandmarks } from "../farlandmarks.ts";
import { PART_FLOATS, movingOf, poseMoving, type Moving } from "../motion.ts";
import { BONE_FLOATS, DRAW_BLEND, DRAW_SKINNED, FRAME, MAX_BONES, MAX_DRAWS, TRANSIENT_BUFFER } from "../packet.ts";
import type { Frame, Pass } from "../pass.ts";

export class MovingStatics implements Pass {
  /** The registry where it has moving statics, else null, and those of the map once its statics have come. */
  private readonly reg: Registry | null;
  private from: MapStatics | null = null;
  private moving: Moving[] = [];
  /** The map's landmarks' far meshes, once the far city has made them: a part at rest is struck where one stands for it. */
  landmarks: FarLandmarks | null = null;
  private readonly radius: Float32Array;
  private readonly flatFlags: Uint16Array;
  private readonly landmarkKinds: Uint8Array;

  /** `flatFlags` are the scene's per mesh, and `landmarkKinds` 1 for each kind a landmark brings. */
  constructor(reg: Registry, assets: Assets, flatFlags: Uint16Array, landmarkKinds: Uint8Array) {
    this.reg = reg.motion.some((t) => t !== null) ? reg : null;
    this.radius = assets.table.radius;
    this.flatFlags = flatFlags;
    this.landmarkKinds = landmarkKinds;
  }

  /**
   * The map's moving statics' parts, to their own reach: posed while they move, and as they were while they rest. A
   * landmark's are drawn as far as its far mesh, the far city's reach, so its sails do not end before its hull; but a
   * part at rest struck, a sail furled, only while the near store holds its static's chunk, and past that the far mesh
   * stands for it. A part that never moves, a landmark's rig, is never struck, nor is a see-through one, a line that does
   * not break into dots: a headsail's roll. A part put away where it rests is not drawn. Low poly draws no see-through part.
   */
  draw(f: Frame): void {
    const source = f.world.motion;
    if (!source || !this.reg) return;
    const p = f.packet, cam = f.cam, tier = f.tier, table = f.assets.table;
    const statics = source.statics();
    if (statics !== this.from) {
      this.from = statics;
      this.moving = statics ? movingOf(this.reg, statics) : [];
    }
    const own = Math.min(f.view, tier.reach.parts), landmark = Math.min(f.view, Math.max(tier.reach.parts, f.alongGround(tier.reach.city)));
    const states = source.states(), tick = source.tick();
    const bones = Math.min(tier.bones, MAX_BONES), draws = Math.min(MAX_DRAWS, tier.budget.draws);
    for (const t of this.moving) {
      const ours = this.landmarkKinds[t.kind] === 1;
      const x = t.x - cam.x, y = t.y - cam.y, z = t.z - cam.z;
      if (Math.sqrt(x * x + y * y + z * z) > (ours ? landmark : own) + MAX_MOVING_REACH) continue;
      poseMoving(t, states.get(t.ref), tick);
      const reach = ours ? landmark : own, struck = ours && t.progress === 0 && this.landmarks?.isFar(Math.floor(t.ref / 65536));
      const parts = t.facet.parts, pose = t.pose;
      for (let i = 0; i < parts.length; i++) {
        const mesh = table.find(parts[i]!.mesh);
        if (mesh < 0) {
          p.skipped++;
          continue;
        }
        const through = (this.flatFlags[mesh]! & DRAW_BLEND) !== 0;
        if ((struck && t.fixed[i] === 0 && !through) || (!tier.lit && through) || (t.progress === 0 && (t.away[i]! & 1) !== 0) || (t.progress === 1 && (t.away[i]! & 2) !== 0)) continue;
        const at = i * PART_FLOATS, r = this.radius[mesh]! * pose[at + 12]!;
        const cx = x + pose[at + 3]!, cy = y + pose[at + 7]!, cz = z + pose[at + 11]!;
        const far = Math.max(0, Math.sqrt(cx * cx + cy * cy + cz * cz) - r);
        if (far > reach) continue;
        const seen = cam.boxVisible(cx - r, cy - r, cz - r, cx + r, cy + r, cz + r);
        // A see-through part, a rig of wires drawn wider and fainter than they are, casts nothing: no cascade holds a wire's
        // shadow whole, and the sun's own breadth all but washes it out a few metres down.
        const casts = f.casting.on && !through ? f.casting.castBox(cx - r, cy - r, cz - r, cx + r, cy + r, cz + r) & f.casting.cascades.fits(r) : 0;
        if (!seen && casts === 0) continue;
        if (p.boneCount >= bones || p.transientCount === p.transientIds.length || (seen && p.drawCount + f.put.doubled >= draws)) {
          p.dropped++;
          continue;
        }
        const bone = p.boneCount++, b = bone * BONE_FLOATS;
        for (let k = 0; k < BONE_FLOATS; k++) p.bones[b + k] = pose[at + k]!;
        p.bones[b + 3] = cx;
        p.bones[b + 7] = cy;
        p.bones[b + 11] = cz;
        const first = p.transientCount++;
        f.transient.setSkinned(first, bone, t.color);
        p.transientIds[first] = 0;
        const level = f.assets.choose(table.error[mesh]!, far, t.level[i]!);
        t.level[i] = level;
        f.assets.wantTextured(mesh, level, far);
        if (seen) {
          const d = p.drawCount;
          f.put.draw(mesh, level, TRANSIENT_BUFFER, first, 1, 0, 0, 0, DRAW_SKINNED, cam.passes(cx - r, cy - r, cz - r, cx + r, cy + r, cz + r));
          f.put.boxRows(d, p.drawCount, cx - r, cy - r, cz - r, cx + r, cy + r, cz + r);
          for (let k = d; k < p.drawCount; k++) p.drawFade[k] = reach;
          p.frame[FRAME.fade] = tier.fade;
        }
        if (casts !== 0) f.casting.castBody(mesh, level, first, 1, DRAW_SKINNED, casts, 0);
      }
    }
  }
}
