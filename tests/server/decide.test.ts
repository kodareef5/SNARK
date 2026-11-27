// The decider's row (server/decide/decide.ts): who is answered, in what order, and what is cut.
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CAPS, COST_PROBE, COST_RING, COST_YES, Decide, LEAVE, QUEUE, QUEUE_BACK, SPARE, type Ask, type Point } from "../../server/decide/decide.ts";
import { Pool } from "../../server/decide/pool.ts";
import { LineLog } from "../../server/decide/log.ts";
import { Lane } from "../../server/lane.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { answer } from "../../shared/decide/forward.ts";
import { RING_MID } from "../../shared/decide/profiles.ts";
import { RULE_MID } from "../../shared/decide/rules.ts";
import { tableFor } from "../../shared/decide/table.ts";
import { writeModel } from "../../shared/decide/weights.ts";
import { F_ALIVE } from "../../shared/sim/entities.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";

/** A world of `n` living movers. */
function movers(n = 64): { ents: { gen: Uint16Array; flags: Uint8Array } } {
  return { ents: { gen: new Uint16Array(n), flags: new Uint8Array(n).fill(F_ALIVE) } };
}

/** A point whose movers each see one free heading, their own number; it keeps who was asked and what was applied. */
class Probe implements Point {
  readonly name: string;
  readonly cost: number;
  readonly horizon: number;
  readonly table = tableFor(RING_MID, 8);
  readonly tables = [{ profile: RING_MID, table: this.table }];
  readonly asked: number[] = [];
  readonly applied: [number, number][] = [];
  gone = new Set<number>();
  constructor(name: string, cost: number, horizon = 0) {
    this.name = name;
    this.cost = cost;
    this.horizon = horizon;
  }
  still(e: number): boolean {
    return !this.gone.has(e);
  }
  answer(e: number, _tick: number, _rung: number, ask: Ask): number {
    this.asked.push(e);
    const t = this.table, w = RING_MID.columns.length;
    t.clear(8);
    t.rows[(e % 8) * w + RING_MID.c.run] = 1;
    return answer("choice", t, ask(RING_MID, t));
  }
  apply(e: number, _tick: number, _rung: number, pick: number): void {
    this.applied.push([e, pick]);
  }
  outcome(e: number, tick: number, out: Float32Array): number {
    out[0] = e;
    out[1] = tick;
    return 2;
  }
}

function decider(over: Partial<ConstructorParameters<typeof Decide>[0]> = {}): { d: Decide; world: ReturnType<typeof movers> } {
  const world = movers();
  return { d: new Decide({ world, lane: new Lane(), weights: null, ...over }), world };
}

test("a point that is off is never asked", () => {
  const { d } = decider();
  const p = new Probe("a", COST_YES);
  const id = d.add(p);
  expect(d.on(id)).toBe(false);
  d.put(id, 1, 0);
  d.step(1);
  expect(p.asked).toEqual([]);
  expect(d.report().points[0]).toMatchObject({ policy: "off", counts: { put: 0, answered: 0 } });
});

test("the rule answers and acts; watching answers and does not act", () => {
  const { d } = decider();
  const p = new Probe("a", COST_YES), q = new Probe("b", COST_YES);
  const a = d.add(p), b = d.add(q);
  d.set("a=rule, b=watch");
  d.put(a, 3, 0);
  d.put(b, 5, 0);
  d.step(1);
  // Each mover's one free heading is its own number.
  expect(p.applied).toEqual([[3, 3]]);
  expect([q.asked, q.applied]).toEqual([[5], []]);
  expect([d.acts(a), d.acts(b)]).toEqual([true, false]);
  expect(d.report().points.map((r) => [r.policy, r.counts.answered, r.counts.applied])).toEqual([["rule", 1, 1], ["watch", 1, 0]]);
});

test("a star names every point not named itself", () => {
  const { d } = decider();
  const a = d.add(new Probe("a", COST_YES)), b = d.add(new Probe("b", COST_YES));
  d.set("*=watch a=rule");
  expect(d.report().points.map((r) => r.policy)).toEqual(["rule", "watch"]);
  // A point added later takes what was set.
  d.add(new Probe("c", COST_YES));
  expect(d.report().points[2]!.policy).toBe("watch");
  expect([d.on(a), d.on(b)]).toEqual([true, true]);
});

test("each cost has its own cap, and what is over it is cut and keeps today's behaviour", () => {
  const { d } = decider();
  const ring = new Probe("ring", COST_RING), probe = new Probe("probe", COST_PROBE);
  const r = d.add(ring), p = d.add(probe);
  d.set("*=rule");
  for (let e = 0; e < CAPS[COST_RING]! + 5; e++) d.put(r, e, 0);
  for (let e = 0; e < 3; e++) d.put(p, e, 0);
  d.step(1);
  expect(ring.applied.length).toBe(CAPS[COST_RING]!);
  expect(probe.applied.length).toBe(3);
  expect(d.report().points[0]!.counts).toMatchObject({ put: CAPS[COST_RING]! + 5, cut: 5, answered: CAPS[COST_RING]! });
  // Nothing is carried to the next tick.
  d.step(2);
  expect(ring.applied.length).toBe(CAPS[COST_RING]!);
});

test("movers a player is close to are answered before the background, and the deepest in trouble first", () => {
  const { d } = decider();
  const p = new Probe("ring", COST_PROBE);
  const id = d.add(p);
  d.set("ring=rule");
  d.put(id, 10, 3, true);
  d.put(id, 11, 0);
  d.put(id, 12, 1, true);
  d.put(id, 13, 2);
  d.put(id, 14, 3);
  d.step(1);
  expect(p.asked).toEqual([14, 13, 11, 10, 12]);
});

test("the background gives way when the cap binds", () => {
  const { d } = decider();
  const p = new Probe("ring", COST_RING);
  const id = d.add(p);
  d.set("ring=rule");
  const cap = CAPS[COST_RING]!;
  // The background asks first and deepest, and is still what is cut.
  for (let e = 0; e < 4; e++) d.put(id, 40 + e, 3, true);
  for (let e = 0; e < cap; e++) d.put(id, e, 0);
  d.step(1);
  expect(p.asked).toEqual(Array.from({ length: cap }, (_, e) => e));
  expect(d.report().points[0]!.counts).toMatchObject({ cut: 4, backPut: 4, backCut: 4 });
});

test("a mover that is gone, remade or no longer asking is not answered", () => {
  const { d, world } = decider();
  const p = new Probe("a", COST_YES);
  const id = d.add(p);
  d.set("a=rule");
  for (const e of [1, 2, 3, 4]) d.put(id, e, 0);
  world.ents.flags[1] = 0;
  world.ents.gen[2] = 7;
  p.gone.add(3);
  d.step(1);
  expect(p.asked).toEqual([4]);
  expect(d.report().points[0]!.counts).toMatchObject({ stale: 3, answered: 1 });
});

test("a tick with no room in the lane answers nothing", () => {
  const at = { ms: 0 };
  const lane = new Lane(() => at.ms);
  const { d } = decider({ lane });
  const p = new Probe("a", COST_YES);
  const id = d.add(p);
  d.set("a=rule");
  lane.begin();
  at.ms = 30;
  d.put(id, 1, 0);
  d.put(id, 2, 0);
  d.step(1);
  expect(p.asked).toEqual([]);
  expect(d.report().points[0]!.counts.cut).toBe(2);
  lane.begin();
  d.put(id, 1, 0);
  d.step(2);
  expect(p.asked).toEqual([1]);
});

test("a tick holds so many questions and cuts the rest", () => {
  const { d } = decider();
  const id = d.add(new Probe("a", COST_YES));
  d.set("a=watch");
  for (let i = 0; i < QUEUE + 9; i++) d.put(id, i % 64, 0);
  d.step(1);
  expect([d.report().overflow, d.report().most]).toEqual([9, QUEUE]);
  expect(d.report().points[0]!.counts).toMatchObject({ put: QUEUE + 9, cut: QUEUE + 9 - CAPS[COST_YES]! });
});

test("however much the background asks, a mover a player is beside is still heard", () => {
  const { d } = decider();
  const p = new Probe("ring", COST_RING);
  const id = d.add(p);
  d.set("ring=rule");
  // The background fills all the room it has and more, then one stuck mover up close asks last.
  for (let i = 0; i < QUEUE + QUEUE_BACK; i++) d.put(id, 8 + (i % 40), 3, true);
  d.put(id, 5, 2);
  d.step(1);
  expect(p.asked[0]).toBe(5);
  expect(p.asked.length).toBe(CAPS[COST_RING]!);
  expect([d.report().overflow, d.report().backMost, d.report().most]).toEqual([QUEUE, QUEUE_BACK, 1]);
});

test("a question put before its point was turned off is not acted on", () => {
  const { d } = decider();
  const p = new Probe("a", COST_YES);
  const id = d.add(p);
  d.set("a=rule");
  d.put(id, 1, 0);
  d.set("a=off");
  d.step(1);
  expect([p.asked, p.applied]).toEqual([[], []]);
  expect(d.report().points[0]!.counts).toMatchObject({ put: 1, stale: 1, answered: 0 });
});

test("a mover's slot in the pool follows its number through a new generation", () => {
  const pool = new Pool(2, 8);
  const fresh: number[] = [];
  const hold = (e: number, gen: number, tick: number): number => pool.hold(e, gen, tick, (s) => void fresh.push(s));
  const a = hold(3, 1, 1);
  // Entity 3 dies and its number is given again: the new mover takes the old one's slot, cleared, and holds only one.
  expect(hold(3, 2, 2)).toBe(a);
  expect([fresh, pool.count(), pool.find(3, 1), pool.find(3, 2)]).toEqual([[a, a], 1, -1, a]);
  // The slot used longest ago goes first when the pool is full, and whoever held it is forgotten.
  const b = hold(4, 1, 3);
  hold(3, 2, 4);
  expect(hold(5, 1, 5)).toBe(b);
  expect([pool.find(4, 1), pool.find(3, 2), pool.taken]).toEqual([-1, a, 1]);
  pool.drop(3);
  expect([pool.find(3, 2), pool.count()]).toEqual([-1, 1]);
});

test("a point asked for a trained scorer falls to the rule where none is loaded", () => {
  const { d } = decider();
  const p = new Probe("a", COST_YES);
  const id = d.add(p);
  d.set("a=model");
  d.put(id, 5, 0);
  d.step(1);
  expect(p.applied).toEqual([[5, 5]]);
  expect(d.report().points[0]!.counts.fell).toBe(1);
});

test("trained weights are loaded for their profile, and a file for other columns is refused and said", () => {
  const dir = mkdtempSync(join(tmpdir(), "decide-weights-"));
  try {
    // A scorer that wants the least free heading, so its answers can be told from the rule's.
    const backward = writeModel({ ...RULE_MID, w1: RULE_MID.w1.map((v) => -v) });
    writeFileSync(join(dir, "ring.mid.json"), JSON.stringify(backward));
    writeFileSync(join(dir, "stale.json"), JSON.stringify({ ...backward, hash: 1 }));
    writeFileSync(join(dir, "broken.json"), "{");
    const said: string[] = [];
    const { d } = decider({ weights: dir, say: (line) => void said.push(line) });
    expect(d.report().trained).toEqual(["ring.mid"]);
    expect(d.report().refused.map((r) => r.split(":")[0])).toEqual(["broken.json", "stale.json"]);
    expect(said.length).toBe(2);
    const p = new Probe("a", COST_YES);
    const id = d.add(p);
    d.set("a=model");
    d.put(id, 5, 0);
    d.step(1);
    expect(p.applied[0]![1]).not.toBe(5);
    expect(d.report().points[0]!.counts.fell).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("one answer in so many is logged with its table, and what became of the mover follows", async () => {
  const dir = mkdtempSync(join(tmpdir(), "decide-log-"));
  try {
    const log = new LineLog(dir, "decide-w1");
    let settings = { policy: "a=rule", sample: 2, megabytes: 1 };
    const { d, world } = decider({ log, settings: () => settings });
    const p = new Probe("a", COST_YES, 10);
    const id = d.add(p);
    d.step(0);
    for (let tick = 1; tick <= 4; tick++) {
      d.put(id, tick, 1);
      d.step(tick);
    }
    // The second and the fourth were logged; the fourth's mover dies before its outcome is read.
    world.ents.flags[4] = 0;
    for (let tick = 5; tick <= 14; tick++) d.step(tick);
    await d.flush();
    const lines = readFileSync(join(dir, readdirSync(dir)[0]!), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.map((l) => [l.id, l.point ?? (l.gone ? "gone" : "outcome")])).toEqual([[1, "a"], [2, "a"], [1, "outcome"], [2, "gone"]]);
    expect(lines[0]).toMatchObject({ t: 2, rung: 1, policy: "rule", pick: 2 });
    expect(lines[0].tables[0]).toMatchObject({ profile: "ring.mid", k: 8 });
    expect(lines[0].tables[0].rows.length).toBe(8 * RING_MID.columns.length);
    expect(lines[0].tables[0].out.reduce((s: number, v: number) => s + v, 0)).toBeCloseTo(1, 3);
    expect(lines[2]).toMatchObject({ t: 12, outcome: [2, 12] });
    expect(d.report().points[0]!.counts).toMatchObject({ logged: 2, closed: 2 });
    // The setting is read again every five seconds, and only its own change undoes a policy set by hand.
    d.set("a=watch");
    d.step(5 * TICK_RATE);
    expect(d.report().points[0]!.policy).toBe("watch");
    settings = { ...settings, policy: "a=off" };
    d.step(10 * TICK_RATE);
    expect(d.report().points[0]!.policy).toBe("off");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the lab may see every answer with its table and force another candidate", () => {
  const { d } = decider();
  const p = new Probe("a", COST_YES);
  const id = d.add(p);
  d.set("a=rule");
  const seen: [number, number, number][] = [];
  d.tap = (point, e, _tick, _rung, pick) => void seen.push([point, e, Math.round(p.table.rows[(e % 8) * RING_MID.columns.length + RING_MID.c.run]!) + pick]);
  d.force = (_point, e) => (e === 2 ? 6 : e === 3 ? SPARE : LEAVE);
  d.put(id, 1, 0);
  d.put(id, 2, 0);
  d.put(id, 3, 0);
  d.step(1);
  // The third is answered and seen, and nothing is done to its mover: today's code stands for that one answer.
  expect(p.applied).toEqual([[1, 1], [2, 6]]);
  expect(seen).toEqual([[id, 1, 2], [id, 2, 7], [id, 3, 4]]);
  expect(d.report().points[0]!.counts).toMatchObject({ answered: 3, applied: 2 });
});

test("answers are kept for a page only while it looks, and weights are read again when asked", () => {
  const dir = mkdtempSync(join(tmpdir(), "decide-look-"));
  try {
    const { d } = decider({ weights: dir });
    const p = new Probe("a", COST_YES);
    const id = d.add(p);
    d.set("a=rule");
    d.put(id, 1, 0);
    d.step(1);
    expect(d.recent).toEqual([]);
    d.look(2, 3);
    for (let tick = 2; tick <= 6; tick++) {
      d.put(id, tick, 2);
      d.step(tick);
    }
    // Kept while the look lasts, and let go once it has ended.
    expect(d.recent).toEqual([]);
    d.look(7, 3);
    for (let tick = 7; tick <= 9; tick++) {
      d.put(id, tick, 2);
      d.step(tick);
    }
    expect(d.recent.map((r) => [r.t, r.point, r.rung, r.pick, r.id])).toEqual([[7, "a", 2, 7, 0], [8, "a", 2, 0, 0], [9, "a", 2, 1, 0]]);
    expect(d.recent[0]!.tables[0]!.profile).toBe("ring.mid");
    // A scorer written after the start decides once the weights are read again.
    expect(d.report().trained).toEqual([]);
    writeFileSync(join(dir, "ring.mid.json"), JSON.stringify(writeModel(RULE_MID, { made: "today" })));
    d.reload();
    expect(d.report().trained).toEqual(["ring.mid"]);
    expect(d.abouts.get("ring.mid")).toEqual({ made: "today" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a server's tick answers its decider's questions, timed as a part of its own", () => {
  const h = new Harness({}, 3, 30, { dev: true, wild: false, map: writeMap(flatMap(4)) });
  h.join("observer");
  h.run(500);
  const e = h.host.spawnCreature("core:dodo", 100, 100, 1);
  const p = new Probe("test", COST_RING);
  const id = h.host.decide.add(p);
  // Off, as every point is until the setting names it, a put is nothing.
  h.host.decide.put(id, e, 0);
  h.server.tick();
  expect(p.asked).toEqual([]);
  h.host.decide.set("test=rule");
  h.host.decide.put(id, e, 2);
  h.server.tick();
  expect(p.applied).toEqual([[e, e % 8]]);
  expect(h.server.parts.report().parts).toContain("decide");
});
