// Rows for the minds of the air (planning/reference/flyers-plan.md, FL3): 200 wild pteranodons awake, flying about and
// landing by turns, over the proving ground and over a coast of frame towers to 192 m, and 200 tames told to stay in the air,
// which hover at no cost. `bun tools/bench/flyers.ts` runs these alone; `bun tools/bench/flyers.ts --map FILE [--minutes N]`
// runs FL3's proof on a built map's beaches instead, or with `--at X,Z` round that point.

import { readFileSync } from "node:fs";
import { MODE_FLYER } from "../../shared/sim/character.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { Rng } from "../../shared/rng.ts";
import { parseMap } from "../../shared/world/mapfile.ts";
import { coast, flock, spread, watch, watched } from "../../tests/fixtures/flyers.ts";
import type { Harness } from "../../tests/fixtures/net.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;

const FLYERS = 200;
const WARM_SECONDS = 30;
const MEASURE_SECONDS = 120;

/** The `q` quantile of `times`. */
const at = (times: number[], q: number): number => [...times].sort((a, b) => a - b)[Math.min(times.length - 1, Math.floor(times.length * q))]!;

/** A server with an admin in god mode at each of `corners`, so every chunk stays awake, and FLYERS pteranodons put down by `place`. */
function field(corners: readonly (readonly [number, number])[], place: (rng: Rng) => [number, number], map?: Uint8Array<ArrayBuffer>) {
  const { h, sessions } = watched(corners, map ? { map } : {});
  return { h, admins: sessions, list: flock(h, FLYERS, place) };
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

/**
 * FL3's proof on a built map (`--map FILE`): 100 wild pteranodons on four of its beach regions, far apart and the largest
 * first, each with an admin in god mode who keeps the chunks within WAKE of it awake, left `minutes` and watched every tick.
 */
export function benchFlyersOn(section: Section, record: Row, path: string, minutes = 20, centre: readonly [number, number] | null = null): void {
  const file = new Uint8Array(readFileSync(path));
  const map = parseMap(file);
  const beaches = (map.regions ?? []).filter((r) => r.spawns === "core:spawns_beach").sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
  const chosen: { at: readonly [number, number]; radius?: number; half?: readonly [number, number] }[] = [];
  // With `centre`, all of them are put down within 120 m of it instead, among whatever is built there.
  if (centre) chosen.push({ at: centre, radius: 120 });
  else for (const r of beaches) if (chosen.length < 4 && chosen.every((c) => Math.hypot(c.at[0] - r.at[0], c.at[1] - r.at[1]) > 2 * WAKE * 64)) chosen.push(r);
  const where = chosen.map((c) => `(${c.at[0].toFixed(0)}, ${c.at[1].toFixed(0)})`).join(", ");
  section(`Minds for the air on ${map.id}: 100 wild pteranodons ${centre ? "put down" : `on ${chosen.length} of its ${beaches.length} beach regions,`} at ${where}, left ${minutes} minutes`);
  const { h } = watched(chosen.map((r) => [r.at[0], r.at[1]] as const), { map: file as Uint8Array<ArrayBuffer>, wakeRadius: WAKE });
  const each = Math.ceil(100 / chosen.length);
  const list = chosen.flatMap((r, i) => flock(h, Math.min(each, 100 - i * each), (rng) => {
    const a = rng.float() * Math.PI * 2;
    const d = (r.radius ?? r.half?.[0] ?? 30) * Math.sqrt(rng.float());
    return [r.at[0] + Math.sin(a) * d, r.at[1] + Math.cos(a) * d];
  }));
  record("flyers put down on dry ground", list.length, "");
  const t0 = performance.now();
  const w = watch(h, list, minutes * 60);
  const [low, high] = spread(w.aloft);
  record("seconds the run took", (performance.now() - t0) / 1000, "s");
  record("ticks one was inside the ground or anything built or growing, by over 1 cm", w.inside, "", 0);
  record("ticks one grazed something, within the step's rounding past its skin", w.grazed, "");
  record("30 s windows one in flight got no further than 3 m", w.stuck, "", 0);
  record("ticks one was in the water", w.wet, "");
  record("landings not on dry ground it may stand on", w.badLandings, "", 0);
  record("share of the time aloft, least of them", low, "");
  record("share of the time aloft, most of them", high, "");
  record("landings, fewest of them", Math.min(...w.landings), "");
  record("longest stretch aloft", w.longestUp, "s");
  record("longest stretch on the ground", w.longestDown, "s");
  record("highest over the ground under it", w.highest, "m");
  record("turns round something ahead, a flyer a minute", h.host.creatures.mind.turned / list.length / minutes, "");
  record("progress checks failed, a flyer an hour", (h.host.creatures.mind.stalled / list.length / minutes) * 60, "");
  record("tick time, median", at(w.ticks, 0.5), "ms");
  record("tick time, 99th percentile", at(w.ticks, 0.99), "ms");
  record("tick time, worst", Math.max(...w.ticks), "ms");
  h.host.shutdown();
}

/** Chunks round each admin of benchFlyersOn kept awake, so a flyer's wander of 150 m keeps within them. */
const WAKE = 5;

if (import.meta.main) {
  const section = (title: string): void => console.log(`\n${title}`);
  const record = (name: string, value: number, unit: string, budget: number | null = null): void =>
    console.log(`  ${name.padEnd(72)} ${value.toFixed(value < 10 ? 3 : 1).padStart(12)} ${unit}${budget === null ? "" : value <= budget ? `  ok (budget ${budget})` : `  MISS (budget ${budget})`}`);
  const mapAt = process.argv.indexOf("--map");
  const atAt = process.argv.indexOf("--at");
  const at = atAt >= 0 ? (process.argv[atAt + 1]!.split(",").map(Number) as [number, number]) : null;
  if (mapAt >= 0) benchFlyersOn(section, record, process.argv[mapAt + 1]!, Number(process.argv[process.argv.indexOf("--minutes") + 1] ?? 20) || 20, at);
  else benchFlyers(section, record);
}
