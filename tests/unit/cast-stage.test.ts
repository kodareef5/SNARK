import { expect, test } from "bun:test";
import { CAST_CATALOGUE } from "../../content/cast/index.ts";
import { Cast } from "../../server/cast/engine.ts";
import { CastStage, type CastBodies, type StagePlayer } from "../../server/cast/stage.ts";
import type { Story } from "../../shared/cast/state.ts";
import { DEFAULT_SETTINGS } from "../../shared/cast/state.ts";
import { BLOCK, CastCity } from "../fixtures/castworld.ts";

/** Bodies as plain points that walk at their pace each tick; all awake (players are near), all alive. */
class FakeBodies implements CastBodies {
  readonly at_ = new Map<number, { x: number; z: number; tx: number; tz: number; pace: number; emote: string }>();
  readonly said: string[] = [];
  readonly emotes: string[] = [];
  private next = 1;
  private readonly city: CastCity;
  constructor(city: CastCity) {
    this.city = city;
  }
  spawn(_c: unknown, _a: unknown, x: number, z: number): number {
    const pid = this.next++;
    this.at_.set(pid, { x, z, tx: x, tz: z, pace: 0, emote: "" });
    return pid;
  }
  remove(pid: number) {
    this.at_.delete(pid);
  }
  alive(pid: number) {
    return this.at_.has(pid);
  }
  at(pid: number) {
    const b = this.at_.get(pid);
    return b ? { x: b.x, y: 0, z: b.z } : null;
  }
  awake() {
    return true;
  }
  place(pid: number, x: number, z: number) {
    const b = this.at_.get(pid)!;
    b.x = x;
    b.z = z;
  }
  goTo(pid: number, x: number, z: number, pace: number) {
    Object.assign(this.at_.get(pid)!, { tx: x, tz: z, pace });
  }
  arrived(pid: number, r: number) {
    const b = this.at_.get(pid)!;
    return Math.hypot(b.tx - b.x, b.tz - b.z) <= r;
  }
  face() {}
  emote(pid: number, id: string) {
    this.at_.get(pid)!.emote = id;
    this.emotes.push(id);
    return true;
  }
  stopEmote(pid: number) {
    const b = this.at_.get(pid);
    if (b) b.emote = "";
  }
  say(_pid: number, name: string, text: string) {
    this.said.push(`${name}: ${text}`);
  }
  // No cars in these tests: scenes that drive are not cast without the capability.
  spawnCar() {
    return -1;
  }
  removeCar() {}
  door() {
    return null;
  }
  board() {
    return false;
  }
  seated() {
    return false;
  }
  alight() {
    return false;
  }
  car() {
    return null;
  }
  drive() {}
  /** Each body walks toward its goal a tick's worth at its pace. */
  move() {
    for (const b of this.at_.values()) {
      if (!b.pace) continue;
      const dx = b.tx - b.x, dz = b.tz - b.z, d = Math.hypot(dx, dz);
      const v = ([0, 1.3, 2.5, 5.5][b.pace] ?? 2.5) / this.city.rate;
      if (d <= v) (b.x = b.tx), (b.z = b.tz);
      else (b.x += (dx / d) * v), (b.z += (dz / d) * v);
    }
  }
}

function setup(settings = {}) {
  const city = new CastCity();
  const cast = new Cast(city, CAST_CATALOGUE, 11, ["walk", "emote", "speech", "queue"], { ...DEFAULT_SETTINGS, ...settings });
  const bodies = new FakeBodies(city);
  const stage = new CastStage(cast, bodies, 5);
  cast.stage = stage;
  stage.logging = true;
  const players: StagePlayer[] = [];
  city.people = players;
  const run = (s: number) => city.run(s, () => {
    cast.step();
    stage.step(players);
    bodies.move();
  });
  return { city, cast, bodies, stage, players, run };
}

/** Wakes one story of a scene at a spot near the player, by hand. */
function play(t: ReturnType<typeof setup>, scene: string, x: number, z: number, choices: Record<string, string> = {}): Story {
  const spot = t.cast.spots.add({ x, z, tags: ["plaza", "cart", "queue"], cap: 20, queue: { yaw: 0, spacing: 1, serve: 2 } });
  const s: Story = { id: `t${scene}`, scene, spot, x, z, region: t.cast.spots.regionAt(x, z), phase: "planned", parts: [], choices, slots: {}, for: [], engaged: [], importance: 0, made: 0, since: 0, planned: 0, history: [] };
  t.cast.stories.set(s.id, s);
  t.cast.wake(s, t.city.t, t.players);
  return s;
}

const HOME = { x: 3 * BLOCK + 64, z: 3 * BLOCK + 64 };

test("a meeting: both come in unseen, wait for each other, greet, talk, and leave unseen", () => {
  const t = setup({ enabled: false });
  t.players.push({ name: "Ana", x: HOME.x, z: HOME.z });
  const s = play(t, "cast:meet_friend", HOME.x + 30, HOME.z, { mood: "friendly" });
  expect(s.phase).toBe("entering");
  t.run(200);
  expect(t.stage.log.filter((l) => l.what === "in").length).toBe(2);
  // Strolling out of a player's ring takes a few minutes.
  t.run(400);
  expect(t.stage.log.every((l) => !l.seen)).toBe(true);
  expect(t.bodies.said.some((l) => /Hey!|Morning\.|Oh, hi\.|There you are!/.test(l))).toBe(true);
  expect(t.bodies.emotes).toContain("talk");
  expect(t.bodies.emotes).toContain("laugh");
  expect(t.stage.log.filter((l) => l.what === "out").length).toBe(2);
  expect(t.cast.stories.get(s.id)?.phase ?? "done").toBe("done");
});

test("a food cart: customers line up, are served one by one by the vendor, eat, and go", () => {
  const t = setup({ enabled: false });
  t.players.push({ name: "Ana", x: HOME.x, z: HOME.z });
  const s = play(t, "cast:cart_queue", HOME.x + 20, HOME.z + 10);
  const customers = s.parts.filter((p) => p.role === "customers").length;
  expect(customers).toBeGreaterThanOrEqual(3);
  t.run(400);
  const bought = t.bodies.said.filter((l) => /One, please\.|Smells amazing\.|Keep the change\./.test(l)).length;
  expect(bought).toBeGreaterThanOrEqual(Math.min(3, customers));
  expect(t.bodies.emotes.filter((e) => e === "eat").length).toBeGreaterThanOrEqual(3);
});

test("a player who waves gets a wave back, one who speaks gets an answer, and the person remembers them", () => {
  const t = setup({ enabled: false });
  t.players.push({ name: "Ana", x: HOME.x, z: HOME.z });
  const s = play(t, "cast:errand_walk", HOME.x + 10, HOME.z, { errand: "call" });
  t.run(60);
  const pid = s.parts[0]!.pid!;
  const at = t.bodies.at(pid)!;
  // She walks up and waves.
  t.players[0] = { name: "Ana", x: at.x - 4, z: at.z, yaw: Math.PI / 2, emote: "wave" };
  t.run(3);
  t.players[0] = { name: "Ana", x: at.x - 4, z: at.z };
  const c = t.cast.people.byId.get(s.parts[0]!.character)!;
  expect(t.stage.counts.reactions).toBeGreaterThan(0);
  expect(c.tier).toBe("featured");
  expect(c.relations.Ana!.met).toBeGreaterThanOrEqual(1);
  expect(s.engaged).toContain("Ana");
  expect(t.cast.wakes.has(s.id)).toBe(true);
  // A sociable one answers when spoken to.
  c.traits.social = 1;
  const before = t.bodies.said.length;
  t.run(5);
  t.stage.hear("Ana", at.x - 4, at.z, "hey, where's the beach?");
  t.run(3);
  expect(t.bodies.said.length).toBeGreaterThan(before);
});

test("nobody comes in where a player can see: with players everywhere about, the story waits", () => {
  const t = setup({ enabled: false });
  for (let x = 0; x <= 2048; x += 400) for (let z = 0; z <= 2048; z += 400) t.players.push({ name: `p${x}_${z}`, x, z });
  const s = play(t, "cast:errand_walk", HOME.x, HOME.z);
  t.run(20);
  expect(s.parts[0]!.pid).toBeUndefined();
  expect(t.stage.log.length).toBe(0);
});
