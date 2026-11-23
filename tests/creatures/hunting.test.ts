import { expect, test } from "bun:test";
import type { ClientSession } from "../../client/core/session.ts";
import { MIND_FLEE, MIND_HUNT, PATH_TICK_CELLS, PINNED_TICKS } from "../../server/behavior.ts";
import type { EntityRecord } from "../../server/records.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";

const QUARTER = 16384;

/** Ada, kept alive whatever bites her, on level open ground `wide` by `deep` whose south-west corner is `g`. */
function ground(wide: number, deep: number): { h: Harness; ada: ClientSession; g: { x: number; z: number; y: number }; me: EntityRecord } {
  const h = new Harness({}, 1, 60, { dev: true });
  const ada = h.join("ada");
  h.run(500);
  h.say(ada, "enablecheats");
  const g = flatGround(h, wide, deep);
  const me = h.host.records.byPid.get(h.client(ada)!.pid)!;
  h.host.survival.gods.add(me.pid);
  return { h, ada, g, me };
}

/** Puts her at (x, z) and waits for the move to land. */
function stand(h: Harness, ada: ClientSession, x: number, z: number): void {
  h.say(ada, `tp ${x.toFixed(3)} ${z.toFixed(3)}`, 200);
}

/** A row of `n` wall pieces of `kind` from (x, z), along X, or along Z when `alongZ`. Returns their refs. */
function wall(h: Harness, kind: string, x: number, y: number, z: number, n: number, alongZ = false): number[] {
  const k = h.reg.index.get(kind)!;
  const hp = (h.reg.defs[k] as { hp: number }).hp;
  return Array.from({ length: n }, (_, i) => h.world.structs.add(k, alongZ ? x : x + 1.5 + 3 * i, y + 1.5, alongZ ? z + 1.5 + 3 * i : z, alongZ ? QUARTER : 0, 0, hp));
}

/**
 * Walls round the square of side 3 * n whose south-west corner is (x, z), leaving out the pieces `gaps` names ("s2" is the south
 * side's third), with a doorframe for the piece `door` names.
 */
function yard(h: Harness, kind: string, x: number, y: number, z: number, n: number, gaps: string[] = [], door = ""): void {
  const s = 3 * n;
  for (const [side, x0, z0, alongZ] of [["s", x, z, false], ["n", x, z + s, false], ["w", x, z, true], ["e", x + s, z, true]] as const) {
    for (let i = 0; i < n; i++) {
      const name = `${side}${i}`;
      if (gaps.includes(name)) continue;
      wall(h, name === door ? kind.replace("wall", "doorframe") : kind, alongZ ? x0 : x0 + 3 * i, y, alongZ ? z0 + 3 * i : z0, 1, alongZ);
    }
  }
}

/** Runs a tick at a time until `done` holds or `ms` have passed. Returns how far `e` went, and the milliseconds it took, or -1. */
function walk(h: Harness, e: number, ms: number, done: () => boolean): { far: number; at: number } {
  const ents = h.world.ents;
  let [x, z] = [ents.x[e]!, ents.z[e]!];
  const out = { far: 0, at: -1 };
  for (let t = 0; t < ms; t += 1000 / 30) {
    h.run(1000 / 30);
    out.far += Math.hypot(ents.x[e]! - x, ents.z[e]! - z);
    [x, z] = [ents.x[e]!, ents.z[e]!];
    if (done()) {
      out.at = t + 1000 / 30;
      break;
    }
  }
  return out;
}

test("a hunter goes round a 24 m wall to its prey by nearly the shortest way, and the same world gives the same chase", () => {
  const chase = () => {
    const { h, ada, g, me } = ground(70, 40);
    const [cx, wz] = [g.x + 35.3, g.z + 20.6];
    wall(h, "core:wall_wood", cx - 12, g.y, wz, 8);
    stand(h, ada, cx + 2, wz + 6);
    const ents = h.world.ents;
    const mind = h.host.creatures.mind;
    const her = h.ent(ada);
    const e = h.host.spawnCreature("core:raptor", cx + 2, wz - 6, 1);
    // Facing her. The wall hides her, so it is set on her as if she had hurt it.
    ents.yaw[e] = 0;
    h.host.creatures.provoke(e, ents.x[her]!, ents.z[her]!, her);
    const trail: number[] = [];
    const run = walk(h, e, 8000, () => (trail.push(ents.x[e]!, ents.z[e]!), mind.bites > 0));
    // The bite lands a few ticks after it is begun.
    h.run(500);
    return { run, trail, searches: mind.searches, hunting: mind.mind[e], bitten: h.host.combat.last.victim === me.pid };
  };
  const a = chase();
  // Round the east end, nearer by 2 m: a 0.6 m body keeps 12.6 m east of the middle, and bites from 2.8 m.
  const best = Math.hypot(12.6 - 2, 6) + Math.hypot(12.6 - 2, 6) - 2.8;
  expect([a.hunting, a.bitten]).toEqual([MIND_HUNT, true]);
  expect(a.run.far).toBeGreaterThan(best * 0.95);
  expect(a.run.far).toBeLessThan(best * 1.25);
  expect(a.run.at).toBeLessThan(5000);
  expect(a.searches).toBeLessThan(4);
  const b = chase();
  expect(b.trail).toEqual(a.trail);
});

test("a hunter whose prey is shut in a base it can neither enter nor break runs from it and does not come back; at a thatch wall it bites the wall", () => {
  const { h, ada, g } = ground(70, 40);
  const ents = h.world.ents;
  const mind = h.host.creatures.mind;
  const [x0, z0] = [g.x + 30.2, g.z + 14.7];
  yard(h, "core:wall_wood", x0, g.y, z0, 2);
  stand(h, ada, x0 + 3, z0 + 3);
  const her = h.ent(ada);
  const e = h.host.spawnCreature("core:raptor", x0 + 3, z0 - 12, 1);
  h.host.creatures.provoke(e, ents.x[her]!, ents.z[her]!, her);
  expect(mind.mind[e]).toBe(MIND_HUNT);
  // The search finds no way in, a few ticks of budget later, and it runs.
  const fled = walk(h, e, 3000, () => mind.mind[e] === MIND_FLEE);
  expect([fled.at >= 0, fled.at < 1000, mind.gaveUp, mind.bites]).toEqual([true, true, 1, 0]);
  const from = () => Math.hypot(ents.x[e]! - ents.x[her]!, ents.z[e]! - ents.z[her]!);
  h.run(4500);
  expect(from()).toBeGreaterThan(25);
  // It rests after, and from outside it cannot see her.
  h.run(10000);
  expect([mind.hunts, mind.bites]).toEqual([1, 0]);
  h.host.creatures.remove(e);

  // With her against the south wall, it is within reach of her through the wall, but its bite does not harm wood.
  stand(h, ada, x0 + 3, z0 + 0.6);
  const near = h.host.spawnCreature("core:raptor", x0 + 3, z0 - 1.6, 1);
  h.host.creatures.provoke(near, ents.x[her]!, ents.z[her]!, her);
  h.run(500);
  expect([mind.mind[near], mind.gaveUp, mind.bites]).toEqual([MIND_FLEE, 2, 0]);
  h.host.creatures.remove(near);

  // A thatch wall it can harm, and so it bites it.
  const thatch = wall(h, "core:wall_thatch", x0 + 12, g.y, z0, 2);
  stand(h, ada, x0 + 13.5, z0 + 0.6);
  const biter = h.host.spawnCreature("core:raptor", x0 + 13.5, z0 - 1.6, 1);
  h.host.creatures.provoke(biter, ents.x[her]!, ents.z[her]!, her);
  h.run(3000);
  const t = h.world.structs.chunks[Math.floor(thatch[0]! / 65536)]!;
  expect([mind.mind[biter], mind.bites > 1, t.hp[thatch[0]! & 0xffff]! < 1600]).toEqual([MIND_HUNT, true, true]);
});

test("a creature fleeing inside a walled yard finds the gap out of it; in a yard with none it stands rather than run at the wall", () => {
  const { h, ada, g } = ground(80, 50);
  const ents = h.world.ents;
  const mind = h.host.creatures.mind;
  const [x0, z0] = [g.x + 20.4, g.z + 10.8];
  // 18 m square, with the fifth of the six north pieces left out.
  yard(h, "core:wall_stone", x0, g.y, z0, 6, ["n4"]);
  stand(h, ada, x0 - 6, z0 - 6);
  const e = h.host.spawnCreature("core:grazer", x0 + 9, z0 + 6, 1);
  // Hurt from the south-west, it runs north-east, at the corner of the yard.
  h.host.creatures.provoke(e, x0 + 3, z0, -1);
  expect(mind.mind[e]).toBe(MIND_FLEE);
  const out = walk(h, e, 5000, () => ents.z[e]! > z0 + 19);
  expect(out.at).toBeGreaterThan(0);
  expect(mind.searches).toBeGreaterThan(0);
  // Out through the gap, between x 12 and 15 of the yard.
  expect(ents.x[e]! - x0).toBeGreaterThan(6);
  h.host.creatures.remove(e);

  wall(h, "core:wall_stone", x0 + 12, g.y, z0 + 18, 1);
  const shut = h.host.spawnCreature("core:grazer", x0 + 9, z0 + 6, 1);
  h.host.creatures.provoke(shut, x0 + 3, z0, -1);
  h.run(2500);
  expect([mind.mind[shut], mind.move[shut]]).toEqual([MIND_FLEE, 0]);
  expect(ents.z[shut]! < z0 + 18 && ents.x[shut]! < x0 + 18).toBe(true);
});

test("a tame following its survivor goes round the house she went into and in by the doorway, wherever the house stands on the grid", () => {
  // Two places where no metre cell's middle lies on the line through the doorway, which a raptor fits with 0.1 m each side.
  for (const [dx, dz] of [
    [30.13, 20.88],
    [30.71, 20.29],
  ]) {
    const { h, ada, g, me } = ground(70, 50);
    const ents = h.world.ents;
    const mind = h.host.creatures.mind;
    // A 9 m house with a doorframe in the middle of its south wall.
    const [x0, z0] = [g.x + dx!, g.z + dz!];
    yard(h, "core:wall_wood", x0, g.y, z0, 3, [], "s1");
    const e = h.host.spawnCreature("core:raptor", x0 + 4.5, z0 + 15, 1);
    const rec = h.host.records.byPid.get(ents.pid[e]!)!;
    expect(h.host.taming.give(rec, me, 0, "forced")).toBe(true);
    h.run(200);
    stand(h, ada, x0 + 4.5, z0 + 4.5);
    rec.follow = me.pid;
    mind.follow(e, h.ent(ada));
    let crossed = NaN;
    const inside = () => {
      if (Math.abs(ents.z[e]! - z0) < 0.2) crossed = ents.x[e]! - x0;
      return Math.abs(ents.x[e]! - x0 - 4.5) < 4.4 && Math.abs(ents.z[e]! - z0 - 4.5) < 4.4;
    };
    const went = walk(h, e, 20000, inside);
    expect(went.at).toBeGreaterThan(0);
    // From north of the house round one side to the doorway, and in through it, with one search.
    expect(Math.abs(crossed - 4.5)).toBeLessThan(0.2);
    expect(went.far).toBeGreaterThan(20);
    expect(went.far).toBeLessThan(35);
    expect(mind.searches).toBe(1);
  }
});

test("a wall put down across the way a hunter follows makes it find another", () => {
  const { h, ada, g } = ground(70, 50);
  const ents = h.world.ents;
  const mind = h.host.creatures.mind;
  const [cx, wz] = [g.x + 35.3, g.z + 20.6];
  wall(h, "core:wall_wood", cx - 12, g.y, wz, 8);
  stand(h, ada, cx + 2, wz + 6);
  const her = h.ent(ada);
  const e = h.host.spawnCreature("core:raptor", cx + 2, wz - 6, 1);
  h.host.creatures.provoke(e, ents.x[her]!, ents.z[her]!, her);
  walk(h, e, 3000, () => mind.wayLeft(e) > 0);
  h.run(600);
  expect(mind.wayLeft(e)).toBeGreaterThan(0);
  const searches = mind.searches;
  // It makes for the east end. That end is walled off, from the wall's end south 9 m.
  expect(ents.x[e]!).toBeGreaterThan(cx + 4);
  wall(h, "core:wall_wood", cx + 12, g.y, wz - 9, 3, true);
  const round = walk(h, e, 12000, () => mind.bites > 0);
  expect(mind.searches).toBeGreaterThan(searches);
  expect(round.at).toBeGreaterThan(0);
  // It never went through a wall: it ends on her side of the long one.
  expect(ents.z[e]!).toBeGreaterThan(wz);
});

test("five hundred hunters at once stay within the search budget, and every one of them acts while it waits", () => {
  const { h, ada, g } = ground(90, 50);
  const ents = h.world.ents;
  const mind = h.host.creatures.mind;
  const [x0, wz] = [g.x + 27.2, g.z + 30.4];
  wall(h, "core:wall_wood", x0, g.y, wz, 12);
  stand(h, ada, x0 + 18, wz + 6);
  const her = h.ent(ada);
  // 25 abreast and 20 deep, all within the 35 m a raptor keeps chasing at.
  const pack: number[] = [];
  for (let i = 0; i < 500; i++) pack.push(h.host.spawnCreature("core:raptor", x0 + 3.6 + (i % 25) * 1.2, wz - 4 - Math.floor(i / 25), 1));
  expect(pack.every((e) => e >= 0)).toBe(true);
  for (const e of pack) h.host.creatures.provoke(e, ents.x[her]!, ents.z[her]!, her);
  const start = pack.map((e) => [ents.x[e]!, ents.z[e]!]);
  let most = 0;
  let idle = 0;
  // Each steers within three ticks of being set on her. From then on none stands idle, but one pinned at the wall while
  // it waits for its way stands there rather than run in place against it.
  h.run(100);
  h.run(4000, () => {
    most = Math.max(most, mind.spent);
    for (const e of pack) if (mind.mind[e] === MIND_HUNT && mind.move[e] === 0 && mind.pressed[e] === 0 && mind.pinned[e]! < PINNED_TICKS && Math.hypot(ents.x[e]! - ents.x[her]!, ents.z[e]! - ents.z[her]!) > 4) idle++;
  });
  expect(most).toBeLessThanOrEqual(PATH_TICK_CELLS);
  expect(mind.searches).toBeGreaterThan(20);
  expect(idle).toBe(0);
  // Every one has moved, and some are already round the wall.
  expect(pack.every((e, i) => Math.hypot(ents.x[e]! - start[i]![0]!, ents.z[e]! - start[i]![1]!) > 2)).toBe(true);
  expect(pack.filter((e) => ents.z[e]! > wz).length).toBeGreaterThan(20);
});
