// Cast against a second outside review's findings on cast/foundation (D1061), each as it was found: a shot that misses
// leaving the crowd unaware, a departing person cast again into a second body, police dispatch against arrival and the
// planner cancelling a pursuit, one fight's cries passing three, alarms outliving their time, and chat kept past two
// minutes in the host's own cache.

import { expect, test } from "bun:test";
import { CAST_CATALOGUE } from "../../content/cast/index.ts";
import { DecisionLog } from "../../server/cast/decide.ts";
import { Cast } from "../../server/cast/engine.ts";
import { ModelGate, type Ask } from "../../server/cast/model.ts";
import { Planner } from "../../server/cast/planner.ts";
import { DEFAULT_SETTINGS, type Story } from "../../shared/cast/state.ts";
import { TEXT_LOCAL } from "../../shared/net/protocol.ts";
import { BTN_PRIMARY } from "../../shared/sim/character.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { CastCity } from "../fixtures/castworld.ts";
import { takeInHand } from "../fixtures/gather.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";

function play(h: Harness, scene: string, choices: Record<string, string>, dx: number, dz: number, tags: string[]): Story {
  const cast = h.host.cast.cast, c = h.client(h.sessions[0]!)!;
  const x = c.body.x + dx, z = c.body.z + dz;
  const spot = cast.spots.add({ x, z, tags, cap: 60 });
  const s: Story = { id: `q${cast.stories.size}${scene}`, scene, spot, x, z, region: cast.spots.regionAt(x, z), phase: "planned", parts: [], choices, slots: {}, for: [], engaged: [], importance: 0, made: h.world.tick, since: h.world.tick, planned: -Infinity, history: [] };
  cast.stories.set(s.id, s);
  cast.wake(s, h.world.tick, cast.world.players());
  return s;
}

test("a pistol shot into empty ground beside people frightens them and brings the police for the one who fired", () => {
  const h = new Harness({ entityRadius: 1 }, 3, 30, { dev: true, cast: { hostility: 1, model: "", activity: 0, maxPerPlayer: 60 }, wakeRadius: 1, map: writeMap(flatMap(8)) });
  const ana = h.join("Ana");
  h.run(1000);
  const ch = h.host.cast;
  ch.cast.player("Ana").rose = -Infinity;
  h.say(ana, "enablecheats");
  h.say(ana, "kit pistol");
  h.say(ana, "give round_pistol 20");
  takeInHand(h, ana, h.reg.index.get("core:pistol")!);
  play(h, "cast:group_hangout", { vibe: "chatty" }, 20, 0, ["plaza"]);
  play(h, "cast:meet_friend", { mood: "friendly" }, 0, 22, ["corner"]);
  h.run(150_000);
  const about = ch.stage.count;
  expect(about).toBeGreaterThanOrEqual(4);
  const before = { ...ch.stage.counts };
  // Up into the sky: a shot that hits nothing at all.
  const pilot = h.pilots[0]!;
  pilot.pitch = 1.2;
  pilot.buttons = BTN_PRIMARY;
  h.run(300);
  pilot.buttons = 0;
  h.run(6000);
  const st = ch.stage.counts;
  expect(st.incidents).toBeGreaterThan(before.incidents);
  expect(st.fled + st.cowered + st.watched + st.calls).toBeGreaterThan(before.fled + before.cowered + before.watched + before.calls);
  const police = [...ch.cast.stories.values()].find((s) => s.scene === "cast:police_response");
  expect(police?.slots.culprit).toBe("Ana");
  expect(police?.choices.mood).toBe("pursue");
});

test("a person whose body is still walking off is neither cast again nor uncounted: with one body a player, nobody new comes until it is gone", () => {
  const h = new Harness({ entityRadius: 1 }, 5, 30, { cast: { hostility: 0, model: "", activity: 0, maxPerPlayer: 1 }, wakeRadius: 1, map: writeMap(flatMap(8)) });
  h.join("Ana");
  h.run(2000);
  const ch = h.host.cast;
  const jog = play(h, "cast:jog_by", {}, 30, 0, ["sidewalk"]);
  h.run(40_000);
  const c1 = jog.parts[0]!.character;
  ch.cast.people.met(ch.cast.people.byId.get(c1)!, "Ana", 0.4, "waved", h.world.tick);
  // Its story is ended while its body is still about (it walks off out of sight).
  ch.cast.finish(jog, h.world.tick);
  expect(ch.stage.has(c1)).toBe(true);
  expect(ch.cast.bodiesFor("Ana")).toBe(1);
  const again = play(h, "cast:jog_by", {}, -30, 0, ["sidewalk"]);
  expect(again.phase).toBe("planned");
  let twice = false;
  h.run(240_000, () => {
    const mine = ch.stage.list().filter((b) => b.character === c1);
    if (mine.length > 1) twice = true;
  });
  expect(twice).toBe(false);
  expect(ch.stage.has(c1)).toBe(false);
  // Gone, it is free: the befriended jogger may be cast again.
  expect(ch.cast.people.byId.get(c1)!.story).toBeUndefined();
});

test("police come by car to the scene, timed at the scene itself, and the planner may neither see nor change their orders", async () => {
  const h = new Harness({}, 7, 30, { cast: { hostility: 1, model: "", activity: 0 }, map: writeMap(flatMap(16)) });
  h.join("Ana");
  h.run(2000);
  const ch = h.host.cast, c = h.client(h.sessions[0]!)!;
  const fx = c.body.x + 25, fz = c.body.z + 25, t0 = h.world.tick;
  ch.stage.incident(fx, fz, "gunshot", "Ana");
  const police = [...ch.cast.stories.values()].find((s) => s.scene === "cast:police_response")!;
  // A planner told to stand every response down never even sees this one.
  const sent: string[] = [];
  const ask: Ask = async (_s, user) => (sent.push(user), { text: JSON.stringify({ stories: [{ id: police.id, choices: { mood: "secure" } }] }), tokens: { in: 1, out: 1 }, cost: 0, ms: 1 });
  await new Planner(ch.cast, new ModelGate(ask, { callsPerHour: 99, tokensPerHour: 1e9 }), new DecisionLog(null), () => 0).minute(h.world.tick);
  expect(sent.every((u) => !u.includes(police.id))).toBe(true);
  expect(police.choices.mood).toBe("pursue");
  let arrived = -1;
  h.run(120_000, () => {
    if (arrived >= 0) return;
    for (const p of police.parts) {
      const e = p.pid === undefined ? undefined : h.host.records.entOf.get(p.pid);
      if (e !== undefined && Math.hypot(h.world.ents.x[e]! - fx, h.world.ents.z[e]! - fz) < 20) arrived = (h.world.tick - t0) / 30;
    }
  });
  expect(ch.stage.counts.cars).toBeGreaterThanOrEqual(1);
  expect(arrived).toBeGreaterThan(0);
  expect(arrived).toBeLessThan(60);
  console.log(`police at the scene ${arrived.toFixed(1)} s after the shot`);
});

test("one fight at a crowd's edge is three cries at most, its spreading screams included", () => {
  const h = new Harness({ entityRadius: 1 }, 6, 30, { cast: { hostility: 1, model: "", activity: 2, crowdMax: 40, maxPerPlayer: 80 }, wakeRadius: 1, map: writeMap(flatMap(8)) });
  h.join("Ana");
  h.run(2000);
  const ch = h.host.cast, c = h.client(h.sessions[0]!)!;
  ch.cast.regions.get(ch.cast.spots.regionAt(c.body.x + 30, c.body.z + 30), h.world.tick).heat = 4;
  const crowd = play(h, "cast:beach_crowd", { vibe: "lazy" }, 30, 30, ["beach"]);
  h.run(240_000);
  // Lines about the trouble, by anyone: the crowd's people, and whoever else is about (other stories go on saying theirs).
  const cries = ch.stage.counts.cries;
  ch.stage.incident(crowd.x + 18, crowd.z, "fight", null);
  h.run(8000);
  expect(ch.stage.counts.fled).toBeGreaterThan(10);
  expect(ch.stage.counts.cries - cries).toBeGreaterThan(0);
  expect(ch.stage.counts.cries - cries).toBeLessThanOrEqual(3);
});

test("trouble keeps its own street quiet for its time, and no longer; another street's alarm ends on time though an earlier one is renewed", () => {
  const city = new CastCity();
  const cast = new Cast(city, CAST_CATALOGUE, 1, ["walk"], { ...DEFAULT_SETTINGS });
  cast.alarm(100, 100, 0);
  cast.alarm(1500, 1500, 30);
  city.t = 60 * 30;
  cast.alarm(100, 100, city.t);
  city.t = 99 * 30;
  cast.think(city.t, 5);
  expect(cast.alarmed(1500, 1500)).toBe(false);
  expect(cast.alarmed(100, 100)).toBe(true);
});

test("a survivor's local line is truly forgotten after two minutes, not only hidden from the planner", () => {
  const h = new Harness({ entityRadius: 1 }, 4, 30, { cast: { model: "" }, wakeRadius: 1, map: writeMap(flatMap(8)) });
  h.join("Ana");
  h.run(1000);
  for (const l of h.host.chat.listeners) l("Ana", TEXT_LOCAL, 0, 0, "meet me by the pier");
  expect(h.host.cast.remembered).toBe(1);
  h.run(125_000);
  expect(h.host.cast.remembered).toBe(0);
});
