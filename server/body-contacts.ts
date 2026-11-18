// Ground creature interactions use the existing entity chunk lists. Every target stays fixed during this controller step;
// neither a friendly/PvE target nor any other player receives a velocity or positional shove.
import { CUE_DEAD } from "../shared/anim/pose.ts";
import { CHUNK_SIZE, TICK_DT } from "../shared/coords.ts";
import { makeHandle } from "../shared/ids.ts";
import { dequantX, dequantY, quantX, quantY } from "../shared/net/view.ts";
import { GroundBodies, groundContactReach } from "../shared/sim/body-contact.ts";
import { MODE_WALK, stanceHeight, type Body, type MoveParams } from "../shared/sim/character.ts";
import { F_ALIVE, F_GROUNDED, F_HELD, F_PROP } from "../shared/sim/entities.ts";
import type { ServerWorld } from "./world.ts";
import type { BodyGrid } from "./bodies.ts";
export class BodyContacts {
  readonly stats = { scanned: 0, candidates: 0 };
  /** Existing AI grid, filled lazily from active survivors/tames. Wild movement never queries other wild bodies. */
  claimed: (() => BodyGrid) | null = null;
  private readonly bodies = new GroundBodies();
  private readonly world: ServerWorld;
  private readonly creature: Uint8Array;
  private readonly reach: number;
  constructor(world: ServerWorld) {
    this.world = world; this.creature = new Uint8Array(world.reg.defs.length); let reach = 0;
    for (let kind = 1; kind < world.reg.defs.length; kind++) {
      const def = world.reg.defs[kind];
      this.creature[kind] = def?.type === "species" && def.class === "creature" && !world.reg.vehicle[kind] ? 1 : 0;
      if (!world.reg.vehicle[kind]) reach = Math.max(reach, world.reg.move[kind]?.radius ?? 0);
    }
    this.reach = reach;
  }
  prepare(entity: number, body: Body, params: MoveParams): GroundBodies | undefined {
    const { bodies, world } = this, ents = world.ents; bodies.reset(); this.stats.scanned = this.stats.candidates = 0;
    if (body.mode !== MODE_WALK || entity < 0) return;
    const ownCreature = this.creature[body.kind] !== 0;
    const travel = groundContactReach(body, params, TICK_DT);
    const pad = travel + params.radius + this.reach;
    if (ownCreature && ents.team[entity] === 0) {
      const grid = this.claimed?.();
      if (!grid) return;
      // The AI index is filled once per tick. A tame stepped earlier may cross a cell edge; native substeps plus static
      // separation bound that movement by sixteen of its radii. Use its live pose below, never the indexed pose for contact.
      const count = grid.near(body.x, body.z, pad + this.reach * 16);
      for (let i = 0; i < count; i++) {
        const e = grid.found[i]!;
        if (ents.team[e] !== 0 || !this.creature[ents.kind[e]!]) this.add(e, entity, body, params, ownCreature, travel);
      }
      this.stats.candidates = bodies.count;
      return bodies.count > 0 ? bodies : undefined;
    }
    const x0 = Math.max(0, Math.floor((body.x - pad) / CHUNK_SIZE)), x1 = Math.min(world.dims.chunksX - 1, Math.floor((body.x + pad) / CHUNK_SIZE));
    const z0 = Math.max(0, Math.floor((body.z - pad) / CHUNK_SIZE)), z1 = Math.min(world.dims.chunksZ - 1, Math.floor((body.z + pad) / CHUNK_SIZE));
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) for (let e = ents.chunkHead[z * world.dims.chunksX + x]!; e >= 0; e = ents.next[e]!) {
      this.add(e, entity, body, params, ownCreature, travel);
    }
    this.stats.candidates = bodies.count;
    return bodies.count > 0 ? bodies : undefined;
  }
  private add(e: number, entity: number, body: Body, params: MoveParams, ownCreature: boolean, travel: number): void {
    const { world, bodies } = this, ents = world.ents; this.stats.scanned++;
    if (e === entity || (ents.flags[e]! & (F_ALIVE | F_GROUNDED | F_HELD | F_PROP)) !== (F_ALIVE | F_GROUNDED) || ents.mode[e] !== MODE_WALK || (ents.cue[e]! & CUE_DEAD) !== 0) return;
    const kind = ents.kind[e]!, move = world.reg.move[kind];
    if (!move || world.reg.vehicle[kind] || !ownCreature && !this.creature[kind]) return;
    const parent = ents.seat[e]! - 1;
    if (parent >= 0 && ents.gen[parent] === ents.seatGen[e] && (ents.flags[parent]! & F_ALIVE) !== 0) return;
    const dx = ents.x[e]! - body.x, dz = ents.z[e]! - body.z, reach = travel + params.radius + move.radius;
    if (dx * dx + dz * dz > reach * reach) return;
    // Use the public capsule lattice on both sides. Exact private f32 centres would cause repeated millimetre corrections
    // against an entirely stationary neighbour; this changes only our contact proxy, never its authoritative position.
    bodies.add(makeHandle(e, ents.gen[e]!), dequantX(quantX(ents.x[e]!)), dequantY(quantY(ents.y[e]!)), dequantX(quantX(ents.z[e]!)), move.radius, stanceHeight(move, ents.stance[e]!));
  }
}
