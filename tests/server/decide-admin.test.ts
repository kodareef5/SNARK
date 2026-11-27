// The Decider page's server side (server/admin/decide.ts): its JSON, its actions through the admin pages' gate, the
// answers kept only while a page looks, the weights read again, and the lab's files where the checkout has them.

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DecideAdmin, LOOK_TICKS } from "../../server/admin/decide.ts";
import { changedNothing, type AdminGate } from "../../server/admin/gate.ts";
import { TickMeter } from "../../server/admin/meter.ts";
import { AdminPages } from "../../server/admin/routes.ts";
import { gaugesOf } from "../../server/admin/stats.ts";
import { CAPS, COST_RING, Decide, type Ask, type Point } from "../../server/decide/decide.ts";
import { Guesses } from "../../server/guesses.ts";
import type { Host } from "../../server/host.ts";
import { COUNT_NAMES, type DecideJson } from "../../shared/admin-decide.ts";
import { answer } from "../../shared/decide/forward.ts";
import { PROFILES, RING_MID } from "../../shared/decide/profiles.ts";
import { RULE_MID } from "../../shared/decide/rules.ts";
import type { EpisodeScore, LabStatus, Scoreboard, Score } from "../../shared/decide/scoreboard.ts";
import { tableFor } from "../../shared/decide/table.ts";
import { writeModel } from "../../shared/decide/weights.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";

const root = mkdtempSync(join(tmpdir(), "snark-decide-admin-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let folders = 0;
const folder = (): string => mkdtempSync(join(root, `f${++folders}-`));

const MAP = "map-kiwi";
const gate: AdminGate = { dev: false, password: MAP, guesses: new Guesses(), tick: () => 0 };

/** A point whose movers each see one free heading, their own number. */
class Probe implements Point {
  readonly name: string;
  readonly cost = COST_RING;
  readonly horizon = 0;
  readonly table = tableFor(RING_MID, 8);
  readonly tables = [{ profile: RING_MID, table: this.table }];
  constructor(name: string) {
    this.name = name;
  }
  still(): boolean {
    return true;
  }
  answer(e: number, _tick: number, _rung: number, ask: Ask): number {
    this.table.clear(8);
    this.table.rows[(e % 8) * RING_MID.columns.length + RING_MID.c.run] = 1;
    return answer("choice", this.table, ask(RING_MID, this.table));
  }
  apply(): void {}
}

/** A world with two stand-in points beside the real ones, and its admin pages signed in as kody with the map's password. */
let ring = -1;
type Answer = { ok?: boolean; why?: string } & Partial<DecideJson>;

function world(): { h: Harness; page: (path: string, body?: unknown) => Promise<{ status: number; json: Answer; req: Request }> } {
  const h = new Harness({}, 3, 30, { dev: true, wild: false, map: writeMap(flatMap(4)) });
  ring = h.host.decide.add(new Probe("test.ring"));
  h.host.decide.add(new Probe("test.snag"));
  const pages = new AdminPages({ host: h.host, meter: new TickMeter(() => gaugesOf(h.host)), dir: tmpdir(), start: { tick: 0, wall: 0 } });
  const page = async (path: string, body?: unknown) => {
    const req = new Request(`http://localhost${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Basic ${btoa(`kody:${MAP}`)}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const res = await pages.answer(req, "1.2.3.4", gate, new URL(req.url).pathname)!;
    return { status: res.status, json: (await res.json()) as Answer, req };
  };
  return { h, page };
}

const kodys = (h: Harness): string[] => h.host.acts.recent().filter((a) => a.name === "(kody)").map((a) => a.what);
const policies = (h: Harness): string[] => h.host.decide.report().points.filter((p) => p.name.startsWith("test.")).map((p) => `${p.name}=${p.policy}`);

test("the page's JSON says each point, the settings, the profiles and the part", async () => {
  const { h, page } = world();
  h.run(500);
  const { status, json, req } = await page("/admin/decide.json");
  expect(status).toBe(200);
  expect(changedNothing(req)).toBe(true);
  const names = [...COUNT_NAMES].sort();
  expect(json.points!.filter((p) => p.name.startsWith("test.")).map((p) => [p.name, p.policy, Object.keys(p.counts).sort()])).toEqual([["test.ring", "off", names], ["test.snag", "off", names]]);
  // The real points are listed too, every one of them off.
  expect(json.points!.filter((p) => p.name.startsWith("nav.")).every((p) => p.policy === "off")).toBe(true);
  const rules = h.host.rules, settings = { DecidePolicy: "", DecideSample: rules.num("DecideSample"), DecideLogMegabytes: rules.num("DecideLogMegabytes") };
  expect([json.caps, json.settings, json.recent, json.world, json.copied]).toEqual([[...CAPS], settings, [], 0, 0]);
  expect(json.profiles!.map((p) => p.name)).toEqual(PROFILES.map((p) => p.name));
  const mid = json.profiles!.find((p) => p.name === "ring.mid")!;
  expect([mid.ring, mid.trained, mid.rule!.weights.find(([n]) => n === "run")]).toEqual([true, null, ["run", 2]]);
  expect(mid.rule!.weights.find(([n]) => n === "left run")).toEqual(["left run", 0.4]);
  expect(json.part!.ticks).toBeGreaterThan(0);
  expect(json.size!.x).toBeGreaterThan(0);
  expect(kodys(h)).toEqual([]);
});

test("a point's policy is set through DecidePolicy and takes hold within five seconds", async () => {
  const { h, page } = world();
  h.run(200);
  expect((await page("/admin/decide", { op: "policy", point: "test.ring", policy: "rule" })).status).toBe(200);
  expect(h.host.rules.text("DecidePolicy")).toBe("test.ring=rule");
  // Kept beside the save as the settings page keeps it, and in the admin log.
  expect(h.host.kept.words.get("DecidePolicy")).toBe("test.ring=rule");
  expect(kodys(h)).toEqual(["setting DecidePolicy test.ring=rule"]);
  h.run(5100);
  expect(policies(h)).toEqual(["test.ring=rule", "test.snag=off"]);
});

test("a star and a named point are set together, and a point may follow the star again", async () => {
  const { h, page } = world();
  for (const [point, policy] of [["test.ring", "rule"], ["*", "watch"], ["test.snag", "model"]]) expect((await page("/admin/decide", { op: "policy", point, policy })).json.why).toBe("");
  expect(h.host.rules.text("DecidePolicy")).toBe("test.ring=rule,test.snag=model,*=watch");
  h.run(5100);
  expect(policies(h)).toEqual(["test.ring=rule", "test.snag=model"]);
  expect((await page("/admin/decide", { op: "policy", point: "test.snag", policy: "" })).status).toBe(200);
  h.run(5100);
  expect(policies(h)).toEqual(["test.ring=rule", "test.snag=watch"]);
  // A point there is not, or a policy there is not, is refused and changes nothing.
  const before = kodys(h).length;
  expect((await page("/admin/decide", { op: "policy", point: "nav.none", policy: "rule" })).json.why).toContain("no decision point called nav.none");
  expect((await page("/admin/decide", { op: "policy", point: "test.ring", policy: "maybe" })).status).toBe(400);
  expect(kodys(h).length).toBe(before);
});

test("only the three Decide settings may be set from the page", async () => {
  const { h, page } = world();
  expect((await page("/admin/decide", { op: "set", name: "decidesample", value: "64" })).status).toBe(200);
  expect(h.host.rules.num("DecideSample")).toBe(64);
  for (const name of ["XPMultiplier", "CastEnabled", "ServerAdminPassword"]) {
    const r = await page("/admin/decide", { op: "set", name, value: "2" });
    expect([name, r.status, r.json.why]).toEqual([name, 400, "only the Decide settings: DecidePolicy, DecideSample, DecideLogMegabytes"]);
  }
  expect((await page("/admin/decide", { op: "set", name: "DecideSample", value: "-3" })).status).toBe(400);
  expect((await page("/admin/decide", { op: "dance" })).json.why).toBe("unknown op");
  expect(kodys(h)).toEqual(["setting DecideSample 64"]);
});

test("answers are kept while the page looks and let go once nobody does", async () => {
  const { h, page } = world();
  h.run(200);
  const d = h.host.decide, e = h.host.spawnCreature("core:dodo", 100, 100, 1);
  d.set("test.ring=rule");
  const ask = (ticks: number): void => {
    for (let i = 0; i < ticks; i++) {
      d.put(ring, e, 2);
      h.server.tick();
    }
  };
  ask(5);
  expect((await page("/admin/decide.json")).json.recent).toEqual([]);
  await page("/admin/decide.json?look=1");
  ask(5);
  const seen = (await page("/admin/decide.json?look=1")).json.recent!;
  expect(seen.length).toBe(5);
  expect(seen[0]).toMatchObject({ point: "test.ring", rung: 2, policy: "rule", pick: e % 8 });
  expect([typeof seen[0]!.x, typeof seen[0]!.z]).toEqual(["number", "number"]);
  expect(seen[0]!.tables[0]!.profile).toBe("ring.mid");
  // Past the look's ten seconds nothing more is kept, and what was is let go.
  ask(LOOK_TICKS + 1);
  expect((await page("/admin/decide.json")).json.recent).toEqual([]);
  ask(5);
  expect((await page("/admin/decide.json")).json.recent).toEqual([]);
});

test("weights written after the start are read again when asked, with their scores", async () => {
  const { h } = world();
  const weights = folder();
  // A host whose decider reads weights from a folder of the test's.
  const d = new Decide({ world: h.world, lane: h.host.game.lane, weights });
  const host = Object.create(h.host, { decide: { value: d } }) as Host;
  const admin = new DecideAdmin(host, { lab: folder() });
  const mid = async () => (JSON.parse(await admin.json(false)) as DecideJson).profiles.find((p) => p.name === "ring.mid")!;
  expect((await mid()).trained).toBeNull();
  const score = { name: "mid-1", kind: "linear", gate: { pass: false, why: ["regret over 0.9 of the rule's"] }, regretRatio: 0.95, ece: 0.04 } as Partial<Score>;
  writeFileSync(join(weights, "ring.mid.json"), JSON.stringify(writeModel(RULE_MID, { score, made: "2026-11-27T10:00:00Z" })));
  writeFileSync(join(weights, "ring.far.json"), JSON.stringify({ ...writeModel(RULE_MID), profile: "ring.far" }));
  expect(await admin.act({ op: "reload" })).toBe("");
  const now = await mid();
  expect(now.trained).toEqual({ hidden: 0, temperature: 1, about: { score, made: "2026-11-27T10:00:00Z" } });
  expect((JSON.parse(await admin.json(false)) as DecideJson).refused).toEqual([expect.stringMatching(/^ring\.far\.json: /)]);
  expect(h.host.acts.recent().at(-1)!.what).toBe("read the decider's weights again: 1 loaded, 1 refused");
});

test("the lab's scoreboard and status are given where the checkout has them", async () => {
  const { h } = world();
  const lab = folder();
  const board: Scoreboard = { made: "2026-11-27T09:00:00Z", revision: "abc123", points: [{ point: "test.ring", profile: "ring.mid", headroom: 0.2, episodes: [], scores: [] }] };
  const status: LabStatus = { step: "fit", point: "test.ring", done: 3, of: 10, at: "2026-11-27T09:01:00Z" };
  writeFileSync(join(lab, "scoreboard.json"), JSON.stringify(board));
  writeFileSync(join(lab, "status.json"), JSON.stringify(status));
  const read = async (o: ConstructorParameters<typeof DecideAdmin>[1]) => (JSON.parse(await new DecideAdmin(h.host, o).json(false)) as DecideJson).lab;
  expect(await read({ lab })).toEqual({ scoreboard: board, status });
  expect(await read({ lab: folder() })).toEqual({ scoreboard: null, status: null });
  // A file half written is none, until it is whole.
  const broken = folder();
  writeFileSync(join(broken, "scoreboard.json"), "{\"made\":");
  expect(await read({ lab: broken })).toEqual({ scoreboard: null, status: null });
});

test("the page gets the lab's board without its row for every layout, read once", async () => {
  const { h } = world();
  const lab = folder(), file = join(lab, "scoreboard.json");
  const episode = (arrived: number): EpisodeScore => ({
    name: "rule", scenes: 2, arrived, ticks: 900, healthLost: 0, stuckTicks: 0, searches: 1, cells: 40, cost: 30, decideMicros: 50,
    layouts: [{ family: "pen", seed: 1, route: 40, arrived: true, ticks: 900, healthLost: 0, acted: 1 }],
  });
  const board = (arrived: number): Scoreboard => ({ made: "2026-11-27T09:00:00Z", revision: "abc123", points: [{ point: "test.ring", profile: "ring.mid", headroom: 0.2, episodes: [episode(arrived)], fresh: [episode(arrived)], scores: [] }] });
  // Written at a whole second, so the time can be given back exactly.
  const at = new Date("2026-11-27T09:00:00Z");
  writeFileSync(file, JSON.stringify(board(1)));
  utimesSync(file, at, at);
  let now = 0;
  const admin = new DecideAdmin(h.host, { lab, now: () => now });
  const read = async () => (JSON.parse(await admin.json(false)) as DecideJson).lab.scoreboard!.points[0]!;
  const first = await read();
  expect([first.episodes[0]!.arrived, first.episodes[0]!.layouts, first.fresh![0]!.layouts]).toEqual([1, undefined, undefined]);
  // The same bytes' length at the same time is the same file to the page: it is not read again.
  writeFileSync(file, JSON.stringify(board(2)));
  utimesSync(file, at, at);
  now += 60_000;
  expect((await read()).episodes[0]!.arrived).toBe(1);
  // A board written later is read.
  utimesSync(file, at, new Date(at.getTime() + 2000));
  now += 60_000;
  expect((await read()).episodes[0]!.arrived).toBe(2);
});

test("a world in no cluster refuses to copy its settings", async () => {
  const { h, page } = world();
  const r = await page("/admin/decide", { op: "clone" });
  expect([r.status, r.json.why]).toEqual([400, "this world is in no cluster, so there is no other world to copy to"]);
  expect(kodys(h)).toEqual([]);
});
