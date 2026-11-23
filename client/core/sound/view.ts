// What the sound producers read of the player each frame, taken from the session, and the session's changes to
// structures and nodes handed to build.ts. Kept apart so that the producers depend on a few plain fields, not the session.
// Rows of pieces that break are left to break-effects.ts, which asks for one sound a cell of them.

import { LOOK_SEX } from "../../../shared/anim/look.ts";
import { SESSION_ALIVE } from "../../../shared/net/protocol.ts";
import { hourOfDay } from "../../../shared/sim/clock.ts";
import { handleIndex } from "../../../shared/ids.ts";
import { Found, type ChunkTable } from "../../../shared/world/structures.ts";
import type { NodeSpot } from "../../../shared/world/nodes.ts";
import type { ClientSession } from "../session.ts";
import type { SkyClock } from "../sky.ts";
import type { SoundView, Sounds } from "./sounds.ts";

const found = new Found();
const rows = new Found();
const spot: NodeSpot = { kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 };

/** The player as the producers hear them, at the hour the sky shows where the app keeps one. */
export function soundView(session: ClientSession, sky: SkyClock | null = null): SoundView {
  const alive = session.sessionState === SESSION_ALIVE && session.ownHandle !== 0;
  const own = session.own;
  const field = session.nodeField;
  return {
    ownId: handleIndex(session.ownHandle),
    body: alive && session.driving < 0 ? own : null,
    own: {
      alive,
      x: own.x,
      y: own.y,
      z: own.z,
      act: own.act,
      actTicks: own.actTicks,
      held: own.held,
      female: (session.ownLook?.[LOOK_SEX] ?? 0) === 1,
      vitals: session.hasVitals ? session.vitals : null,
      tick: session.serverTick,
      level: session.progress.level,
      engrams: session.progress.engrams.length,
    },
    vehicle: !alive ? -1 : session.driving >= 0 ? session.driving : own.seat > 0 ? own.seat - 1 : -1,
    // The supply drops are heard at the tick they are drawn at.
    supply: { list: session.supply, tick: session.tickClock },
    hour: sky ? sky.hour : hourOfDay(session.serverTick, session.dayOffset, session.clock),
    turned: sky?.turned ?? false,
    trees: (x, z, r) => (field ? field.store.query(x - r, z - r, x + r, z + r, found) : 0),
    lit: (x, z, r, out) => {
      const structs = session.world?.structs;
      if (!structs) return;
      const n = structs.query(x - r, z - r, x + r, z + r, rows);
      for (let i = 0; i < n; i++) {
        const ref = rows.refs[i]!;
        const t: ChunkTable | null | undefined = structs.chunks[Math.floor(ref / 65536)];
        const slot = ref & 0xffff;
        const kind = t?.kind[slot] ?? 0;
        if (t && session.registry.burning[kind] === 1) out.push(t.x[slot]!, t.y[slot]!, t.z[slot]!, kind);
      }
    },
  };
}

/** Hands the session's changes to structures and nodes to `sounds`, from now on. */
export function hearSession(session: ClientSession, sounds: Sounds): void {
  const beforeStructure = session.onStructure;
  session.onStructure = (was, kind, x, y, z, hpWas, hp, cause) => {
    beforeStructure?.(was, kind, x, y, z, hpWas, hp, cause);
    if (!sounds.build.merged(was, kind, cause)) sounds.build.structure(was, kind, x, y, z, hpWas, hp, cause);
  };
  const beforeNode = session.onNode;
  session.onNode = (chunk, index, used, crushed, form) => {
    beforeNode?.(chunk, index, used, crushed, form);
    const field = session.nodeField;
    if (!used || !field || crushed && session.predictedTrees?.hidden(chunk * 65536 + index)) return;
    field.source.at(chunk, index, spot);
    if (spot.kind !== 0) {
      if (crushed) sounds.build.treeImpact(spot.kind, spot.x, spot.y, spot.z);
      else sounds.build.node(spot.kind, spot.x, spot.y, spot.z);
    }
  };
}
