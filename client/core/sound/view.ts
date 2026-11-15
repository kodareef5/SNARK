// What the sound producers read of the player each frame, taken from the session, and the session's changes to
// structures and nodes handed to build.ts. Kept apart so that the producers depend on a few plain fields, not the session.

import { LOOK_SEX } from "../../../shared/anim/look.ts";
import { SESSION_ALIVE } from "../../../shared/net/protocol.ts";
import { hourOfDay } from "../../../shared/sim/clock.ts";
import { handleIndex } from "../../../shared/ids.ts";
import { Found } from "../../../shared/world/structures.ts";
import type { NodeSpot } from "../../../shared/world/nodes.ts";
import type { ClientSession } from "../session.ts";
import type { SoundView, Sounds } from "./sounds.ts";

const found = new Found();
const spot: NodeSpot = { kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 };

/** The player as the producers hear them. */
export function soundView(session: ClientSession): SoundView {
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
    hour: hourOfDay(session.serverTick, session.dayOffset, session.clock),
    trees: (x, z, r) => (field ? field.store.query(x - r, z - r, x + r, z + r, found) : 0),
  };
}

/** Hands the session's changes to structures and nodes to `sounds`, from now on. */
export function hearSession(session: ClientSession, sounds: Sounds): void {
  session.onStructure = (was, kind, x, y, z, hpWas, hp, cause) => sounds.build.structure(was, kind, x, y, z, hpWas, hp, cause);
  session.onNode = (chunk, index, used) => {
    const field = session.nodeField;
    if (!used || !field) return;
    field.source.at(chunk, index, spot);
    if (spot.kind !== 0) sounds.build.node(spot.kind, spot.x, spot.y, spot.z);
  };
}
