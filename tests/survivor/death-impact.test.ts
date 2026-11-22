import { expect, test } from "bun:test";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import type { CorpseImpact } from "../../shared/anim/corpse.ts";
import { makeHandle } from "../../shared/ids.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { CAUSE_FALL, CAUSE_KILLED } from "../../server/survival.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";

test("a reentrant death callback cannot lend its killer or physical launch to another victim", () => {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(2)) });
  try {
    const a = h.join("impact-victim"), b = h.join("other-victim"); h.run(400);
    const first = h.client(a)!, second = h.client(b)!;
    const victim = h.host.records.byPid.get(first.pid)!, other = h.host.records.byPid.get(second.pid)!;
    const impact: CorpseImpact = { victimHandle: makeHandle(first.ent, h.world.ents.gen[first.ent]!), victimPid: victim.pid, vx: 10, vy: 3, vz: 0, wx: 1, wy: 2, wz: 3 };
    const died: unknown[][] = [];
    h.host.survival.onDeath = (rec, cause, by, launch) => {
      died.push([rec.pid, cause, by, launch]);
      if (rec === victim) h.host.survival.add(other, V_HEALTH, -1e6, CAUSE_FALL);
    };
    h.host.survival.hurt(victim, 1e6, 99, CAUSE_KILLED, impact);
    expect(died).toEqual([[victim.pid, CAUSE_KILLED, 99, impact], [other.pid, CAUSE_FALL, 0, undefined]]);
  } finally { h.host.shutdown(); }
});
