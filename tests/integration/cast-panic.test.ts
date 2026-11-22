// Bystanders and crowds when things turn violent (D1059): people near trouble run from it, freeze, watch from a way off
// or call it in by their tables; a runner's panic spreads to those a few strides off, so a crowd scatters; the street
// goes quiet; and police come, going after whoever started it when a survivor did.

import { expect, test } from "bun:test";
import type { Story } from "../../shared/cast/state.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";

function setup(cast: object = {}) {
  const h = new Harness({ entityRadius: 1 }, 6, 30, { cast: { hostility: 1, model: "", activity: 0, ...cast }, wakeRadius: 1, map: writeMap(flatMap(8)) });
  h.join("Ana");
  h.run(2000);
  const ch = h.host.cast, c = h.client(h.sessions[0]!)!;
  const play = (scene: string, choices: Record<string, string>, dx: number, dz: number, tags: string[]): Story => {
    const x = c.body.x + dx, z = c.body.z + dz;
    const spot = ch.cast.spots.add({ x, z, tags, cap: 80 });
    const s: Story = { id: `p${ch.cast.stories.size}`, scene, spot, x, z, region: ch.cast.spots.regionAt(x, z), phase: "planned", parts: [], choices, slots: {}, for: [], engaged: [], importance: 0, made: h.world.tick, since: h.world.tick, planned: -Infinity, history: [] };
    ch.cast.stories.set(s.id, s);
    ch.cast.wake(s, h.world.tick, ch.cast.world.players());
    return s;
  };
  const at = (pid: number) => {
    const e = h.host.records.entOf.get(pid);
    return e === undefined ? null : { x: h.world.ents.x[e]!, z: h.world.ents.z[e]! };
  };
  return { h, ch, c, play, at };
}

test("a fight at the edge of a beach crowd scatters it: those near run or freeze or watch, and panic spreads past the fight's reach", () => {
  const t = setup({ activity: 2, crowdMax: 40 });
  const region = t.ch.cast.spots.regionAt(t.c.body.x + 30, t.c.body.z + 30);
  t.ch.cast.regions.get(region, t.h.world.tick).heat = 4;
  const crowd = t.play("cast:beach_crowd", { vibe: "lazy" }, 30, 30, ["beach"]);
  t.h.run(240_000);
  const there = crowd.parts.filter((p) => p.pid !== undefined && t.at(p.pid));
  expect(there.length).toBeGreaterThanOrEqual(20);
  // Trouble just off one side of the crowd.
  const fx = crowd.x + 18, fz = crowd.z;
  const before = new Map(there.map((p) => [p.pid!, t.at(p.pid!)!]));
  const beyond = [...before.entries()].filter(([, a]) => Math.hypot(a.x - fx, a.z - fz) > 25).map(([pid]) => pid);
  t.ch.stage.incident(fx, fz, "fight", null);
  t.h.run(8000);
  const st = t.ch.stage.counts;
  expect(st.fled + st.cowered + st.watched).toBeGreaterThanOrEqual(Math.floor(there.length / 2));
  // Most of the crowd got further from the trouble, or is already gone.
  const further = [...before.entries()].filter(([pid, a]) => {
    const now = t.at(pid);
    return !now || Math.hypot(now.x - fx, now.z - fz) > Math.hypot(a.x - fx, a.z - fz) + 3;
  }).length;
  expect(further).toBeGreaterThan(there.length / 2);
  // Some who were past the fight's own 25 m took fright from the runners: the panic spread.
  const spread = beyond.filter((pid) => {
    const now = t.at(pid);
    return !now || Math.hypot(now.x - fx, now.z - fz) > Math.hypot(before.get(pid)!.x - fx, before.get(pid)!.z - fz) + 3;
  });
  expect(spread.length).toBeGreaterThan(0);
  // A few cries, not a chorus: lines said stay far fewer than people who reacted.
  expect(st.said).toBeLessThan(st.fled + st.cowered + st.watched);
});

test("a shot brings the police: they come after a while, go after the survivor who fired, and the street stays quiet meanwhile", () => {
  const t = setup({ size: 40, activity: 1 });
  t.ch.cast.player("Ana").rose = -Infinity;
  const fx = t.c.body.x + 20, fz = t.c.body.z + 20;
  t.ch.stage.incident(fx, fz, "gunshot", "Ana");
  const police = [...t.ch.cast.stories.values()].find((s) => s.scene === "cast:police_response")!;
  expect(police).toBeDefined();
  expect(police.choices.mood).toBe("pursue");
  expect(police.slots.culprit).toBe("Ana");
  expect(t.ch.cast.alarmed(fx, fz)).toBe(true);
  // Not at once: police take a while to come.
  t.h.run(10_000);
  expect(police.phase).toBe("planned");
  t.h.run(40_000);
  expect(police.phase).not.toBe("planned");
  // Meanwhile no everyday scene started near the trouble.
  const near = [...t.ch.cast.stories.values()].filter((s) => s.scene !== "cast:police_response" && s.phase !== "planned" && s.made > police.made && Math.hypot(s.x - fx, s.z - fz) < 100);
  expect(near).toEqual([]);
  // The officers come and go for her: one of them hunts her body.
  const ana = t.h.client(t.h.sessions[0]!)!.ent;
  let hunted = false;
  t.h.run(120_000, () => {
    for (const p of police.parts) {
      const e = p.pid === undefined ? undefined : t.h.host.records.entOf.get(p.pid);
      if (e !== undefined && t.h.host.creatures.mind.targetOf(e) === ana) hunted = true;
    }
  });
  expect(hunted).toBe(true);
});

test("a gang shoot-out of the world's own frightens the people about it, and nobody calls a second police response for the same trouble", () => {
  const t = setup({ hostility: 2, activity: 2, crowdMax: 24, maxPerPlayer: 80 });
  t.ch.cast.regions.get(t.ch.cast.spots.regionAt(t.c.body.x + 30, t.c.body.z), t.h.world.tick).heat = 4;
  // People lying about a plaza, and two gangs coming to the corner beside it.
  t.play("cast:beach_crowd", { vibe: "lazy" }, 30, 0, ["beach"]);
  t.h.run(180_000);
  const before = { ...t.ch.stage.counts };
  const gangs = t.play("cast:gang_standoff", { ending: "shoot_out" }, 40, 4, ["corner"]);
  t.h.run(200_000);
  expect(gangs.history.some((l) => l.includes("went for a rival"))).toBe(true);
  const st = t.ch.stage.counts;
  expect(st.incidents).toBeGreaterThan(before.incidents);
  expect(st.fled + st.watched + st.cowered + st.calls).toBeGreaterThan(before.fled + before.watched + before.cowered + before.calls);
  const responses = [...t.ch.cast.stories.values()].filter((s) => s.scene === "cast:police_response");
  expect(responses.length).toBeLessThanOrEqual(1);
});
