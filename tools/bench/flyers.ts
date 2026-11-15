// Rows for the minds of the air (planning/reference/flyers-plan.md, FL3): 200 wild pteranodons awake, flying about and
// landing by turns, over the proving ground and over a coast of frame towers to 192 m, and 200 tames told to stay in the air,
// which hover at no cost. `bun tools/bench/flyers.ts` runs these alone.

import { MODE_FLYER } from "../../shared/sim/character.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { Rng } from "../../shared/rng.ts";
import { coast } from "../../tests/fixtures/coast.ts";
import { Harness } from "../../tests/fixtures/net.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;

const FLYERS = 200;
const WARM_SECONDS = 30;
const MEASURE_SECONDS = 120;

/** The `q` quantile of `times`. */
const at = (times: number[], q: number): number => [...times].sort((a, b) => a - b)[Math.min(times.length - 1, Math.floor(times.length * q))]!;

/** A server with an admin in god mode at each of `corners`, so every chunk stays awake, and FLYERS pteranodons put down by `place`. */
function field(corners: readonly (readonly [number, number])[], place: (rng: Rng) => [number, number], map?: Uint8Array<ArrayBuffer>) {
  const h = new Harness({}, 1, 2, { dev: true, ...(map ? { map } : {}) });
  const admins = corners.map(([x, z], i) => {
    const s = h.join(`s${i}`);
    h.run(300);
    h.say(s, "enablecheats");
    h.host.survival.gods.add(h.client(s)!.pid);
    h.say(s, `tp ${x} ${z}`);
    return s;
  });
  h.run(500);
  const rng = new Rng(5);
  const list: number[] = [];
  for (let t = 0; list.length < FLYERS && t < FLYERS * 40; t++) {
    const [x, z] = place(rng);
    if (h.world.hf.heightAt(x, z) < h.world.hf.seaLevel + 0.5) continue;
    const e = h.host.spawnCreature("core:pteranodon", x, z, 1 + rng.int(30));
    if (e >= 0) list.push(e);
  }
  return { h, admins, list };
}

/** Runs `seconds`, timing each server tick, with the creatures stepped through collision and the share of `list` in flight. */
function measure(h: Harness, list: readonly number[], seconds: number): { ticks: number[]; stepped: number[]; aloft: number } {
  const out = { ticks: [] as number[], stepped: [] as number[], aloft: 0 };
  const server = h.server;
  const tick = server.tick.bind(server);
  let up = 0;
  server.tick = () => {
    const t = performance.now();
    tick();
    out.ticks.push(performance.now() - t);
    out.stepped.push(h.host.creatures.stepped);
    for (const e of list) if (h.world.ents.mode[e] === MODE_FLYER) up++;
  };
  h.run(seconds * 1000);
  server.tick = tick;
  out.aloft = up / (out.ticks.length * list.length);
  return out;
}

function rows(record: Row, name: string, m: ReturnType<typeof measure>, budgeted: boolean): void {
  record(`${name}: tick time, median`, at(m.ticks, 0.5), "ms", budgeted ? 2 : null);
  record(`${name}: tick time, 99th percentile`, at(m.ticks, 0.99), "ms", budgeted ? 8 : null);
  record(`${name}: tick time, worst`, Math.max(...m.ticks), "ms");
  record(`${name}: flyers stepped through collision a tick, median`, at(m.stepped, 0.5), "");
  record(`${name}: share of ticks a flyer is in the air`, m.aloft, "");
}

export function benchFlyers(section: Section, record: Row): void {
  section(`Minds for the air: ${FLYERS} wild pteranodons awake, flying and landing by turns, and ${FLYERS} tames hovering where they were told to stay`);
  const proving = field([[96, 96], [416, 96], [96, 416], [416, 416]], (rng) => [172 + rng.range(-70, 70), 256 + rng.range(-70, 70)]);
  record("proving ground: flyers awake", proving.h.host.creatures.awakeCount, "");
  proving.h.run(WARM_SECONDS * 1000);
  rows(record, "proving ground", measure(proving.h, proving.list, MEASURE_SECONDS), true);

  // Tamed, each told to stay where it is 20 m up: they hover still, which costs no collision step.
  const ents = proving.h.world.ents;
  const me = proving.h.host.records.byPid.get(proving.h.client(proving.admins[0]!)!.pid)!;
  for (const e of proving.list) {
    proving.h.host.taming.give(proving.h.host.records.byPid.get(ents.pid[e]!)!, me, 0.9, "forced");
    ents.mode[e] = MODE_FLYER;
    ents.flags[e] = ents.flags[e]! & ~F_GROUNDED;
    ents.vx[e] = ents.vy[e] = ents.vz[e] = 0;
    ents.setPosition(e, ents.x[e]!, Math.max(ents.y[e]!, proving.h.world.hf.heightAt(ents.x[e]!, ents.z[e]!) + 20), ents.z[e]!);
  }
  proving.h.run(3000);
  const hover = measure(proving.h, proving.list, 20);
  record("tames staying in the air: tick time, median", at(hover.ticks, 0.5), "ms");
  record("tames staying in the air: stepped through collision in the busiest tick", Math.max(...hover.stepped), "", 0);
  proving.h.host.shutdown();

  const city = field([[64, 64], [320, 64], [64, 320], [320, 320]], (rng) => [110 + rng.range(-10, 30), 192 + rng.range(-120, 120)], coast());
  city.h.run(WARM_SECONDS * 1000);
  rows(record, "coast of frame towers", measure(city.h, city.list, MEASURE_SECONDS), true);
  record("coast of frame towers: turns round something ahead, a flyer a minute", (city.h.host.creatures.mind.turned / FLYERS / (WARM_SECONDS + MEASURE_SECONDS)) * 60, "");
  city.h.host.shutdown();
}

if (import.meta.main) {
  benchFlyers(
    (title) => console.log(`\n${title}`),
    (name, value, unit, budget = null) => console.log(`  ${name.padEnd(72)} ${value.toFixed(value < 10 ? 3 : 1).padStart(12)} ${unit}${budget === null ? "" : value <= budget ? `  ok (budget ${budget})` : `  MISS (budget ${budget})`}`),
  );
}
