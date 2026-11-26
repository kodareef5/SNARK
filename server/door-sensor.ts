import { SESSION_ALIVE } from "../shared/net/protocol.ts";
import { stanceEye } from "../shared/sim/character.ts";
import { Found } from "../shared/world/structures.ts";
import type { BuildContext } from "./build.ts";
import type { Client } from "./game.ts";

export const DOOR_REACH = 2;
/** Whether a body of `team` holds an opening of `owner`'s: its own tribe's does, and a stranger's is moved aside. */
export const holds = (team: number, owner: number): boolean => team !== 0 && team === owner;
interface Watch { gx: number; gy: number; gz: number; shapes: number; refs: number[] }

export class DoorSensor {
  private readonly ctx: BuildContext;
  private readonly closed: number;
  private readonly open: number;
  private readonly found = new Found(16);
  private readonly watches = new WeakMap<Client, Watch>();

  constructor(ctx: BuildContext, closed: number, open: number) {
    this.ctx = ctx;
    this.closed = closed;
    this.open = open;
  }

  visit(near: (ref: number, e: number, pid: number, x: number, y: number, z: number) => void): void {
    const { world, game, records, tribes } = this.ctx;
    const { structs, ents, reg } = world;
    for (const c of game.clients) {
      if (!c?.active || c.closed || c.ent < 0 || c.state !== SESSION_ALIVE) continue;
      const rec = records.byPid.get(c.pid);
      if (!rec || rec.out || rec.dead) continue;
      const e = c.ent, x = ents.x[e]!, z = ents.z[e]!;
      const y = ents.y[e]! + stanceEye(reg.move[ents.kind[e]!]!, ents.stance[e]!);
      const gx = Math.floor(x), gy = Math.floor(y), gz = Math.floor(z);
      let watch = this.watches.get(c);
      if (!watch) {
        watch = { gx, gy, gz, shapes: -1, refs: [] };
        this.watches.set(c, watch);
      }
      if (watch.shapes !== structs.shapes || watch.gx !== gx || watch.gy !== gy || watch.gz !== gz) {
        watch.gx = gx; watch.gy = gy; watch.gz = gz; watch.shapes = structs.shapes;
        watch.refs.length = 0;
        const n = structs.query(gx - DOOR_REACH, gz - DOOR_REACH, gx + 1 + DOOR_REACH, gz + 1 + DOOR_REACH, this.found, gy - DOOR_REACH, gy + 1 + DOOR_REACH);
        for (let i = 0; i < n; i++) {
          const ref = this.found.refs[i]!, kind = structs.chunks[ref >>> 16]!.kind[ref & 65535];
          if (kind === this.closed || kind === this.open) watch.refs.push(ref);
        }
      }
      for (const ref of watch.refs) {
        const row = structs.chunks[ref >>> 16]!, slot = ref & 65535;
        if ((row.kind[slot] === this.closed || row.kind[slot] === this.open) && tribes.may(rec, row.owner[slot]!)) near(ref, e, rec.pid, x, y, z);
      }
    }
  }
}
