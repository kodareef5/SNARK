import { expect, test } from "bun:test";
import type { Story } from "../../shared/cast/state.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";

function setup(hostility: number) {
  const h = new Harness({ entityRadius: 1 }, 7, 30, { cast: { enabled: false, hostility }, wakeRadius: 1, map: writeMap(flatMap(8)) });
  const ana = h.join("Ana");
  h.run(1500);
  const cast = h.host.cast!, c = h.client(ana)!;
  const players = () => [{ name: "Ana", x: c.body.x, z: c.body.z }];
  const story = (scene: string, choices: Record<string, string>, dx = 25): Story => {
    const x = c.body.x + dx, z = c.body.z + 10;
    const spot = cast.cast.spots.add({ x, z, tags: ["corner", "quiet", "plaza"], cap: 8 });
    const s: Story = { id: scene, scene, spot, x, z, region: cast.cast.spots.regionAt(x, z), phase: "planned", parts: [], choices, slots: {}, for: [], engaged: [], importance: 0, made: 0, since: 0, planned: 0, history: [] };
    cast.cast.stories.set(s.id, s);
    cast.cast.wake(s, h.world.tick, players());
    return s;
  };
  const run = (ms: number, each?: () => void) => h.run(ms, () => (cast.stage.step(players()), each?.()));
  return { h, cast, c, story, run };
}

test("a standoff: both gangs draw their pistols, trade words, and go for each other, then run", () => {
  const t = setup(2);
  const s = t.story("cast:gang_standoff", { ending: "shoot_out" });
  expect(s.parts.length).toBe(4);
  let drawn = 0, fought = false;
  const mind = t.h.host.creatures.mind;
  t.run(120_000, () => {
    for (const p of s.parts) {
      if (p.pid === undefined) continue;
      const rec = t.h.host.records.byPid.get(p.pid);
      if (rec && rec.held >= 0) drawn = Math.max(drawn, s.parts.filter((q) => q.pid !== undefined && t.h.host.records.byPid.get(q.pid)!.held >= 0).length);
      const e = t.h.host.records.entOf.get(p.pid);
      if (e !== undefined && mind.targetOf(e) >= 0) fought = true;
    }
  });
  expect(drawn).toBeGreaterThanOrEqual(2);
  expect(fought).toBe(true);
  expect(s.history.some((l) => l.includes("went for a rival"))).toBe(true);
});

test("at hostility 2 a standoff may turn on the player watching; at 1 the same ending finds no one to go for", () => {
  for (const [hostility, expectTurned] of [[2, true], [1, false]] as const) {
    const t = setup(hostility);
    const s = t.story("cast:gang_standoff", { ending: "turn_on_player" });
    const ana = t.h.client(t.h.sessions[0]!)!.ent;
    let turned = false;
    t.run(90_000, () => {
      for (const p of s.parts) {
        const e = p.pid === undefined ? undefined : t.h.host.records.entOf.get(p.pid);
        if (e !== undefined && t.h.host.creatures.mind.targetOf(e) === ana) turned = true;
      }
    });
    expect(turned).toBe(expectTurned);
  }
});

test("hurt, an officer fights back the one who did it and a passer-by runs; a person remembers who hurt it", () => {
  const t = setup(1);
  const cops = t.story("cast:cop_beat", { mood: "routine" }, 20);
  const walk = t.story("cast:errand_walk", { errand: "browse" }, -20);
  t.run(60_000);
  const ana = t.h.client(t.h.sessions[0]!)!.ent;
  const cop = cops.parts.find((p) => p.pid !== undefined)!, folk = walk.parts.find((p) => p.pid !== undefined)!;
  t.cast.stage.attacked(cop.pid!, "Ana", [{ name: "Ana", x: t.c.body.x, z: t.c.body.z }]);
  t.cast.stage.attacked(folk.pid!, "Ana", [{ name: "Ana", x: t.c.body.x, z: t.c.body.z }]);
  const ce = t.h.host.records.entOf.get(cop.pid!)!;
  expect(t.h.host.creatures.mind.targetOf(ce)).toBe(ana);
  const person = t.cast.cast.people.byId.get(folk.character)!;
  expect(person.relations.Ana!.stance).toBeLessThan(0);
  expect(person.facts.some((f) => f.text.includes("Ana attacked me") && f.locked)).toBe(true);
  // A fight breaks off: the officer lets go within its time.
  t.run(40_000);
  expect(t.h.host.creatures.mind.targetOf(ce)).not.toBe(ana);
});
