// The grunt protocol's focus channel for SNARK (grunt/protocol.md "focus"): what the crosshair is on, as the browser's
// use prompt finds it (client/core/app.ts prompt and builtAt), with the same ray the server casts: from the eye along
// the look, the world first (pieces, nodes, the ground), then any body nearer on the ray. The target is named in the
// gateway's ids (s… a piece, n…… a node, e… a body), with how far it is and what the use key would do to it.

import { ownIndex, type ClientSession, type RemoteSample } from "../client/core/session.ts";
import type { FocusChannel } from "../grunt/protocol.ts";
import { stanceEye } from "../shared/sim/character.ts";
import { ACT_REACH } from "../shared/world/upkeep.ts";
import { HIT_NODE, HIT_NONE, HIT_STRUCTURE, castWorld, lookDirection, rayBox, rayHit } from "../shared/world/ray.ts";

/** How far the use key reaches (client/core/app.ts REACH), and how far a look is followed to name what it is on. */
const USE = 3.5, LOOK = 60;
const TAU = Math.PI * 2;

/** What a look from the survivor's eye along `yaw`, `pitch` (radians, the controller's) is on. */
export function focusOf(s: ClientSession, remote: RemoteSample, yaw: number, pitch: number): FocusChannel {
  const world = s.world;
  if (!world || s.driving >= 0) return { target: null };
  const reg = s.registry;
  const move = reg.move[s.bodyKind];
  if (!move) return { target: null };
  const d = [0, 0, 0];
  lookDirection(Math.round((yaw / TAU) * 65536) & 0xffff, Math.round((pitch / (Math.PI / 2)) * 16384), d);
  const [ox, oy, oz] = [s.own.x, s.own.y + stanceEye(move, s.own.stance), s.own.z];
  const struck = castWorld(world, ox, oy, oz, d[0]!, d[1]!, d[2]!, LOOK);
  let best = struck === HIT_NONE ? LOOK : rayHit.t;
  const ref = rayHit.ref;
  // A body nearer on the ray than what the world stops it at.
  const me = ownIndex(s);
  let hit = -1;
  for (let i = 0; i < remote.count; i++) {
    const kind = remote.kind[i]!;
    const rad = reg.bodyRadius[kind]!;
    if (remote.id[i] === me || !(rad > 0)) continue;
    const t = rayBox(ox, oy, oz, d[0]!, d[1]!, d[2]!, remote.x[i]! - rad, remote.y[i]!, remote.z[i]! - rad, remote.x[i]! + rad, remote.y[i]! + (reg.bodyHeight[kind] || 1), remote.z[i]! + rad);
    if (t > 0 && t < best) (best = t), (hit = i);
  }
  const at = Math.round(best * 100) / 100;
  if (hit >= 0) {
    const kind = remote.kind[hit]!;
    const verbs: string[] = [];
    const ours = s.tribe.team !== 0 && remote.team[hit] === s.tribe.team;
    if (best <= USE) {
      if (reg.vehicle[kind]) verbs.push("mount");
      else if (ours && reg.move[kind] && reg.saddleSeats.length) verbs.push("open", "mount");
      else if (reg.propItem[kind] !== 0 || reg.move[kind] === null) verbs.push("open");
    }
    return { target: `e${remote.id[hit]}`, distance: at, verbs };
  }
  if (struck === HIT_STRUCTURE) {
    const t = world.structs.chunks[Math.floor(ref / 65536)]!;
    const kind = t.kind[ref & 0xffff]!;
    const verbs: string[] = [];
    if (best <= USE) {
      const motion = reg.motion[kind];
      if (motion) verbs.push(s.motions.get(ref)?.to === 1 ? "close" : "open");
      else if (reg.opens[kind] !== 0 || reg.structSlots[kind] !== 0) verbs.push("open");
    }
    // A piece of the tribe's, in a hammer's reach: mended, locked, taken down (the structure menu, held E).
    if (best <= ACT_REACH && s.tribe.team !== 0 && t.owner[ref & 0xffff] === s.tribe.team && reg.pieceItem[kind] !== 0) {
      verbs.push("repair");
      if (reg.motion[kind]) verbs.push("lock", "unlock");
    }
    return { target: `s${ref}`, distance: at, verbs };
  }
  if (struck === HIT_NODE && s.nodeField) {
    const def = reg.defs[s.nodeField.standing(Math.floor(ref / 65536), ref & 0xffff)];
    if (def?.type !== "node") return { target: null, distance: at };
    return { target: `n${Math.floor(ref / 65536)}.${ref & 0xffff}`, distance: at, verbs: best <= USE || (def as { material?: string }).material !== undefined ? ["harvest"] : [] };
  }
  return { target: null, ...(struck !== HIT_NONE ? { distance: at } : {}) };
}

