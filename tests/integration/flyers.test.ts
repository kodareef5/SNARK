// Minds for the air (planning/reference/flyers-plan.md, FL3), at ARK's numbers where it has them
// (assets/source/core/creatures/pteranodon/ref/FUNCTIONS.md, sections 2, 4 and 8): wild pteranodons flying about their home,
// landing on open ground and taking off again, fleeing by air, leaving the water and defending their egg; tames that follow
// in the air and on foot, land on the whistle and hover when told to stay.

import { expect, test } from "bun:test";
import { CUE_LAND, CUE_TAKEOFF } from "../../shared/anim/pose.ts";
import { CMD_ORDER, CMD_TAKE, ORDER_ALL, ORDER_FOLLOW, ORDER_LAND, ORDER_STAY, RESULT_BUSY, RESULT_INVALID, RESULT_OK } from "../../shared/net/protocol.ts";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { MODE_FLY, MODE_FLYER, MODE_SWIM, MODE_WALK } from "../../shared/sim/character.ts";
import { F_ALIVE, F_GROUNDED } from "../../shared/sim/entities.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { Rng } from "../../shared/rng.ts";
import { capsuleFree, groundUnder } from "../../shared/world/collide.ts";
import { TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { writeMap, type MapStatic } from "../../shared/world/mapfile.ts";
import { PROVING_POOL } from "../../shared/world/proving.ts";
import { GROUND_FREE, groundAt } from "../../shared/world/path.ts";
import type { HostOptions } from "../../server/host.ts";
import { building } from "../fixtures/cityworld.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";

const TICKS = 30;

/** A harness on `map` (the proving ground without one) with an admin in god mode at each of `at`, so their chunks stay awake. */
function watched(at: readonly (readonly [number, number])[], host: HostOptions = {}) {
  const h = new Harness({}, 1, 2, { dev: true, ...host });
  const sessions = at.map(([x, z], i) => {
    const s = h.join(`s${i}`);
    h.run(300);
    h.say(s, "enablecheats");
    h.host.survival.gods.add(h.client(s)!.pid);
    h.say(s, `tp ${x} ${z}`);
    return s;
  });
  h.run(500);
  return { h, sessions };
}

/** `n` wild pteranodons put down on dry ground where `place` says, at levels 1 to 30. */
function flock(h: Harness, n: number, place: (rng: Rng) => [number, number]): number[] {
  const rng = new Rng(4);
  const out: number[] = [];
  for (let t = 0; out.length < n && t < n * 40; t++) {
    const [x, z] = place(rng);
    if (h.world.hf.heightAt(x, z) < h.world.hf.seaLevel + 0.5) continue;
    const e = h.host.spawnCreature("core:pteranodon", x, z, 1 + rng.int(30));
    if (e >= 0) out.push(e);
  }
  expect(out.length).toBe(n);
  return out;
}

interface Watch {
  /** Ticks any of them was inside the ground or anything built or growing. */
  inside: number;
  /** 30 s windows in which one in its own flight the whole time got no further than 3 m from where it began. */
  stuck: number;
  /** Per flyer: the share of ticks in its own flight, its landings, and its longest stretch aloft and on the ground, in seconds. */
  aloft: number[];
  landings: number[];
  longestUp: number;
  longestDown: number;
  /** Ticks one was in the water, and landings on anything but dry ground it can stand on. */
  wet: number;
  badLandings: number;
  /** The highest one went over the ground under it, in metres. */
  highest: number;
}

/** Runs `seconds` and watches each of `list` every tick. */
function watch(h: Harness, list: readonly number[], seconds: number): Watch {
  const ents = h.world.ents;
  const p = h.reg.move[h.reg.index.get("core:pteranodon")!]!;
  const w: Watch = { inside: 0, stuck: 0, aloft: list.map(() => 0), landings: list.map(() => 0), longestUp: 0, longestDown: 0, wet: 0, badLandings: 0, highest: 0 };
  const run = list.map(() => ({ up: false, since: 0, wx: 0, wy: 0, wz: 0, far: 0, whole: true }));
  let tick = 0;
  const server = h.server;
  const step = server.tick.bind(server);
  server.tick = () => {
    step();
    tick++;
    list.forEach((e, i) => {
      const r = run[i]!;
      const [x, y, z] = [ents.x[e]!, ents.y[e]!, ents.z[e]!];
      if (!capsuleFree(h.world, x, y, z, p.radius, p.height)) w.inside++;
      const up = ents.mode[e] === MODE_FLYER;
      if (ents.mode[e] === MODE_SWIM) w.wet++;
      w.highest = Math.max(w.highest, y - groundUnder(h.world.hf, x, z, p.radius));
      if (up) w.aloft[i]!++;
      if (up !== r.up || tick === 1) {
        if (tick > 1) (r.up ? (w.longestUp = Math.max(w.longestUp, (tick - r.since) / TICKS)) : (w.longestDown = Math.max(w.longestDown, (tick - r.since) / TICKS)));
        // Set down from its own flight on the ground, dry, where it may stand: not on a roof, in a tree or on a slide.
        if (r.up && !up && tick > 1) {
          w.landings[i]!++;
          if (ents.mode[e] !== MODE_WALK || y < h.world.hf.seaLevel || y - groundUnder(h.world.hf, x, z, p.radius) > 0.05 || groundAt(h.world, p, x, z) !== GROUND_FREE) w.badLandings++;
        }
        r.up = up;
        r.since = tick;
      }
      if (tick % (30 * TICKS) === 1) {
        if (tick > 1 && r.whole && r.far < 3) w.stuck++;
        [r.wx, r.wy, r.wz, r.far, r.whole] = [x, y, z, 0, up];
      } else {
        r.far = Math.max(r.far, Math.hypot(x - r.wx, y - r.wy, z - r.wz));
        r.whole &&= up;
      }
    });
  };
  h.run(seconds * 1000);
  server.tick = step;
  list.forEach((_, i) => {
    w.aloft[i] = w.aloft[i]! / tick;
    const r = run[i]!;
    if (r.up) w.longestUp = Math.max(w.longestUp, (tick - r.since) / TICKS);
    else w.longestDown = Math.max(w.longestDown, (tick - r.since) / TICKS);
  });
  return w;
}

/** The share's least and greatest over the flock. */
const spread = (a: readonly number[]): [number, number] => [Math.min(...a), Math.max(...a)];

test("left 20 minutes, 100 wild pteranodons over the proving ground fly and land by turns, aloft 55 to 92% of the time, never inside anything, stuck or in the water", () => {
  const { h } = watched([[96, 96], [416, 96], [96, 416], [416, 416]]);
  const list = flock(h, 100, (rng) => [PROVING_POOL.x + rng.range(-60, 60), PROVING_POOL.z + rng.range(-60, 60)]);
  expect(h.host.creatures.awakeCount).toBe(100);
  const w = watch(h, list, 20 * 60);
  const [low, high] = spread(w.aloft);
  expect([w.inside, w.stuck, w.wet, w.badLandings]).toEqual([0, 0, 0, 0]);
  expect([low >= 0.55, high <= 0.92]).toEqual([true, true]);
  // Each lands every few minutes, stays up no longer than its longest leg and approach, and rests no longer than its longest rest.
  expect(Math.min(...w.landings)).toBeGreaterThanOrEqual(5);
  expect([w.longestUp < 240, w.longestDown <= 61, w.highest < 90]).toEqual([true, true, true]);
  h.host.shutdown();
});

/**
 * A coast of 6 by 6 chunks: sea to the west, a beach rising to flat land at 2 m, and frame towers of 4 to 48 storeys (16 to
 * 192 m) east of the beach, the city fixture's buildings of the Miami ruin kit, open between their floors.
 */
function coast(): Uint8Array<ArrayBuffer> {
  const chunks = 6;
  const side = (chunks * CHUNK_SIZE) / TERRAIN_CELL + 1;
  const heights = new Uint16Array(side * side);
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const x = i * TERRAIN_CELL;
      const y = x < 90 ? -6 : x < 130 ? -6 + ((x - 90) / 40) * 8 : 2;
      heights[j * side + i] = Math.round((y + 32) * 256);
    }
  }
  const statics: MapStatic[] = [];
  const rng = new Rng(12);
  for (const x of [176, 216, 256, 296, 336]) for (const z of [96, 144, 192, 240, 288]) statics.push(...building(x, z, 2, 4 + rng.int(45), 2, rng.int(4) * 16384));
  return writeMap(flatMap(chunks, { id: "test:coast", seaLevel: 0, heights, statics, spawns: [{ name: "Beach", x: 120, z: 192, yaw: 0 }] }));
}

test("left 20 minutes, 100 wild pteranodons over a coast of frame towers to 192 m go round and over them and land on the beach and the streets, never inside anything, stuck or in the sea", () => {
  const { h } = watched([[64, 64], [320, 64], [64, 320], [320, 320]], { map: coast() });
  const list = flock(h, 100, (rng) => [110 + rng.range(-10, 30), 192 + rng.range(-100, 100)]);
  const w = watch(h, list, 20 * 60);
  const [low, high] = spread(w.aloft);
  expect([w.inside, w.stuck, w.wet, w.badLandings]).toEqual([0, 0, 0, 0]);
  expect([low >= 0.55, high <= 0.92]).toEqual([true, true]);
  expect(Math.min(...w.landings)).toBeGreaterThanOrEqual(5);
  expect([w.longestUp < 240, w.longestDown <= 61]).toEqual([true, true]);
  // The towers were in their way: they went round them.
  expect(h.host.creatures.mind.turned).toBeGreaterThan(100);
  h.host.shutdown();
});
