// The /admin/ page's server side (server/admin): its routes answer only past the admin pages' gate in any spelling, with
// wrong guesses counted as before; no password leaves in anything they answer; the loop's meter sums ticks by the second
// and the minute; survivors are listed where they are; and the tribes' bases go out as the players' map cells.

import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Minutes, Stats, Survivors } from "../../shared/admin.ts";
import { MARKER_DEATH } from "../../shared/net/protocol.ts";
import { CELL_FILLED, Summary } from "../../shared/world/tactical.ts";
import { basesOf, basesVersion, isBase } from "../../server/admin/bases.ts";
import { adminAsked, type AdminGate } from "../../server/admin/gate.ts";
import { MINUTES_KEPT, SECONDS_KEPT, TickMeter } from "../../server/admin/meter.ts";
import { AdminPages } from "../../server/admin/routes.ts";
import { gaugesOf } from "../../server/admin/stats.ts";
import { Guesses } from "../../server/guesses.ts";
import { CATALOG } from "../../server/settings/catalog.ts";
import { Rules, changedSettings } from "../../server/settings/rules.ts";
import { SurvivorActivity } from "../../server/survivor-activity.ts";
import { readBases } from "../../client/core/admin/bases.ts";
import { Harness } from "../fixtures/net.ts";

/** A built page's folder, as far as the routes need one. */
function pageDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "snark-admin-"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>admin</title>");
  writeFileSync(join(dir, "admin.js"), "export {};");
  return dir;
}

/** Asks `pages` for `path` as a browser at 1.2.3.4 would, giving `password` at its sign-in if one is given. */
function asker(pages: AdminPages) {
  return async (gate: AdminGate, path: string, password?: string): Promise<Response | null> => {
    const req = new Request(`http://localhost${path}`, password === undefined ? {} : { headers: { authorization: `Basic ${btoa(`admin:${password}`)}` } });
    return await pages.answer(req, "1.2.3.4", gate, new URL(req.url).pathname);
  };
}

test("every admin route answers only past the gate, in any spelling of its path, and wrong guesses are counted as the sound board's", async () => {
  const h = new Harness();
  const dir = pageDir();
  try {
    const meter = new TickMeter(() => gaugesOf(h.host));
    const pages = new AdminPages({ host: h.host, meter, dir, start: { tick: 0, wall: Date.now() } });
    const ask = asker(pages);
    const paths = ["/admin", "/admin/", "/admin/index.html", "/admin/admin.js", "/admin/stats.json", "/admin/minutes.json", "/admin/survivors.json", "/admin/bases.bin", "/admin/nothing"];
    // Among them paths the sound board turns down once their dots and escaped slashes are resolved.
    const spellings = ["/Admin/Stats.json", "/ADMIN/", "//admin/survivors.json", "/admin//bases.bin", "/%61dmin/stats.json", "/admin/%73tats.json", "/admin/./stats.json", "/admin/source/../sounds.html", "/admin/source/core%2f..%2f..%2fsecret.txt"];
    // A server with neither --dev nor a password keeps every one shut.
    const shut: AdminGate = { dev: false, password: null, guesses: new Guesses(), tick: () => 0 };
    for (const path of [...paths, ...spellings]) expect([path, (await ask(shut, path))?.status]).toEqual([path, 404]);
    // Every spelling is the admin pages' (D702), so the site in front of several worlds refuses them all too.
    for (const path of [...paths, ...spellings, "/sounds.html", "/admin/sounds.json"]) expect([path, adminAsked(path)]).toEqual([path, true]);
    for (const path of ["/", "/index.html", "/adminx", "/administrator/", "/map.json"]) expect([path, adminAsked(path)]).toEqual([path, false]);
    // What is not an admin page, and the sound board's own, are not answered here.
    for (const path of ["/index.html", "/adminx", "/admin/../index.html", "/sounds.html", "/admin/sounds.json", "/admin/source/core/x/sound/brief.json"]) expect([path, await ask(shut, path)]).toEqual([path, null]);

    const gate: AdminGate = { dev: false, password: "kiwi", guesses: new Guesses(), tick: () => 0 };
    for (const path of [...paths, ...spellings, "/admin/content.json", "/admin/log/span.json"]) {
      const no = (await ask(gate, path))!;
      expect([path, no.status, no.headers.get("www-authenticate")]).toEqual([path, 401, 'Basic realm="SNARK admin", charset="UTF-8"']);
    }
    const right = async (path: string): Promise<Response> => (await ask(gate, path, "kiwi"))!;
    expect((await right("/admin/")).status).toBe(200);
    expect(await (await right("/admin/index.html")).text()).toBe("<!doctype html><title>admin</title>");
    expect((await right("/admin/admin.js")).headers.get("content-type")).toBe("text/javascript");
    expect([(await right("/admin")).status, (await right("/admin?x=1")).headers.get("location")]).toEqual([308, "admin/?x=1"]);
    for (const path of ["/admin/stats.json", "/Admin/Stats.json", "/admin/survivors.json", "/admin/minutes.json", "/admin/content.json", "/admin/log/span.json"]) expect([path, (await right(path)).headers.get("content-type")]).toEqual([path, "application/json"]);
    expect([(await right("/admin/nothing")).status, (await right("/admin/bases.bin?level=7")).status, (await right("/admin/bases.bin?level=2")).status]).toEqual([404, 400, 200]);
    // The content's names, for the page to write items and what was ridden as the game does.
    const labels = ((await (await right("/admin/content.json")).json()) as { labels: Record<string, string> }).labels;
    expect(Object.keys(labels).length).toBeGreaterThan(0);
    // A sign-in that is not base64 is asked again, not a fault.
    expect((await pages.answer(new Request("http://localhost/admin/", { headers: { authorization: "Basic %%%" } }), "1.2.3.4", gate, "/admin/"))!.status).toBe(401);
    // As enablecheats counts them: after three wrong guesses even the right one waits, and the count is the sound board's too.
    for (let k = 0; k < 3; k++) expect((await ask(gate, "/admin/stats.json", "pear"))!.status).toBe(401);
    expect((await right("/admin/stats.json")).status).toBe(429);
    // A development server opens them to whoever it lets in.
    expect((await ask({ ...shut, dev: true }, "/admin/survivors.json"))!.status).toBe(200);
    // Not built yet: said so.
    rmSync(join(dir, "index.html"));
    expect(await (await ask({ ...shut, dev: true }, "/admin/"))!.text()).toBe("build the client first");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    h.host.shutdown();
  }
});

test("a password is read from the sign-in as the UTF-8 the browser sends, so one beyond ASCII opens the pages and its bytes read one to a letter do not", async () => {
  const h = new Harness();
  const dir = pageDir();
  try {
    const pages = new AdminPages({ host: h.host, meter: new TickMeter(() => gaugesOf(h.host)), dir, start: { tick: 0, wall: Date.now() } });
    const gate: AdminGate = { dev: false, password: "über-kiwi", guesses: new Guesses(), tick: () => 0 };
    const sign = (bytes: Uint8Array, g = gate): Promise<Response | null> => Promise.resolve(pages.answer(new Request("http://localhost/admin/stats.json", { headers: { authorization: `Basic ${Buffer.from(bytes).toString("base64")}` } }), "1.2.3.4", g, "/admin/stats.json"));
    const utf8 = new TextEncoder().encode("admin:über-kiwi");
    expect((await sign(utf8))!.status).toBe(200);
    // The same letters a byte each, which is not what a browser asked for UTF-8 sends: wrong, and counted as wrong.
    expect((await sign(Uint8Array.from("admin:über-kiwi", (c) => c.charCodeAt(0))))!.status).toBe(401);
    // Bytes that are not UTF-8 at all are a wrong guess too, never a fault.
    expect((await sign(Uint8Array.from([0x61, 0x3a, 0xff, 0xfe, 0x80])))!.status).toBe(401);
    expect((await sign(utf8))!.status).toBe(200);
    // Letters no single byte holds.
    const far: AdminGate = { ...gate, password: "kīwi 鳥 🥝", guesses: new Guesses() };
    expect((await sign(new TextEncoder().encode("x:kīwi 鳥 🥝"), far))!.status).toBe(200);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    h.host.shutdown();
  }
});

test("a list of survivors that fails is not the second's answer: the next request in the same second makes it again", async () => {
  const h = new Harness();
  const dir = pageDir();
  try {
    h.join("ana");
    h.run(500);
    const pages = new AdminPages({ host: h.host, meter: new TickMeter(() => gaugesOf(h.host)), dir, start: { tick: 0, wall: 0 }, now: () => 5000 });
    const dev: AdminGate = { dev: true, password: null, guesses: new Guesses(), tick: () => 0 };
    const activity = h.host.activity;
    const summary = activity.summary.bind(activity);
    let fail = true;
    activity.summary = (rec) => {
      if (fail) throw new Error("the records could not be read");
      return summary(rec);
    };
    const ask = (): Promise<Response> => Promise.resolve(pages.answer(new Request("http://localhost/admin/survivors.json"), "1.2.3.4", dev, "/admin/survivors.json")!);
    expect(await ask().then(() => "answered", (e: unknown) => String(e))).toBe("Error: the records could not be read");
    fail = false;
    const got = (await (await ask()).json()) as Survivors;
    expect(got.survivors.map((s) => s.name)).toEqual(["ana"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    h.host.shutdown();
  }
});

test("no password leaves in any answer: a password setting says only that it is set", async () => {
  const rules = new Rules();
  for (const [name, value] of [["ServerPassword", "hunter2"], ["ServerAdminPassword", "kiwi-in-the-file"], ["SpectatorPassword", "only-watching"], ["XPMultiplier", "3"], ["SessionName", "Isla Admin"]]) expect(rules.assign(name!, value!, "file")).toBe("");
  const h = new Harness({}, 1, 60, { config: rules, adminPassword: "kiwi-given" });
  const dir = pageDir();
  try {
    const pages = new AdminPages({ host: h.host, meter: new TickMeter(() => gaugesOf(h.host)), dir, start: { tick: 0, wall: Date.now() } });
    const ask = asker(pages);
    const dev: AdminGate = { dev: true, password: null, guesses: new Guesses(), tick: () => 0 };
    const answers = await Promise.all(["/admin/stats.json", "/admin/survivors.json", "/admin/minutes.json", "/admin/bases.bin?level=0", "/admin/content.json", "/admin/log/span.json"].map(async (p) => (await ask(dev, p))!.text()));
    for (const secret of ["hunter2", "kiwi-in-the-file", "only-watching", "kiwi-given"]) for (const a of answers) expect(a.includes(secret)).toBe(false);
    const stats = JSON.parse(answers[0]!) as Stats;
    expect(stats.world.name).toBe("Isla Admin");
    expect(stats.settings.filter((s) => s.name.endsWith("Password"))).toEqual([
      { name: "ServerPassword", value: "set", source: "file", status: "live" },
      { name: "ServerAdminPassword", value: "set", source: "file", status: "live" },
      { name: "SpectatorPassword", value: "set", source: "file", status: "planned" },
    ]);
    expect(stats.settings.find((s) => s.name === "XPMultiplier")).toEqual({ name: "XPMultiplier", value: "3", source: "file", status: "live" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    h.host.shutdown();
  }
  // Every password the catalogue has is a secret, so a new one cannot be sent by forgetting to mark it.
  for (const row of CATALOG) if (/password/i.test(row.name)) expect([row.name, row.secret]).toEqual([row.name, true]);
  // Nothing at its default is told; a list is told an entry a line, and a flag with its dash.
  const more = new Rules();
  expect(changedSettings(more)).toEqual([]);
  const lines = CATALOG.find((r) => r.kind === "lines")!;
  more.put(lines, [8, 9], "file");
  more.put(CATALOG.find((r) => r.name === "UseDynamicConfig")!, true, "command line");
  expect(changedSettings(more).sort((a, b) => (a.name < b.name ? -1 : 1))).toEqual([
    { name: "-UseDynamicConfig", value: "True", source: "command line", status: "live" },
    { name: lines.name, value: ["8", "9"], source: "file", status: lines.status },
  ]);
});

test("the meter sums ticks by the second and the minute, a stall shows as seconds without ticks, and it holds a fixed run", () => {
  let online = 3;
  // The loop's clock is wall time here, from 0.
  const meter = new TickMeter(() => ({ online, bodies: 100, rss: 5e8, heap: 2e8, commits: 7 }), (clock) => clock, 0);
  const tickMs = 1000 / 30;
  let due = 0;
  // Three seconds of 30 ticks of 2 ms, one of them 40 ms and started 12 ms late.
  for (let s = 0; s < 3; s++) {
    for (let t = 0; t < 30; t++) {
      const slow = s === 1 && t === 10;
      const began = due + (slow ? 12 : 0.5);
      meter.tick(due, began, began + (slow ? 40 : 2));
      due += tickMs;
    }
  }
  // Then nothing for four seconds, and ticks given up.
  meter.drop(120, 7000);
  meter.tick(7000, 7000, 7002);
  const sec = meter.secondColumns();
  expect(sec.at).toEqual([0, 1000, 2000, 3000, 4000, 5000, 6000]);
  expect(sec.ticks).toEqual([30, 30, 30, 0, 0, 0, 0]);
  expect(sec.p50).toEqual([2, 2, 2, 0, 0, 0, 0]);
  expect(sec.worst).toEqual([2, 40, 2, 0, 0, 0, 0]);
  expect(sec.late).toEqual([0.5, 12, 0.5, 0, 0, 0, 0]);
  expect(meter.dropped).toBe(120);
  expect(meter.minutes.count).toBe(0);
  // A minute closes with its percentiles to within a bucket, its worst exact, and the gauges as it closed.
  online = 5;
  meter.tick(60_000, 60_000, 60_003);
  const m = meter.minuteColumns();
  expect(m.next).toBe(1);
  expect(m.columns.ticks).toEqual([91]);
  expect(m.columns.worst).toEqual([40]);
  expect(Math.abs(m.columns.p50[0]! - 2) / 2).toBeLessThan(0.1);
  expect(Math.abs(m.columns.p99[0]! - 40) / 40).toBeLessThan(0.1);
  expect(m.columns.dropped).toEqual([120]);
  expect([m.columns.online, m.columns.rss, m.columns.commits]).toEqual([[5], [5e8], [7]]);
  // Ninety ticks of 2 ms but one of 40, and one more of 2: the share of the minute in ticks, in percent.
  expect(m.columns.busy[0]).toBeCloseTo((89 * 2 + 40 + 2) / 600, 2);
  expect(meter.minuteColumns(1).columns.at).toEqual([]);
  // However long it runs, it holds two minutes of seconds and a day of minutes; a long stall costs no more.
  meter.tick(1e9, 1e9, 1e9 + 1);
  meter.tick(2e9, 2e9, 2e9 + 1);
  expect([meter.secondColumns().at.length, meter.minuteColumns().columns.at.length]).toEqual([SECONDS_KEPT, MINUTES_KEPT]);
});

test("survivors are listed online or last seen, where they are, with their deaths in wall time since the run began", async () => {
  const h = new Harness();
  const dir = pageDir();
  try {
    const ann = h.join("Ann");
    h.join("Bo");
    h.run(1500);
    const start = { tick: h.world.tick, wall: 1_000_000 };
    h.ends[1]!.close();
    h.run(500);
    let now = 1_000_000 + 30_000;
    const pages = new AdminPages({ host: h.host, meter: new TickMeter(() => gaugesOf(h.host)), dir, start, now: () => now });
    const rec = h.host.survivorRecord("Ann")!;
    // A death before this run began has no time, its ticks spanning time the server was down; one six ticks ago has.
    rec.markers.push({ kind: MARKER_DEATH, x: 10, y: 0, z: 20, tick: start.tick - 1 }, { kind: MARKER_DEATH, x: 30, y: 0, z: 40, tick: h.world.tick - 6 });
    const dev: AdminGate = { dev: true, password: null, guesses: new Guesses(), tick: () => 0 };
    const answer = async <T>(path: string): Promise<T> => JSON.parse(await (await asker(pages)(dev, path))!.text()) as T;
    const got = await answer<Survivors>("/admin/survivors.json");
    expect(got.survivors.map((r) => [r.name, r.online])).toEqual([["Ann", true], ["Bo", false]]);
    const a = got.survivors[0]!;
    const e = h.ent(ann);
    expect([a.x, a.z]).toEqual([Math.round(h.world.ents.x[e]! * 10) / 10, Math.round(h.world.ents.z[e]! * 10) / 10]);
    expect([a.level, a.dead, a.riding, a.tribe]).toEqual([1, false, "", ""]);
    expect(a.deaths).toEqual([{ tick: start.tick - 1, at: null, x: 10, z: 20 }, { tick: h.world.tick - 6, at: now - 200, x: 30, z: 40 }]);
    const b = got.survivors[1]!;
    expect(b.lastSeen).not.toBeNull();
    expect(b.playMs).toBeGreaterThan(0);
    // The answer is made at most once a second: within the second the list stands, and in the next one it is new.
    rec.name = "Ann Renamed";
    expect((await answer<Survivors>("/admin/survivors.json")).survivors[0]!.name).toBe("Ann");
    now += 1000;
    expect((await answer<Survivors>("/admin/survivors.json")).survivors[0]!.name).toBe("Ann Renamed");
    const stats = await answer<Stats>("/admin/stats.json");
    expect(stats.online).toEqual({ now: 1, max: h.server.opts.maxClients });
    expect(stats.bodies.groups.survivors).toBeGreaterThanOrEqual(1);
    expect(stats.bodies.count).toBe(h.world.ents.count);
    expect(stats.bodies.kinds.reduce((n, k) => n + k.n, 0)).toBe(h.world.ents.count);
    expect(stats.save).toBeNull();
    expect(stats.map).toMatchObject({ id: h.world.mapId, sizeX: h.world.hf.sizeX, sizeZ: h.world.hf.sizeZ });
    const minutes = await answer<Minutes>("/admin/minutes.json?from=0");
    expect([minutes.next, minutes.columns.at, minutes.columns.p50]).toEqual([0, [], []]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    h.host.shutdown();
  }
});

test("a survivor is last seen at its last checkpoint online, which is now while it is online and kept with its record", () => {
  const h = new Harness();
  try {
    const rec = h.host.records.create(h.reg.index.get("core:survivor")!, "Kai");
    let wall = 100_000;
    let now = 0;
    const activity = new SurvivorActivity(h.host.records, () => wall, () => now);
    expect(activity.lastSeen(rec)).toBeNull();
    activity.login(rec.pid);
    wall += 5000;
    expect(activity.lastSeen(rec)).toBe(105_000);
    wall += 25_000;
    now += 30_000;
    activity.checkpointAll();
    wall += 10_000;
    now += 10_000;
    activity.leave(rec.pid);
    wall += 3_600_000;
    // Another run of the server reads it from the record, and play time is as before.
    const again = new SurvivorActivity(h.host.records, () => wall, () => now);
    expect([again.lastSeen(rec), again.summary(rec)]).toEqual([140_000, { lastLogin: 100_000, playMs: 40_000 }]);
  } finally {
    h.host.shutdown();
  }
});

test("the bases are the chunks holding a tribe's structure, sent as the players' map cells, and read back as they were", () => {
  const base = new Summary();
  base.teams[0] = 0;
  base.teams[1] = 42;
  base.teamCount = 2;
  // A ruin's cell, nobody's, and two of tribe 42's, the second of a taller piece.
  base.info[0] = CELL_FILLED | (0 << 3) | 1;
  base.tint[0] = 2;
  base.info[17] = CELL_FILLED | (1 << 3) | 2;
  base.tint[17] = 5;
  base.info[18] = CELL_FILLED | (1 << 3) | 5;
  base.tint[18] = 5;
  base.filled = 3;
  base.version = 4;
  const ruins = new Summary();
  ruins.teamCount = 1;
  ruins.info[3] = CELL_FILLED | 1;
  ruins.filled = 1;
  ruins.version = 9;
  const summaries = [null, ruins, base, new Summary()];
  expect(summaries.map(isBase)).toEqual([false, false, true, false]);
  expect(basesVersion(summaries)).toBe(13);
  const got = readBases(basesOf(summaries, 0))!;
  expect(got.map((b) => [b.chunk, b.cells.level, b.cells.teamCount, [...b.cells.teams.subarray(0, 2)]])).toEqual([[2, 0, 2, [0, 42]]]);
  const cells = got[0]!.cells;
  expect([...cells.info.subarray(0, 20)].map((v, i) => [i, v]).filter(([, v]) => v !== 0)).toEqual([[0, base.info[0]], [17, base.info[17]], [18, base.info[18]]]);
  expect([cells.tint[17], cells.tint[18]]).toEqual([5, 5]);
  // With no base the answer is a count of none, and what does not read is refused.
  expect(readBases(basesOf([null, ruins], 3))).toEqual([]);
  expect(readBases(Uint8Array.of(5))).toBeNull();
});
