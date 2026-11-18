// Every survivor of a world as the admin page lists and maps them: who, which tribe, what level, online or last seen, play
// time, where they are now or were last, and their recent deaths. One pass over the survivors and one over the sessions.

import type { SurvivorRow, Survivors } from "../../shared/admin.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { MARKER_DEATH } from "../../shared/net/protocol.ts";
import type { Host } from "../host.ts";

/** The tick and wall time this run of the server began at, so a tick since then reads as a time. */
export interface RunStart {
  tick: number;
  wall: number;
}

export function survivorsOf(host: Host, start: RunStart, now = Date.now()): Survivors {
  const { world, records, game } = host;
  const ents = world.ents;
  const tick = world.tick;
  const sessions = new Map<number, NonNullable<(typeof game.clients)[number]>>();
  for (const c of game.clients) if (c?.active && c.pid !== 0) sessions.set(c.pid, c);
  const wallOf = (t: number): number | null => (t >= start.tick ? Math.round(now - ((tick - t) / TICK_RATE) * 1000) : null);
  const out: SurvivorRow[] = [];
  for (const pid of host.survivorIds()) {
    const rec = records.byPid.get(pid);
    if (!rec) continue;
    const c = sessions.get(pid);
    let x = rec.x;
    let z = rec.z;
    let riding = "";
    const e = c !== undefined && c.ent >= 0 ? c.ent : -1;
    if (e >= 0) {
      // A seated survivor is where what it sits on is, which moves it.
      const seat = ents.seat[e]! - 1;
      const at = seat >= 0 ? seat : e;
      x = ents.x[at]!;
      z = ents.z[at]!;
      if (seat >= 0) riding = world.reg.ids[ents.kind[seat]!] ?? "";
    }
    const { lastLogin, playMs } = host.activity.summary(rec);
    out.push({
      pid,
      name: rec.name,
      tribe: host.tribes.of(rec)?.name ?? "",
      team: rec.team,
      level: host.progression.levelOf(rec.xp),
      online: c !== undefined && !c.closed,
      dead: rec.dead,
      out: rec.out,
      x: Math.round(x * 10) / 10,
      z: Math.round(z * 10) / 10,
      riding,
      lastLogin,
      lastSeen: host.activity.lastSeen(rec),
      playMs: playMs === null ? null : Math.round(playMs),
      deaths: rec.markers.filter((m) => m.kind === MARKER_DEATH).map((m) => ({ tick: m.tick, at: wallOf(m.tick), x: Math.round(m.x), z: Math.round(m.z) })),
    });
  }
  return { at: now, tick, survivors: out };
}
