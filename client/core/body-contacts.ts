// The local ground controller uses the latest qualified snapshot capsules. No remote position or velocity is changed.
// Stationary blockers predict directly; moving neighbours retain the ordinary snapshot-delay uncertainty.
import { AnimState } from "../../shared/anim/pose.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { TICK_DT } from "../../shared/coords.ts";
import { makeHandle } from "../../shared/ids.ts";
import { dequantX, dequantY, type EntityView } from "../../shared/net/view.ts";
import { GroundBodies, groundContactReach } from "../../shared/sim/body-contact.ts";
import { MODE_WALK, stanceHeight, type Body, type MoveParams } from "../../shared/sim/character.ts";
export class BodyContactView {
  private readonly bodies = new GroundBodies();
  private readonly pose = new AnimState();
  private readonly creature: Uint8Array;
  private readonly reg: Registry;
  constructor(reg: Registry) {
    this.reg = reg; this.creature = Uint8Array.from(reg.defs, (def, kind) => def?.type === "species" && def.class === "creature" && !reg.vehicle[kind] ? 1 : 0);
  }
  prepare(view: EntityView | null, own: number, driving: number, body: Body, params: MoveParams): GroundBodies | undefined {
    const { bodies, reg, pose } = this; bodies.reset();
    if (!view || body.mode !== MODE_WALK) return;
    const ownCreature = this.creature[body.kind] !== 0;
    const travel = groundContactReach(body, params, TICK_DT);
    for (let i = 0; i < view.count; i++) {
      const id = view.id[i]!, handle = makeHandle(id, view.gen[i]!), kind = view.kind[i]!, move = reg.move[kind];
      if (handle === own || id === driving || !move || reg.vehicle[kind] || !ownCreature && !this.creature[kind] || (view.flags[i]! & 1) === 0 || (view.flags[i]! & 8) !== 0) continue;
      pose.unpack(view.anim[i]!, view.cue[i]!); if (pose.dead || pose.held || pose.mode !== MODE_WALK) continue;
      const parent = view.seat[i]! - 1;
      if (parent >= 0) {
        let low = 0, high = view.count;
        while (low < high) { const mid = (low + high) >>> 1; if (view.id[mid]! < parent) low = mid + 1; else high = mid; }
        if (low < view.count && view.id[low] === parent && view.gen[low] === view.seatGen[i]) continue;
      }
      const x = dequantX(view.qx[i]!), y = dequantY(view.qy[i]!), z = dequantX(view.qz[i]!);
      const dx = x - body.x, dz = z - body.z, reach = travel + params.radius + move.radius;
      if (dx * dx + dz * dz > reach * reach) continue;
      bodies.add(handle, x, y, z, move.radius, stanceHeight(move, pose.stance));
    }
    return bodies.count > 0 ? bodies : undefined;
  }
}
