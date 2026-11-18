// The same visible, stationary adult proxies as authority. Moving neighbours and owned/protected bodies yield.
import { ACT_NONE } from "../../shared/sim/weapon.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { TICK_DT } from "../../shared/coords.ts";
import { makeHandle } from "../../shared/ids.ts";
import { dequantX, dequantY, type EntityView, type ViewRing } from "../../shared/net/view.ts";
import { stoodInViews } from "../../shared/net/body-contact.ts";
import { GroundBodies, groundContactReach, groundBlockingActive, groundBodyTeamBlocks } from "../../shared/sim/body-contact.ts";
import { MODE_WALK, stanceHeight, type Body, type MoveParams } from "../../shared/sim/character.ts";
import type { CollisionWorld } from "../../shared/world/collide.ts";
export class BodyContactView {
  private readonly bodies = new GroundBodies();
  private readonly pose = new AnimState();
  private readonly occupied = new Set<number>();
  private occupiedTick = -1;
  private readonly reg: Registry;
  constructor(reg: Registry) { this.reg = reg; }
  prepare(view: EntityView | null, own: number, driving: number, body: Body, params: MoveParams, world: CollisionWorld, team: number, pve: boolean, moveX: number, moveZ: number, buttons: number, history: ViewRing<EntityView>): GroundBodies | undefined {
    const { bodies, reg, pose } = this; bodies.reset();
    if (!view || !groundBlockingActive(body, moveX, moveZ, buttons)) return;
    if (this.occupiedTick !== view.tick) {
      this.occupiedTick = view.tick; this.occupied.clear();
      for (let i = 0; i < view.count; i++) if (view.seat[i]! > 0) this.occupied.add(makeHandle(view.seat[i]! - 1, view.seatGen[i]!));
    }
    const travel = groundContactReach(body, params, TICK_DT);
    for (let i = 0; i < view.count; i++) {
      const id = view.id[i]!, handle = makeHandle(id, view.gen[i]!), kind = view.kind[i]!, move = reg.move[kind], def = reg.defs[kind];
      if (handle === own || id === driving || !move || def?.type !== "species" || def.class !== "creature" || reg.vehicle[kind]) continue;
      const x = dequantX(view.qx[i]!), y = dequantY(view.qy[i]!), z = dequantX(view.qz[i]!);
      const dx = x - body.x, dz = z - body.z, reach = travel + params.radius + move.radius;
      if (dx * dx + dz * dz > reach * reach) continue;
      if ((view.flags[i]! & 9) !== 1 || view.seat[i] !== 0 || this.occupied.has(handle) || view.grown[i] !== 0 ||
        !groundBodyTeamBlocks(team, view.team[i]!, pve)) continue;
      pose.unpack(view.anim[i]!, view.cue[i]!);
      if (!pose.grounded || pose.mode !== MODE_WALK || pose.speed !== 0 || (pose.action & 7) !== ACT_NONE || pose.out || pose.dead || pose.held) continue;
      if (!stoodInViews(view, i, history)) continue;
      bodies.add(handle, x, y, z, move.radius, stanceHeight(move, pose.stance));
    }
    return bodies.allowEscape(world, body, params) ? bodies : undefined;
  }
}
