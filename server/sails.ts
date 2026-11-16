// Public moored-landmark controls. Only command and endpoint changes are saved/sent; geometry stays static.
import { RESULT_DENIED, RESULT_FAR, RESULT_OK, SESSION_ALIVE, S_SAILS } from "../shared/net/protocol.ts";
import type { Connection } from "../shared/net/transport.ts";
import { stanceEye } from "../shared/sim/character.ts";
import { decodeSailTransition, encodeSailTransition, MAX_SAIL_GROUPS, sailTransition, sailsProgress, writeSails, type SailState } from "../shared/sim/sails.ts";
import { frameAxes, HALF_SIDE } from "../shared/world/frame.ts";
import { castWorld, HIT_STRUCTURE, lookDirection, rayHit } from "../shared/world/ray.ts";
import { REACH } from "./death.ts";
import type { Fixtures } from "./fixtures.ts";
import type { Client, GameServer } from "./game.ts";
import type { Records } from "./records.ts";
import type { ServerWorld } from "./world.ts";

export const SAIL_COMPONENT = 0x736169;

export class Sails {
  private readonly world: ServerWorld;
  private readonly records: Records;
  private readonly fixtures: Fixtures;
  private readonly game: GameServer;
  private readonly state = new Map<number, SailState>();
  private readonly unread = new Set<number>();
  private readonly sent = new WeakMap<Connection, number>();
  private readonly changedChunks = new Set<number>();
  private readonly active = new Set<number>();
  private readonly aim = new Float64Array(3);
  private readonly axes = new Int32Array(4);
  private snapshot: readonly SailState[] = [];
  private version = 1;

  constructor(world: ServerWorld, records: Records, fixtures: Fixtures, game: GameServer) {
    this.world = world; this.records = records; this.fixtures = fixtures; this.game = game;
    world.structs.chunks.forEach((t, chunk) => { if (t) this.refresh(chunk); });
    const previous = world.structs.onChunkChanged;
    world.structs.onChunkChanged = (chunk, healthOnly) => {
      previous?.(chunk, healthOnly);
      if (!healthOnly) this.changedChunks.add(chunk);
    };
    this.publish();
  }

  /** Stable collection at authority changes; frame is the yacht datum in metres/native yaw. */
  states(): readonly SailState[] { return this.snapshot; }

  private refresh(chunk: number): boolean {
    const t = this.world.structs.chunks[chunk], live = new Set<number>();
    let changed = false;
    if (t) for (let slot = 0; slot < t.high; slot++) {
      const kind = t.kind[slot]!, control = this.world.reg.sails[kind];
      if (!control) continue;
      const ref = chunk * 65536 + slot, known = this.state.get(ref);
      live.add(ref);
      const yaw = (t.yaw[slot]! - control.yaw) & 65535;
      frameAxes(yaw, this.axes);
      const x = t.x[slot]! - (control.at[0] * this.axes[0]! + control.at[2] * this.axes[2]!) / HALF_SIDE;
      const y = t.y[slot]! - control.at[1];
      const z = t.z[slot]! - (control.at[0] * this.axes[1]! + control.at[2] * this.axes[3]!) / HALF_SIDE;
      if (known && known.kind === kind && known.x === x && known.y === y && known.z === z && known.yaw === yaw) continue;
      const bytes = this.fixtures.find(ref)?.extra.get(SAIL_COMPONENT), saved = bytes ? decodeSailTransition(bytes) : null;
      if (bytes && !saved) this.unread.add(ref); else this.unread.delete(ref);
      const state = Object.freeze({ ref, kind, x, y, z, yaw, ...(saved ?? sailTransition(0, 0, this.world.tick)) });
      this.state.set(ref, state);
      changed = true;
      if (state.from !== state.target) this.active.add(ref); else this.active.delete(ref);
    }
    for (const ref of this.state.keys()) if (Math.floor(ref / 65536) === chunk && !live.has(ref)) {
      this.state.delete(ref); this.active.delete(ref); this.unread.delete(ref);
      changed = true;
    }
    if (this.state.size > MAX_SAIL_GROUPS) throw new Error(`Map exceeds ${MAX_SAIL_GROUPS} independent sail controls`);
    return changed;
  }

  private publish(): void { this.snapshot = Object.freeze([...this.state.values()]); this.version++; }

  private save(state: SailState): void {
    this.state.set(state.ref, state);
    const rec = this.fixtures.ensure(state.ref);
    rec.extra.set(SAIL_COMPONENT, encodeSailTransition(state)); this.records.dirty.add(rec.pid);
    if (state.from === state.target) this.active.delete(state.ref); else this.active.add(state.ref);
  }

  /** Also clears removed controllers. Endpoint canonicalization makes completed state independent of tick wrap. */
  step(): void {
    let changed = false;
    for (const chunk of this.changedChunks) changed = this.refresh(chunk) || changed;
    this.changedChunks.clear();
    for (const ref of this.active) {
      const s = this.state.get(ref)!;
      if (sailsProgress(s, this.world.tick) !== s.target) continue;
      this.save(Object.freeze({ ...s, ...sailTransition(s.target, s.target, this.world.tick) })); changed = true;
    }
    if (changed) this.publish();
  }

  /** Both the ordinary E ray and explicit structure-use commands must hit this actual control within normal reach. */
  use(c: Client, ref: number): number {
    this.step();
    const s = this.state.get(ref);
    if (!s) return -1;
    const rec = this.records.byPid.get(c.pid), ents = this.world.ents;
    if (!rec || rec.out || rec.dead || c.closed || c.state !== SESSION_ALIVE || c.ent < 0 || this.unread.has(ref)) return RESULT_DENIED;
    const move = this.world.reg.move[ents.kind[c.ent]!]!;
    lookDirection(c.heldYaw, c.heldPitch, this.aim);
    if (castWorld(this.world, ents.x[c.ent]!, ents.y[c.ent]! + stanceEye(move, ents.stance[c.ent]!), ents.z[c.ent]!,
      this.aim[0]!, this.aim[1]!, this.aim[2]!, REACH) !== HIT_STRUCTURE || rayHit.ref !== ref) return RESULT_FAR;
    const from = sailsProgress(s, this.world.tick), target = s.target === 1 ? 0 : 1;
    this.save(Object.freeze({ ...s, ...sailTransition(from, target, this.world.tick) })); this.publish();
    return RESULT_OK;
  }

  /** Full replacement on connection/change, including distant yachts and an empty collection after removal. */
  sync(c: Client): void {
    if (this.sent.get(c.conn) === this.version) return;
    const w = this.game.begin(S_SAILS); writeSails(w, this.snapshot);
    if (w.overflow) throw new Error("Sail scene exceeds reliable message capacity");
    this.game.endOwn(c); this.sent.set(c.conn, this.version);
  }
}
