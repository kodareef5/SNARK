import { expect, test } from "bun:test";
import { CAST_CATALOGUE } from "../../content/cast/index.ts";
import { AWAY_M, Cast, RISE_GRACE_S, WAKE_M, attacksPlayer, type Stage } from "../../server/cast/engine.ts";
import { People } from "../../server/cast/people.ts";
import { Regions } from "../../server/cast/regions.ts";
import { Spots } from "../../server/cast/spots.ts";
import type { Capability } from "../../shared/cast/catalogue.ts";
import { Queue } from "../../shared/cast/queue.ts";
import { DEFAULT_SETTINGS, type Story } from "../../shared/cast/state.ts";
import { BLOCK, CastCity } from "../fixtures/castworld.ts";

const ON_FOOT: Capability[] = ["walk", "emote", "speech", "queue", "weapon"];

function cast(seed = 1, settings = {}) {
  const city = new CastCity();
  const c = new Cast(city, CAST_CATALOGUE, seed, ON_FOOT, { ...DEFAULT_SETTINGS, ...settings });
  return { city, c };
}

test("spots are read from the ground a region at a time: sidewalks, corners, plazas with carts, beach, roads, landmarks", () => {
  const city = new CastCity();
  const spots = new Spots(city);
  const tagsIn = (x: number, z: number) => new Set(spots.in(spots.regionAt(x, z)).flatMap((i) => spots.all[i]!.tags));
  const town = tagsIn(3 * BLOCK + 64, 3 * BLOCK + 64);
  for (const t of ["road", "sidewalk", "corner", "plaza", "storefront", "beat", "landmark"]) expect(town.has(t)).toBe(true);
  expect(tagsIn(1920, 600).has("beach")).toBe(true);
  // Nothing on a building or in the sea, and every queue spot has its line.
  for (const s of spots.all) {
    expect(city.blocked(s.x, s.z)).toBe(false);
    expect(city.water(s.x)).toBeLessThanOrEqual(0.2);
    if (s.tags.includes("queue")) expect(s.queue!.spacing).toBeGreaterThan(0);
  }
  expect(spots.all.some((s) => s.tags.includes("cart") && s.queue)).toBe(true);
});

test("a queue serves its head and the rest move up; its slots run out from the place along its line", () => {
  const q = new Queue({ x: 10, z: 20, yaw: 0, spacing: 1 }, 3);
  expect(q.join("a") && q.join("b") && q.join("c")).toBe(true);
  expect(q.join("d")).toBe(false);
  expect(q.place("c")).toBe(2);
  expect(q.slot(0)).toEqual({ x: 10, z: 20 });
  expect(q.slot(2).z).toBeCloseTo(22);
  expect(q.serve()).toBe("a");
  expect(q.place("c")).toBe(1);
  q.leave("b");
  expect(q.head()).toBe("c");
});

test("heat rises in minutes where players are and fades over hours; each region paces relax, build, peak, fade", () => {
  const r = new Regions(3);
  r.warm(new Map([[5, 2]]), 600, 0);
  expect(r.get(5, 0).heat).toBeCloseTo(1, 1);
  r.warm(new Map(), 6 * 3600, 0);
  expect(r.get(5, 0).heat).toBeCloseTo(0.5, 1);
  const seen = new Set<string>();
  for (let t = 0; t < 30 * 3600; t += 30 * 5) {
    r.pace(t, 30, 0.6);
    seen.add(r.get(5, t).pace);
  }
  expect([...seen].sort()).toEqual(["build", "fade", "peak", "relax"]);
});

test("an extra is a seed until promoted; a featured person keeps a life, facts and what it thinks of each player", () => {
  const p = new People(CAST_CATALOGUE);
  const e = p.mint("cast:pedestrian", 4, 99, 0);
  expect(e.tier).toBe("extra");
  expect(e.want).toBeUndefined();
  const again = new People(CAST_CATALOGUE).mint("cast:pedestrian", 4, 99, 0);
  expect([again.name, again.look, again.traits]).toEqual([e.name, e.look, e.traits]);
  p.met(e, "Ana", 0.3, "waved back", 10);
  expect(e.tier).toBe("featured");
  expect(e.want && e.struggle && e.hope).toBeTruthy();
  expect(e.relations.Ana).toMatchObject({ stance: 0.3, met: 1 });
  for (let i = 0; i < 20; i++) p.remember(e, `fact ${i}`, i, i === 0);
  expect(e.facts.length).toBe(12);
  expect(e.facts[0]!.text).toBe("fact 0");
  const cop = p.mint("cast:cop", 4, 7, 0);
  expect(cop.tier).toBe("featured");
  expect(p.free(["cast:cop"], 4, () => false)).toBe(cop);
});

test("stories are planned about the map toward its size, most where players are, and wake for a player within its pace", () => {
  const { city, c } = cast(1, { size: 120 });
  city.people = [{ name: "Ana", x: 3 * BLOCK + 64, z: 3 * BLOCK + 64 }];
  city.run(120, () => c.step());
  expect(c.stories.size).toBeGreaterThan(80);
  expect(c.stories.size).toBeLessThanOrEqual(120);
  const mine = c.storiesFor(city.people[0]!);
  expect(mine.length).toBeGreaterThan(0);
  expect(mine.length).toBeLessThanOrEqual(5);
  for (const s of mine) expect(Math.hypot(s.x - city.people[0]!.x, s.z - city.people[0]!.z)).toBeLessThan(AWAY_M);
  let near = 0;
  for (const s of c.stories.values()) if (s.phase === "planned" && Math.hypot(s.x - city.people[0]!.x, s.z - city.people[0]!.z) < WAKE_M * 3) near++;
  expect(near).toBeGreaterThan(5);
});

test("bodies stay within the caps however busy, and a crowd's size follows its cap", () => {
  const { city, c } = cast(2, { maxPerPlayer: 10, maxBodies: 24, crowdMax: 8, activity: 2 });
  city.people = [{ name: "Ana", x: 1900, z: 600 }, { name: "Bo", x: 3 * BLOCK + 64, z: 3 * BLOCK + 64 }];
  for (let i = 0; i < 40; i++) {
    city.run(15, () => c.step());
    expect(c.bodies()).toBeLessThanOrEqual(24);
    for (const s of c.stories.values()) if (s.phase !== "planned" && s.scene === "cast:beach_crowd") expect(s.parts.length).toBeLessThanOrEqual(8);
  }
});

test("the same seed plans the same city", () => {
  const run = (seed: number) => {
    const { city, c } = cast(seed, { size: 60 });
    city.people = [{ name: "Ana", x: 900, z: 900 }];
    city.run(90, () => c.step());
    return [...c.stories.values()].map((s) => `${s.id}:${s.scene}@${s.spot}:${s.phase}:${s.parts.length}`).join(" ");
  };
  expect(run(5)).toBe(run(5));
  expect(run(5)).not.toBe(run(6));
});

test("hostile scenes spare a player just risen, wait out its cooldown, never come at hostility 0, and never turn on it at 1", () => {
  const standoff = CAST_CATALOGUE.scenes.find((s) => s.id === "cast:gang_standoff")!;
  expect(attacksPlayer(standoff, "ending", "turn_on_player")).toBe(true);
  expect(attacksPlayer(standoff, "ending", "back_down")).toBe(false);
  const hostiles = (settings: object, rose = true) => {
    const { city, c } = cast(4, { size: 200, activity: 2, ...settings });
    city.people = [{ name: "Ana", x: 5 * BLOCK + 64, z: 6 * BLOCK + 64 }];
    if (rose) c.rose("Ana", 0);
    const woken: Story[] = [];
    c.stage = { count: 0, near: () => 0, has: () => false, people: () => [], enter: (s) => void woken.push(s), end: () => {} } satisfies Stage;
    city.run(RISE_GRACE_S - 30, () => c.step());
    const early = woken.filter((s) => s.scene === "cast:gang_standoff").length;
    city.run(3 * 3600, () => {
      c.step();
      // The stage would play each out; here they end at once so the player wants more.
      for (const s of woken.splice(0)) c.finish(s, city.t);
    });
    return { early, c };
  };
  const on = hostiles({});
  expect(on.early).toBe(0);
  const all = [...on.c.players.values()][0]!;
  expect(all.seen["cast:gang_standoff"]).toBeDefined();
  expect(hostiles({ hostility: 0 }).c.counts.woken).toBeGreaterThan(0);
  const none = hostiles({ hostility: 0 });
  expect([...none.c.stories.values()].some((s) => s.scene === "cast:gang_standoff")).toBe(false);
  const soft = hostiles({ hostility: 1 });
  expect([...soft.c.stories.values()].filter((s) => s.scene === "cast:gang_standoff").every((s) => s.choices.ending !== "turn_on_player")).toBe(true);
});

test("with nobody near, a woken story runs by the clock and ends, freeing its people; regulars come back", () => {
  const { city, c } = cast(8, { size: 40 });
  city.people = [{ name: "Ana", x: 3 * BLOCK + 64, z: 3 * BLOCK + 64 }];
  city.run(30, () => c.step());
  const woken = [...c.stories.values()].filter((s) => s.phase === "active");
  expect(woken.length).toBeGreaterThan(0);
  city.people = [];
  city.run(1000, () => c.step());
  for (const s of woken) expect(c.stories.has(s.id)).toBe(false);
  for (const p of c.people.byId.values()) expect(p.story === undefined || c.stories.has(p.story)).toBe(true);
  expect(c.counts.done).toBeGreaterThan(0);
});
