// Cast against the faults an outside review of cast/foundation found (planning/workstreams/cast.md), each as it was
// found: a food cart across a restart, protection of a fresh survivor in a two-player standoff, private chat, a person
// cast twice and the body caps, the admin page's writes through the cluster front, a befriended jogger coming back,
// people standing still while they serve, the pick-up's friend getting in, and a model's answer of the wrong shape.

import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CAST_CATALOGUE } from "../../content/cast/index.ts";
import { Guesses } from "../../server/guesses.ts";
import { TickMeter } from "../../server/admin/meter.ts";
import { AdminPages } from "../../server/admin/routes.ts";
import { gaugesOf } from "../../server/admin/stats.ts";
import { DecisionLog } from "../../server/cast/decide.ts";
import { Cast } from "../../server/cast/engine.ts";
import { ModelGate } from "../../server/cast/model.ts";
import { Planner } from "../../server/cast/planner.ts";
import { frontPasses } from "../../server/front.ts";
import { DEFAULT_SETTINGS, type Story } from "../../shared/cast/state.ts";
import { TEXT_GLOBAL, TEXT_LOCAL, TEXT_TRIBE } from "../../shared/net/protocol.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { CastCity } from "../fixtures/castworld.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";

function flat(cast: object, seed = 4, extra: object = {}) {
  return new Harness({ entityRadius: 1 }, seed, 30, { cast: { hostility: 2, model: "", ...cast }, wakeRadius: 1, map: writeMap(flatMap(8)), ...extra });
}

/** Wakes a scene by hand at a spot `dx`, `dz` from the first survivor. */
function play(h: Harness, scene: string, choices: Record<string, string>, dx = 25, dz = 10, tags = ["corner", "plaza", "cart", "queue", "beach"]): Story {
  const cast = h.host.cast.cast, c = h.client(h.sessions[0]!)!;
  const x = c.body.x + dx, z = c.body.z + dz;
  const spot = cast.spots.add({ x, z, tags, cap: 30, queue: { yaw: 0, spacing: 0.9, serve: 3 } });
  const s: Story = { id: `r${cast.stories.size}${scene}`, scene, spot, x, z, region: cast.spots.regionAt(x, z), phase: "planned", parts: [], choices, slots: {}, for: [], engaged: [], importance: 0, made: h.world.tick, since: h.world.tick, planned: -Infinity, history: [] };
  cast.stories.set(s.id, s);
  cast.wake(s, h.world.tick, cast.world.players());
  return s;
}

test("a food cart planned before a restart plays after it without a fault, and the planner still looks at what it never planned", () => {
  const dir = mkdtempSync(join(tmpdir(), "cast-restart-"));
  try {
    const db = join(dir, "world.db");
    const a = flat({ size: 40 }, 4, { dbPath: db });
    a.join("Ana");
    a.run(2000);
    const cast = a.host.cast.cast, c = a.client(a.sessions[0]!)!;
    // A cart planned (not woken) at a spot of its own, then saved and the server stopped.
    const spot = cast.spots.add({ x: c.body.x + 30, z: c.body.z, tags: ["cart", "queue"], cap: 20, queue: { yaw: 1, spacing: 0.9, serve: 3 } });
    const planned: Story = { id: "cart1", scene: "cast:cart_queue", spot, x: c.body.x + 30, z: c.body.z, region: cast.spots.regionAt(c.body.x, c.body.z), phase: "planned", parts: [], choices: {}, slots: {}, for: [], engaged: [], importance: 0, made: a.world.tick, since: a.world.tick, planned: -Infinity, history: [] };
    cast.stories.set(planned.id, planned);
    a.run(61_000);
    a.host.shutdown();
    const b = flat({ size: 40 }, 4, { dbPath: db });
    const back = b.host.cast.cast.stories.get("cart1")!;
    expect(back.planned).toBe(-Infinity);
    expect(b.host.cast.cast.spots.all[back.spot]).toMatchObject({ x: planned.x, z: planned.z, tags: ["cart", "queue"] });
    b.join("Ana");
    b.run(2000);
    b.host.cast.cast.wake(back, b.world.tick, b.host.cast.cast.world.players());
    expect(back.phase).not.toBe("planned");
    // The customers queue and are served: no fault in the tick.
    b.run(150_000);
    expect(b.host.cast.stage.counts.said).toBeGreaterThan(0);
    b.host.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a standoff woken for a veteran never goes for a survivor who has just risen or is at home, though both are near", () => {
  const h = flat({ size: 40 });
  h.join("Vet");
  h.join("Fresh");
  h.run(2000);
  const cast = h.host.cast.cast;
  cast.player("Vet").rose = -Infinity;
  cast.rose("Fresh", h.world.tick);
  const s = play(h, "cast:gang_standoff", { ending: "turn_on_player" });
  expect(s.for.sort()).toEqual(["Fresh", "Vet"]);
  const fresh = h.client(h.sessions[1]!)!.ent;
  let wentForFresh = false;
  h.run(90_000, () => {
    for (const p of s.parts) {
      const e = p.pid === undefined ? undefined : h.host.records.entOf.get(p.pid);
      if (e !== undefined && h.host.creatures.mind.targetOf(e) === fresh) wentForFresh = true;
    }
  });
  expect(wentForFresh).toBe(false);
  expect(s.history.some((l) => l.includes("went for Vet"))).toBe(true);
});

test("Cast hears local chat only, only while on, and forgets it: a tribe's line or a global one never reaches the planner", () => {
  // Cast as the server's settings have it: off until CastEnabled is set.
  const h = new Harness({ entityRadius: 1 }, 4, 30, { wakeRadius: 1, map: writeMap(flatMap(8)) });
  h.join("Ana");
  h.run(1000);
  const ch = h.host.cast, hear = (channel: number, text: string) => { for (const l of h.host.chat.listeners) l("Ana", channel, 0, 0, text); };
  hear(TEXT_LOCAL, "said while Cast was off");
  expect(h.host.setSetting("CastEnabled", "true")).toBe("");
  h.run(6000);
  hear(TEXT_TRIBE, "our base code is 1234");
  hear(TEXT_GLOBAL, "anyone selling metal");
  hear(TEXT_LOCAL, "where is the beach");
  const said = () => ch.planner.views().find((v) => v.name === "Ana")!.said;
  expect(said()).toEqual(["where is the beach"]);
  h.run(125_000);
  expect(said()).toEqual([]);
});

test("nobody is cast twice, the caps hold for bodies still walking off, and a cast that cannot be filled takes nobody", () => {
  // CastMaxBodies 1: never two bodies, and never one person in two bodies.
  const one = flat({ size: 60, activity: 3, maxBodies: 1 });
  one.join("Ana");
  let most = 0, twice = false;
  one.run(240_000, () => {
    const list = one.host.cast.stage.list();
    most = Math.max(most, list.length);
    if (new Set(list.map((b) => b.character)).size !== list.length) twice = true;
  });
  expect(most).toBeLessThanOrEqual(1);
  expect(twice).toBe(false);
  // CastMaxPerPlayer 1: a food cart of four or more is not cast for her at all.
  const per = flat({ size: 60, maxPerPlayer: 1 });
  per.join("Ana");
  per.run(2000);
  const cart = play(per, "cast:cart_queue", {});
  expect(cart.phase).toBe("planned");
  expect(cart.parts).toEqual([]);
  // Room for the vendor alone: the cast is not made, and nobody new is left behind, reserved or not.
  const before = per.host.cast.cast.people.byId.size;
  for (let i = 0; i < 5; i++) play(per, "cast:cart_queue", {}, 30 + i);
  expect(per.host.cast.cast.people.byId.size).toBe(before);
  expect([...per.host.cast.cast.people.byId.values()].filter((c) => c.story && !per.host.cast.cast.stories.get(c.story)?.parts.length)).toEqual([]);
});

test("the admin page's writes go through the cluster front, and a world takes them only from a page it served", async () => {
  expect(frontPasses("POST", "/miami/admin/cast")).toBe(true);
  expect(frontPasses("POST", "/miami/admin/stats.json")).toBe(false);
  expect(frontPasses("DELETE", "/miami/admin/cast")).toBe(false);
  const h = new Harness({}, 1, 30, { cast: { enabled: false } });
  const dir = mkdtempSync(join(tmpdir(), "cast-admin-page-"));
  try {
    writeFileSync(join(dir, "index.html"), "<!doctype html>");
    const pages = new AdminPages({ host: h.host, meter: new TickMeter(() => gaugesOf(h.host)), dir, start: { tick: 0, wall: Date.now() } });
    const gate = { dev: false, password: "kiwi", guesses: new Guesses(), tick: () => 0 };
    const post = (origin: string) => {
      const req = new Request("http://world.example/admin/cast", { method: "POST", headers: { authorization: `Basic ${btoa("admin:kiwi")}`, origin, host: "world.example", "content-type": "application/json" }, body: JSON.stringify({ op: "set", name: "CastActivity", value: "2" }) });
      return pages.answer(req, "1.2.3.4", gate, "/admin/cast")!;
    };
    expect((await post("http://evil.example")).status).toBe(403);
    expect((await post("http://world.example")).status).toBe(200);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a jogger a player befriended jogs by again, and a vendor stays at the cart while it serves", () => {
  const city = new CastCity();
  city.people = [{ name: "Ana", x: 3 * 128 + 64, z: 3 * 128 + 64 }];
  const cast = new Cast(city, CAST_CATALOGUE, 2, ["walk", "emote", "speech", "queue"], { ...DEFAULT_SETTINGS });
  const jogger = cast.people.mint("cast:jogger", cast.spots.regionAt(city.people[0]!.x, city.people[0]!.z), 9, 0);
  cast.people.met(jogger, "Ana", 0.3, "waved", 0);
  let back = 0;
  for (let i = 0; i < 11; i++) {
    const spot = cast.spots.add({ x: city.people[0]!.x + 30, z: city.people[0]!.z, tags: ["sidewalk"], cap: 4 });
    const s: Story = { id: `j${i}`, scene: "cast:jog_by", spot, x: city.people[0]!.x + 30, z: city.people[0]!.z, region: jogger.home, phase: "planned", parts: [], choices: {}, slots: {}, for: [], engaged: [], importance: 0, made: 0, since: 0, planned: -Infinity, history: [] };
    cast.stories.set(s.id, s);
    cast.wake(s, city.t, city.people);
    if (s.parts.some((p) => p.character === jogger.id)) back++;
    cast.finish(s, city.t);
  }
  expect(back).toBeGreaterThanOrEqual(3);

  const h = flat({ size: 30 });
  h.join("Ana");
  h.run(2000);
  const cart = play(h, "cast:cart_queue", {});
  const vendor = cart.parts.find((p) => p.role === "vendor")!;
  let start: { x: number; z: number } | null = null, moved = 0;
  h.run(150_000, () => {
    const b = h.host.cast.stage.list().find((x) => x.character === vendor.character);
    if (!b || b.step !== "serve") return;
    const e = h.host.records.entOf.get(b.pid)!;
    const at = { x: h.world.ents.x[e]!, z: h.world.ents.z[e]! };
    start ??= at;
    moved = Math.max(moved, Math.hypot(at.x - start.x, at.z - start.z));
  });
  expect(start).not.toBeNull();
  expect(moved).toBeLessThan(2);
});

test("the pick-up's friend gets into the car beside its driver and goes with it", () => {
  const h = flat({ size: 30, hostility: 0 });
  h.join("Ana");
  h.run(2000);
  h.host.cast.stage.logging = true;
  const s = play(h, "cast:drive_to_meet", {}, 40, 30, ["parking", "road"]);
  const friend = s.parts.find((p) => p.role === "friend")!;
  const pids = new Set<number>();
  let rode = false;
  h.run(240_000, () => {
    for (const p of s.parts) if (p.pid !== undefined) pids.add(p.pid);
    if (friend.pid !== undefined) {
      const e = h.host.records.entOf.get(friend.pid);
      if (e !== undefined && h.host.urban.seatedNpc(e)) rode = true;
    }
  });
  expect(rode).toBe(true);
  expect(h.host.cast.stage.log.filter((l) => l.what === "out" && pids.has(l.pid)).length).toBe(2);
  expect(h.host.cast.stage.log.filter((l) => l.seen)).toEqual([]);
});

test("a model's answer of the wrong shape plans nothing and throws nothing; the rules' choice stands", async () => {
  const city = new CastCity();
  city.people = [{ name: "Ana", x: 448, z: 448 }];
  const cast = new Cast(city, CAST_CATALOGUE, 2, ["walk", "emote", "speech"], { ...DEFAULT_SETTINGS });
  for (const text of ['{"stories":"all of them"}', '{"stories":[1,null,"x",[2]]}', "[]", '"just a string"', '{"people":{"id":"c1"}}']) {
    const planner = new Planner(cast, new ModelGate(async () => ({ text, tokens: { in: 1, out: 1 }, cost: 0, ms: 1 }), { callsPerHour: 99, tokensPerHour: 1e9 }), new DecisionLog(null), () => 0);
    const spot = cast.spots.add({ x: 470, z: 448, tags: ["corner"], cap: 4 });
    const s: Story = { id: `m${text.length}`, scene: "cast:meet_friend", spot, x: 470, z: 448, region: 0, phase: "planned", parts: [], choices: { mood: "friendly" }, slots: {}, for: [], engaged: [], importance: 0, made: 0, since: 0, planned: -Infinity, history: [] };
    cast.stories.set(s.id, s);
    await planner.minute(1);
    cast.people.mint("cast:vendor", 0, 3, 0);
    await planner.hour(2);
    expect(s.choices.mood).toBe("friendly");
    cast.stories.delete(s.id);
  }
});
