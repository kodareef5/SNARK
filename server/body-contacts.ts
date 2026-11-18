// Only controlled ground movers meet adult stationary creatures they were actually sent. AI never calls this path.
import { ACT_NONE } from "../shared/sim/weapon.ts";
import { AnimState } from "../shared/anim/pose.ts";
import { TICK_DT } from "../shared/coords.ts";
import { makeHandle } from "../shared/ids.ts";
import { dequantX, dequantY, quantX, quantY, type SentView, type ViewRing } from "../shared/net/view.ts";
import { stoodInViews } from "../shared/net/body-contact.ts";
import { GroundBodies, groundContactReach, groundBlockingActive, groundBodyTeamBlocks } from "../shared/sim/body-contact.ts";
import { MODE_WALK, stanceHeight, type Body, type MoveParams } from "../shared/sim/character.ts";
import { F_ALIVE, F_GROUNDED, F_HELD, F_PROP } from "../shared/sim/entities.ts";
import type { ServerWorld } from "./world.ts";
export class BodyContacts {
  pve: () => boolean = () => false;
  private readonly bodies = new GroundBodies();
  private readonly pose = new AnimState();
  private readonly world: ServerWorld;
  constructor(world: ServerWorld) { this.world = world; }
  prepare(entity: number, body: Body, params: MoveParams, view: SentView | null, team: number, moveX: number, moveZ: number, buttons: number, history: ViewRing<SentView>): GroundBodies | undefined {
    const { bodies, world, pose } = this, ents = world.ents; bodies.reset();
    if (!view || entity < 0 || !groundBlockingActive(body, moveX, moveZ, buttons)) return;
    const travel = groundContactReach(body, params, TICK_DT), pve = this.pve();
    for (let i = 0; i < view.count; i++) {
      const e = view.id[i]!, kind = view.kind[i]!, move = world.reg.move[kind], def = world.reg.defs[kind];
      if (e === entity || ents.gen[e] !== view.gen[i] || ents.kind[e] !== kind || ents.rev[e] !== view.rev[i] ||
        !move || def?.type !== "species" || def.class !== "creature" || world.reg.vehicle[kind]) continue;
      const x = dequantX(view.qx[i]!), y = dequantY(view.qy[i]!), z = dequantX(view.qz[i]!);
      const dx = x - body.x, dz = z - body.z, reach = travel + params.radius + move.radius;
      if (dx * dx + dz * dz > reach * reach) continue;
      // A deferred old pose, a moving/occupied target, or unseen ownership must not make a hidden wall.
      if ((ents.flags[e]! & (F_ALIVE | F_GROUNDED | F_HELD | F_PROP)) !== (F_ALIVE | F_GROUNDED) ||
        ents.mode[e] !== MODE_WALK || ents.seat[e] !== 0 || ents.driven[e] !== 0 || ents.grown[e] !== 0 ||
        ents.vx[e] !== 0 || ents.vy[e] !== 0 || ents.vz[e] !== 0 ||
        quantX(ents.x[e]!) !== view.qx[i] || quantY(ents.y[e]!) !== view.qy[i] || quantX(ents.z[e]!) !== view.qz[i] ||
        !groundBodyTeamBlocks(team, ents.team[e]!, pve)) continue;
      pose.unpack(view.anim[i]!, view.cue[i]!);
      if (!pose.grounded || pose.mode !== MODE_WALK || pose.speed !== 0 || (pose.action & 7) !== ACT_NONE || pose.out || pose.dead || pose.held) continue;
      pose.unpack(ents.anim[e]!, ents.cue[e]!);
      if (pose.speed !== 0 || (pose.action & 7) !== ACT_NONE || pose.out || pose.dead || pose.held) continue;
      if (!stoodInViews(view, i, history)) continue;
      bodies.add(makeHandle(e, ents.gen[e]!), x, y, z, move.radius, stanceHeight(move, pose.stance));
    }
    return bodies.allowEscape(world, body, params) ? bodies : undefined;
  }
}
