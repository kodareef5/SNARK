// Rows for the group alarm: 3,000 dodos awake in flocks of twenty, wandering, then one struck every tick so its flock takes
// fright, then all of them standing, which should cost no collision step. `bun tools/bench/flock.ts` runs these alone.

import { TICK_RATE } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import { Harness } from "../../tests/fixtures/net.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;

const FLOCKS = 150;
const EACH = 20;

/** The `q` quantile of `times`. */
const at = (times: number[], q: number): number => [...times].sort((a, b) => a - b)[Math.min(times.length - 1, Math.floor(times.length * q))]!;

export function benchFlock(section: Section, record: Row): void {
  section(`The group alarm: ${FLOCKS * EACH} dodos awake in flocks of ${EACH}, one struck every tick, and all of them standing`);
  const h = new Harness({}, 1, 30, { dev: true });
  const ada = h.join("ada");
  h.run(500);
  h.say(ada, "enablecheats");
  const her = h.ent(ada);
  h.host.survival.gods.add(h.client(ada)!.pid);
  const ents = h.world.ents;
  const mind = h.host.creatures.mind;
  const rng = new Rng(9);
  const flocks: number[][] = [];
  const [hx, hz] = [ents.x[her]!, ents.z[her]!];
  for (let f = 0; f < FLOCKS; f++) {
    const flock: number[] = [];
    for (let tries = 0; flock.length < EACH && tries < 400; tries++) {
      const [cx, cz] = flock.length === 0 ? [hx + rng.range(-170, 170), hz + rng.range(-170, 170)] : [ents.x[flock[0]!]!, ents.z[flock[0]!]!];
      const e = h.host.spawnCreature("core:dodo", cx + (flock.length === 0 ? 0 : rng.range(-5, 5)), cz + (flock.length === 0 ? 0 : rng.range(-5, 5)), 1 + rng.int(30));
      if (e >= 0) flock.push(e);
    }
    if (flock.length > 0) flocks.push(flock);
  }
  h.run(2000);
  const server = h.server;
  const tick = server.tick.bind(server);
  /** Runs `seconds`, timing each server tick; `before` runs ahead of each. */
  const measure = (seconds: number, before?: (n: number) => void): { ticks: number[]; stepped: number[] } => {
    const out = { ticks: [] as number[], stepped: [] as number[] };
    server.tick = () => {
      before?.(out.ticks.length);
      const t = performance.now();
      tick();
      out.ticks.push(performance.now() - t);
      out.stepped.push(h.host.creatures.stepped);
    };
    h.run(seconds * 1000);
    server.tick = tick;
    return out;
  };
  record("dodos awake", h.host.creatures.awakeCount, "");

  const quiet = measure(10);
  record("wandering: tick time, median", at(quiet.ticks, 0.5), "ms", 8);
  record("wandering: tick time, 99th percentile", at(quiet.ticks, 0.99), "ms", 16);

  const alarmed = mind.alarmed;
  const struck = measure(10, (n) => {
    const flock = flocks[n % flocks.length]!;
    const e = flock[Math.floor(n / flocks.length) % flock.length]!;
    if ((ents.flags[e]! & 1) !== 0) h.host.creatures.provoke(e, ents.x[her]!, ents.z[her]!, her);
  });
  record("one struck every tick: tick time, median", at(struck.ticks, 0.5), "ms", 8);
  record("one struck every tick: tick time, 99th percentile", at(struck.ticks, 0.99), "ms", 16);
  record("dodos that took fright with the one struck, a tick", (mind.alarmed - alarmed) / struck.ticks.length, "");

  // Told to stand, they come to rest, and then none is stepped through collision.
  for (const flock of flocks) for (const e of flock) mind.stay(e, h.world.tick + 3600 * TICK_RATE);
  h.run(3000);
  const still = measure(5);
  record("all standing: tick time, median", at(still.ticks, 0.5), "ms");
  record("all standing: creatures stepped through collision in the busiest tick", Math.max(...still.stepped), "", 0);
  h.host.shutdown();
}

if (import.meta.main) {
  benchFlock(
    (title) => console.log(`\n${title}`),
    (name, value, unit, budget = null) => console.log(`  ${name.padEnd(72)} ${value.toFixed(value < 10 ? 3 : 1).padStart(12)} ${unit}${budget === null ? "" : value <= budget ? `  ok (budget ${budget})` : `  MISS (budget ${budget})`}`),
  );
}
