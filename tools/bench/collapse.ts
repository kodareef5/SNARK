// What a city building coming down costs (server/city-collapse.ts): the tick while a 1,120-piece tower falls and while
// CityCollapseMostAtOnce of them fall together, what a client near one is sent for the whole fall, what a building in
// doubt holds in memory, and how long every damaged building takes to judge after a restart. The towers are set down by
// hand (tests/fixtures/sketch.ts); with var/maps/miami.snmap built with its buildings, the restart is also timed on
// 1,000 of the real city's. `bun tools/bench/collapse.ts` runs these alone.

import { existsSync } from "node:fs";
import type { Source } from "../../server/combat.ts";
import { FORM_OPEN, formKind } from "../../shared/content/breaks.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { S_CHUNK } from "../../shared/net/protocol.ts";
import { Pieces, carrier, cost, gather, judge, pins } from "../../shared/world/bearing.ts";
import { rocket, type City } from "../../tests/fixtures/city.ts";
import { Harness } from "../../tests/fixtures/net.ts";
import { SIDE_BACK, SIDE_FRONT, SIDE_LEFT, SIDE_RIGHT, Sketch, sketchCity, sketchId } from "../../tests/fixtures/sketch.ts";
import { eachBuilding } from "../bearing.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;

const median = (v: number[]): number => [...v].sort((a, b) => a - b)[v.length >> 1] ?? 0;
const most = (v: number[]): number => v.reduce((a, b) => Math.max(a, b), 0);

/** A tower of 7 by 7 tiles round (x, z): a storey is 4 piers, a ring of 28 curtain walls and 48 slabs, 80 pieces. */
function tower(storeys: number, x: number, z: number): { s: Sketch; ground: number[] } {
  const s = new Sketch(7, 7, 8, x, z);
  s.storeys = s.playable = storeys;
  s.stair(0, 0, storeys);
  const ground: number[] = [];
  for (let storey = 0; storey < storeys; storey++) {
    const row = [[1, 1], [1, 3], [3, 1], [3, 3]].map(([i, j]) => s.pier(i!, j!, storey));
    for (let k = 0; k < 7; k++) row.push(s.edge("zcurt", "concrete", k, 0, SIDE_FRONT, storey), s.edge("zcurt", "concrete", k, 6, SIDE_BACK, storey), s.edge("zcurt", "concrete", 0, k, SIDE_LEFT, storey), s.edge("zcurt", "concrete", 6, k, SIDE_RIGHT, storey));
    if (storey === 0) ground.push(...row);
    for (let j = 0; j < 7; j++) for (let i = 0; i < 7; i++) if (i + j !== 0) s.slab(i, j, storey + 1);
  }
  return { s, ground };
}

/** Opens every piece of `refs`: blows no piece outlives a rung of. */
function open(c: City, refs: readonly number[]): void {
  const huge: Source = { ...rocket(c.h.reg), base: 1e7 };
  for (const ref of refs) {
    const p = c.at(ref);
    for (let k = 0; k < 4 && c.form(ref) !== FORM_OPEN && c.form(ref) !== -1; k++) c.h.host.combat.hitStructure(huge, ref, p.x, p.y, p.z);
  }
}

/** Times each tick of `h`'s server from now on, in milliseconds, into the list returned. */
function timed(h: Harness): number[] {
  const times: number[] = [];
  const tick = h.server.tick.bind(h.server);
  h.server.tick = () => {
    const t = performance.now();
    tick();
    times.push(performance.now() - t);
  };
  return times;
}

/** Runs `h` until no building is in doubt, 40 seconds at most. Returns the ticks it took. */
function fall(h: Harness, each?: () => void): number {
  const began = h.world.tick;
  while (h.host.cityCollapse.waiting > 0 && h.world.tick < began + 40 * TICK_RATE) {
    h.run(1000 / TICK_RATE);
    each?.();
  }
  return h.world.tick - began;
}

export async function benchCollapse(section: Section, record: Row): Promise<void> {
  section("City collapse: a 1,120-piece tower loses its ground storey's piers and walls, a client 40 m off");
  {
    const { s, ground } = tower(14, 128, 128);
    const c = sketchCity(s);
    const { h } = c;
    const structs = h.world.structs;
    // The judgement by itself: the building gathered, its pins made, and judged.
    const handle = h.world.buildings!.byId(sketchId(0));
    const p = new Pieces();
    const out = new Uint8Array(c.refs.length), pin = new Uint8Array(c.refs.length);
    const [gathers, judges] = [[] as number[], [] as number[]];
    for (let k = 0; k < 200; k++) {
      let t = performance.now();
      gather(h.world.buildings!, [handle], structs, h.reg, false, p);
      gathers.push(performance.now() - t);
      t = performance.now();
      judge(p, out, pin);
      judges.push(performance.now() - t);
    }
    record(`its ${p.n} pieces gathered, median`, median(gathers), "ms");
    record("judged once, median", median(judges), "ms", 0.5);
    record("operations of one judgement", cost.ops, "operations");
    const t0 = performance.now();
    pins(gather(h.world.buildings!, [handle], structs, h.reg, true, p), pin, out);
    record("its pins made from the map, once a building", performance.now() - t0, "ms");
    const session = h.join("ada");
    for (let n = 0; n < 100 && !structs.held.every((k) => h.client(session)?.known[k] === structs.chunks[k]!.version); n++) h.run(100);
    h.run(500);
    let bytes = 0, messages = 0;
    const end = h.ends[0]!, on = end.onMessage!;
    end.onMessage = (ch, d) => {
      if (d[0] === S_CHUNK) {
        bytes += d.length;
        messages++;
      }
      on(ch, d);
    };
    const times = timed(h);
    h.run(2000);
    const idle = median(times);
    times.length = 0;
    const collapse = h.host.cityCollapse;
    open(c, ground.map((k) => c.refs[k]!));
    // The opened pieces reach the client in the wait before the first wave.
    h.run(500);
    const struck = bytes;
    let held = 0, spent = 0;
    const ticks = 15 + fall(h, () => {
      held = Math.max(held, collapse.bytes);
      spent = Math.max(spent, collapse.spent);
    });
    h.run(500);
    record("ticks from the first loss until it is settled", ticks, "ticks");
    record("waves", collapse.waves, "waves");
    record("pieces fallen", collapse.fallen, "pieces");
    record("pieces hung", collapse.hung, "pieces");
    record("server tick while nothing happens, median", idle, "ms");
    record("server tick while it falls, median", median(times), "ms");
    record("server tick while it falls, worst", most(times), "ms", 33.3);
    record("pieces judged in the worst tick", spent, "judgements");
    record("memory held for the building in doubt", held / 1024, "KB");
    record("sent the client for the 32 pieces opened", struck, "bytes");
    record("sent the client for the whole fall after them", bytes - struck, "bytes", 4096);
    record("chunk messages in all", messages, "messages");
    const same = structs.held.every((k) => {
      const [mine, t] = [session.world!.structs.chunks[k]!, structs.chunks[k]!];
      for (let slot = 0; slot < t.high; slot++) if (mine.kind[slot] !== t.kind[slot]) return false;
      return true;
    });
    record("the client's rows are the server's", same ? 1 : 0, "of 1");
  }

  section("City collapse: 8 such towers falling at once (CityCollapseMostAtOnce), nobody near");
  {
    const towers = Array.from({ length: 8 }, (_, k) => tower(14, 64 + (k % 4) * 128, 64 + (k >> 2) * 128));
    const c = sketchCity(towers.map((t) => t.s), 8);
    const { h } = c;
    const times = timed(h);
    h.run(2000);
    const idle = median(times);
    times.length = 0;
    const collapse = h.host.cityCollapse;
    towers.forEach((t, k) => open({ ...c, refs: c.all[k]! }, t.ground.map((n) => c.all[k]![n]!)));
    let held = 0, falling = 0, spent = 0;
    const ticks = fall(h, () => {
      held = Math.max(held, collapse.bytes);
      falling = Math.max(falling, collapse.falling);
      spent = Math.max(spent, collapse.spent);
    });
    record("buildings falling at once", falling, "buildings");
    record("ticks until all are settled", ticks, "ticks");
    record("pieces fallen", collapse.fallen, "pieces");
    record("server tick while nothing happens, median", idle, "ms");
    record("server tick while they fall, median", median(times), "ms");
    record("server tick while they fall, worst", most(times), "ms", 33.3);
    record("pieces judged in the worst tick", spent, "judgements");
    record("memory held for the 8 in doubt", held / 1024, "KB");
  }

  section("City collapse after a restart: 1,000 buildings of 40 pieces with a carrier broken, judged within the tick's budget");
  {
    // Masts of 8 storeys, 20 m apart: each a pier and four slabs a storey.
    const masts: Sketch[] = [];
    for (let k = 0; k < 1000; k++) {
      const s = new Sketch(2, 2, 8, 20 + (k % 32) * 20, 20 + Math.floor(k / 32) * 20);
      s.storeys = s.playable = 8;
      for (let storey = 0; storey < 8; storey++) {
        s.pier(0, 0, storey);
        for (let n = 0; n < 4; n++) s.slab(n % 2, n >> 1, storey + 1);
      }
      masts.push(s);
    }
    const c = sketchCity(masts, 11);
    restart(c.h, c.all.map((refs) => refs[0]!), record);
  }

  const file = process.env.CITY_MAP ?? "var/maps/miami.snmap";
  if (!existsSync(file)) return;
  section("City collapse after a restart: 1,000 of Miami's buildings with a ground carrier broken");
  const h = new Harness({}, 1, 30, { dev: true, map: (await Bun.file(file).bytes()) as Uint8Array<ArrayBuffer> });
  if (!h.world.buildings) return;
  // The first thousand that have a carrier on the ground with an open form: that piece is opened.
  const structs = h.world.structs, reg = h.reg;
  const refs: number[] = [];
  const p = new Pieces();
  let all = 0;
  for (const handles of eachBuilding(h.world.buildings)) {
    if (refs.length === 1000) break;
    gather(h.world.buildings, handles, structs, reg, true, p);
    for (let k = 0; k < p.n; k++) {
      const mapKind = structs.mapKind(Math.floor(p.ref[k]! / 65536), p.ref[k]! & 0xffff);
      if (p.level[k] !== 0 || !carrier(reg, structs, mapKind) || formKind(reg, mapKind, FORM_OPEN, 0) === 0) continue;
      refs.push(p.ref[k]!);
      all += p.n;
      break;
    }
  }
  record("pieces of the 1,000 buildings", all, "pieces");
  restart(h, refs, record);
}

/** Opens the pieces `refs` in the store alone, as a save would hold them, then judges as after a load and times it. */
function restart(h: Harness, refs: readonly number[], record: Row): void {
  const structs = h.world.structs, reg = h.reg;
  const collapse = h.host.cityCollapse;
  for (const ref of refs) {
    const mapKind = structs.mapKind(Math.floor(ref / 65536), ref & 0xffff);
    structs.swap(ref, formKind(reg, mapKind, FORM_OPEN, 0));
  }
  const t0 = performance.now();
  collapse.begin();
  record(`the scan of ${structs.held.length} chunks that finds the ${collapse.waiting} buildings`, performance.now() - t0, "ms");
  // Each tick's judging alone, with the waves it starts.
  const steps: number[] = [];
  const step = collapse.step.bind(collapse);
  collapse.step = (tick) => {
    const t = performance.now();
    step(tick);
    steps.push(performance.now() - t);
  };
  const judgedBefore = collapse.judged;
  const began = h.world.tick;
  while (collapse.unjudged > 0 && h.world.tick < began + 60 * TICK_RATE) h.run(1000 / TICK_RATE);
  record("pieces judged, pins and all", collapse.judged - judgedBefore, "judgements");
  record("ticks until every building has been judged", h.world.tick - began, "ticks");
  record("the collapse's step over those ticks, in all", steps.reduce((a, b) => a + b, 0), "ms");
  record("its worst tick", most(steps), "ms", 5);
  record("buildings found to stand, and settled", collapse.settled, "buildings");
  record("buildings with something to bring down, 8 at a time", collapse.waiting, "buildings");
}

if (import.meta.main) {
  await benchCollapse((title) => console.log(`\n${title}`), (name, value, unit, budget = null) => {
    const verdict = budget === null ? "" : value <= budget ? `  ok (budget ${budget})` : `  MISS (budget ${budget})`;
    console.log(`  ${name.padEnd(58)} ${value.toFixed(value < 10 ? 3 : 1).padStart(12)} ${unit}${verdict}`);
  });
}
