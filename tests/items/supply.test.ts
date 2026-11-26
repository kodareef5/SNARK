// A supply drop from its call to its going (server/supply.ts): called, cast from the nearest obelisk at its ignition,
// landed as a capsule holding its table's roll, opened at its tier's level, emptied, gone; what every session is told
// of it wherever it stands and whenever it joined; and what a stop, a kill and a module do to it. The capsule as a
// container is in tests/items/supply-capsule.test.ts.

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClientSession } from "../../client/core/session.ts";
import { createHost } from "../../server/host.ts";
import type { EntityRecord } from "../../server/records.ts";
import { SUPPLY_TAG, type Drop } from "../../server/supply.ts";
import { CHUNK_SIZE, TICK_RATE } from "../../shared/coords.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { BOX_OPEN, BOX_SELF, CMD_MOVE, RESULT_OK, TEXT_NOTICE } from "../../shared/net/protocol.ts";
import { BTN_USE } from "../../shared/sim/character.ts";
import { F_ALIVE } from "../../shared/sim/entities.ts";
import { LEAVE_SECONDS, SENDER_ZENITH, SUPPLY_MOST, SUPPLY_ROWS, quantise, readSupply, writeSupply, type SupplyList } from "../../shared/sim/supply.ts";
import type { SupplyBook } from "../../shared/supply/book.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { CAST_PHASE, EYE_KNOT, eyeKnot, eyePhase, type TideEyeSite } from "../../shared/world/tide-eye.ts";
import { SUPPLY_TAKERS } from "../fixtures/crash-child.ts";
import { flatMap } from "../fixtures/map.ts";
import { listener } from "../fixtures/module.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const CAPSULE = reg.index.get("core:supply_capsule")!;
const dir = mkdtempSync(join(tmpdir(), "snark-supply-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const BLUE: TideEyeSite = { name: "Blue", color: "blue", x: 64, z: 64, y: 0, yaw: 0, radius: 70 };
const RED: TideEyeSite = { name: "Red", color: "red", x: 448, z: 448, y: 0, yaw: 0, radius: 70 };
/** Level ground 512 m on a side with its spawn in the middle, and the obelisks given. */
const ground = (eyes: readonly TideEyeSite[] = [BLUE], more: Parameters<typeof flatMap>[1] = {}) => writeMap(flatMap(8, { tideEyes: [...eyes], ...more }));
type Pilot = Harness["pilots"][number];
type HostMore = ConstructorParameters<typeof Harness>[3];

/** Ada with cheats at (x, z), looking up the ground. */
function world(host: HostMore = {}, x = 250, z = 250) {
  const h = new Harness({}, 1, 60, { dev: true, map: ground(), log: () => {}, ...host });
  const ada = h.join("ada");
  h.run(500);
  h.say(ada, "enablecheats");
  h.say(ada, `tp ${x} ${z}`);
  const pilot = h.pilots[0]!;
  pilot.yaw = 0;
  pilot.pitch = -0.35;
  h.run(300);
  return { h, ada, pilot, me: h.host.records.byPid.get(h.client(ada)!.pid)! };
}

const tapUse = (h: Harness, pilot: Pilot): void => {
  pilot.buttons = BTN_USE;
  h.run(100);
  pilot.buttons = 0;
  h.run(300);
};
const seconds = (h: Harness, ticks: number): void => h.run((ticks / TICK_RATE) * 1000);
/** Runs to `more` ticks past the tick `at`. */
const until = (h: Harness, at: number, more = 6): void => seconds(h, Math.max(0, at - h.world.tick) + more);
/** What a session should hold: the server's list as its message carries it. */
const told = (h: Harness): SupplyList => {
  const w = new BitWriter(16384);
  writeSupply(w, h.host.supply.list());
  return readSupply(new BitReader(w.bytes().slice()))!;
};
const capsules = (h: { host: Harness["host"] }): EntityRecord[] => [...h.host.records.byPid.values()].filter((r) => r.kind === CAPSULE);
const holds = (h: { host: Harness["host"] }, box: EntityRecord): string[] => {
  const inv = h.host.items.inv(box);
  const out: string[] = [];
  for (let s = 0; s < inv.cap; s++) if (inv.item[s] !== 0) out.push(`${reg.ids[inv.item[s]!]!.slice(5)} x${inv.count[s]} q${inv.quality[s]} f${inv.flags[s]}`);
  return out;
};
const notices = (s: ClientSession, from: number): string[] => s.log.slice(Math.max(0, s.log.length - (s.logVersion - from))).filter((l) => l.channel === TEXT_NOTICE).map((l) => l.text);
const call = (h: Harness, x: number, z: number, tier: string, cls: string, more: Partial<Parameters<Harness["host"]["supply"]["call"]>[0]> = {}): Drop => {
  const d = h.host.supply.call({ x, z, tier, cls, source: "test", ...more });
  if (typeof d === "string") throw new Error(d);
  return d;
};
/** The book in force with `change` made to it, saved as its next revision. */
const edit = (h: Harness, change: (book: SupplyBook) => void): void => {
  const store = h.host.supplyBook;
  const next = JSON.parse(JSON.stringify(store.book)) as SupplyBook;
  const revision = store.book.revision;
  change(next);
  expect(store.save(next, revision, "test", "")).toEqual({ ok: true, revision: revision + 1 });
};

test("a drop from the console: its shaft stands, its cast leaves the obelisk at its ignition, it lands holding its table's roll, opens at its tier's level, and leaves when it is emptied", () => {
  const events = listener("ears", ["supply.landed", "supply.opened", "supply.gone"]);
  const { h, ada, pilot, me } = world({ modules: [events.def] });
  expect(h.say(ada, "supply list")).toEqual(["no drops are live"]);
  expect(h.say(ada, "supply call 250 252 white arms plain 20")[0]).toMatch(/^called 1: white arms at 250 252, coming, lands in \d+ s$/);
  const d = h.host.supply.drops[0]!;
  // Sent by the map's one obelisk, from the knot of storm over its emitter, at its cast phase: at full power, never shut.
  const knot = eyeKnot(BLUE);
  expect([d.sender, d.eye, d.ox, d.oy, d.oz, d.x, d.y, d.z]).toEqual([0, 0, quantise(knot.x), EYE_KNOT, quantise(knot.z), 250, 0, 252]);
  expect(Math.hypot(knot.x - BLUE.x, knot.z - BLUE.z)).toBeGreaterThan(1);
  expect(Math.abs(eyePhase(d.release / TICK_RATE, BLUE) - CAST_PHASE)).toBeLessThan(1e-6);
  const wait = (d.land - d.called) / TICK_RATE;
  expect([wait >= 20, wait < 140, d.land - d.release, d.brake, d.end - d.land]).toEqual([true, true, 30 * TICK_RATE, 7 * TICK_RATE, 1200 * TICK_RATE]);
  // Her session holds it as the server does; nothing lies there yet.
  expect([ada.supply, ada.supply.rows.length, ada.supply.tiers, ada.supply.classes]).toEqual([told(h), 1, [{ name: "White", rgb: d.rgb, level: 3, count: 1 }], [{ name: "Arms", mark: 1 }]]);
  expect([capsules(h).length, h.host.supply.state(d), h.host.supply.saved.dirty]).toEqual([0, "coming", true]);
  until(h, d.release, 30);
  expect(h.host.supply.state(d)).toBe("flying");
  until(h, d.land - d.brake, 30);
  expect([h.host.supply.state(d), capsules(h).length]).toEqual(["braking", 0]);
  until(h, d.land);
  // Landed: one capsule, tagged with its drop, holding the roll, its time the drop's.
  const [box] = capsules(h);
  expect([h.host.supply.state(d), capsules(h).length, d.pid, d.landed, box!.name, box!.x, box!.y, box!.z, box!.expiresAt, [...box!.extra.get(SUPPLY_TAG)!]]).toEqual(["landed", 1, box!.pid, true, "White Arms drop", 250, 0, 252, d.end, [1, 0]]);
  expect([holds(h, box!).length > 3, h.host.items.audit(), ada.supply]).toEqual([true, [], told(h)]);
  expect(ada.supply.rows[0]!.landed).toBe(true);
  expect(h.say(ada, "supply open 1")[1]!.split(", ").length).toBe(holds(h, box!).length);
  // Below the tier's level it stays shut, and says the level.
  let from = ada.logVersion;
  tapUse(h, pilot);
  expect([h.client(ada)!.open, notices(ada, from), d.opened]).toEqual([0, ["A White drop opens at level 3."], false]);
  h.say(ada, "addxp 400");
  expect(h.host.progression.level(me)).toBeGreaterThanOrEqual(3);
  tapUse(h, pilot);
  expect([h.client(ada)!.open, ada.open?.name, ada.open?.takeOnly, d.opened, ada.supply.rows[0]!.opened]).toEqual([box!.pid, "White Arms drop", true, true, true]);
  // She takes it all, and it goes: shut and up, its row leaving, then nothing.
  const inside = h.host.items.inv(box!);
  let took = 0;
  for (let s = 0; s < inside.cap; s++) {
    if (inside.item[s] === 0) continue;
    let code = -1;
    ada.onResult = (seq, c) => void (seq !== 0 && (code = c));
    const item = inside.item[s]!;
    ada.command(CMD_MOVE, (w: BitWriter) => (w.bits(BOX_OPEN, 1), w.varint(s), w.bits(BOX_SELF, 1), w.varint(h.host.items.inv(me).free()), w.u16(0), w.u16(item)));
    h.run(150);
    expect(code).toBe(RESULT_OK);
    took++;
  }
  h.run(200);
  from = ada.logVersion;
  expect([capsules(h).length, h.client(ada)!.open, d.left > d.land, d.pid, h.host.supply.state(d), ada.supply, h.host.supply.live()]).toEqual([0, 0, true, 0, "leaving", told(h), 0]);
  expect(ada.supply.rows[0]!.left).toBe(d.left);
  until(h, d.left + LEAVE_SECONDS * TICK_RATE);
  expect([h.host.supply.drops, ada.supply.rows, h.host.items.audit(), h.say(ada, "supply list")]).toEqual([[], [], [], ["no drops are live"]]);
  const heard = events.heard.lines.map((l) => l.replace(/"(pid|byPid|stacks)":\d+/g, '"$1":0'));
  // It told of as many stacks as she then took.
  expect(Number(/"stacks":(\d+)/.exec(events.heard.lines[0]!)![1])).toBe(took);
  expect(heard).toEqual([
    'supply.landed: {"id":1,"pid":0,"x":250,"y":0,"z":252,"tier":"white","class":"arms","ringed":0,"stacks":0,"source":"console"}',
    'supply.opened: {"id":1,"pid":0,"byPid":0,"tier":"white","class":"arms","first":1}',
    'supply.gone: {"id":1,"tier":"white","class":"arms","why":"emptied","landed":1,"opened":1}',
  ]);
  h.host.shutdown();
});

test("a session far from a drop, and one that joins while it is in the air, hold it as the server does and place it alike", () => {
  const h = new Harness({}, 1, 60, { dev: true, map: ground([BLUE, RED]), log: () => {} });
  const ada = h.join("ada");
  const bob = h.join("bob");
  h.run(500);
  h.say(ada, "enablecheats");
  h.say(bob, "enablecheats");
  h.say(ada, "tp 60 200");
  h.say(bob, "tp 480 300");
  h.run(300);
  // Near Ada, 420 m and six chunks from Bob, who is sent no body from there.
  const d = call(h, 62, 204, "blue", "works", { ringed: true, notice: 25 });
  const far = call(h, 470, 310, "green", "voyage", { ringed: false, notice: 25 });
  h.run(200);
  // Each is sent by the obelisk nearer it, on that one's clock.
  expect([d.sender, d.eye, far.sender, far.eye, Math.abs(eyePhase(far.release / TICK_RATE, RED) - CAST_PHASE) < 1e-6]).toEqual([0, 0, 1, 1, true]);
  expect(Math.abs((h.client(bob)!.chunk % h.world.dims.chunksX) - Math.floor(d.x / CHUNK_SIZE))).toBeGreaterThan(h.server.opts.entityRadius);
  expect([ada.supply, bob.supply, bob.supply.rows.map((r) => [r.id, r.ringed, r.landed])]).toEqual([told(h), told(h), [[1, true, false], [2, false, false]]]);
  // A third joins while the first is flying.
  until(h, Math.min(d.release, far.release), 60);
  const cy = h.join("cy");
  h.run(600);
  expect([cy.supply, cy.supply.rows.length]).toEqual([told(h), 2]);
  until(h, Math.max(d.land, far.land));
  // Both landed: all three know it, though each is sent at most one capsule's body.
  for (const s of [ada, bob, cy]) expect([s.supply, s.supply.rows.map((r) => r.landed)]).toEqual([told(h), [true, true]]);
  expect(capsules(h).map((c) => c.name).sort()).toEqual(["Green Voyage drop", "Ringed Blue Works drop"]);
  h.host.shutdown();
});

test("a server stopped while a drop is in the air lands the same loot at the same tick, and one that is not stopped lands it too", () => {
  const run = (db: string, restart: boolean) => {
    let h = new Harness({}, 1, 60, { dev: true, map: ground(), log: () => {}, dbPath: db, seed: 77 });
    h.run(300);
    const at = h.world.tick;
    const d = call(h, 300, 310, "purple", "arms", { notice: 25 });
    const ringed = call(h, 200, 210, "yellow", "works", { ringed: true, notice: 40 });
    const [land, later] = [d.land, ringed.land];
    until(h, d.release, 90);
    expect(h.host.supply.state(d)).toBe("flying");
    if (restart) {
      h.host.shutdown();
      h = new Harness({}, 1, 60, { dev: true, map: ground(), log: () => {}, dbPath: db, seed: 77 });
      // Taken up as it was: pending, nothing to put right.
      expect([h.host.supply.mended, h.host.supply.drops.map((x) => [x.id, x.land, x.landed, x.ringed, x.pid]), capsules(h).length]).toEqual([0, [[1, land, false, d.ringed, 0], [2, later, false, true, 0]], 0]);
    }
    until(h, Math.max(land, later));
    const boxes = capsules(h).sort((a, b) => a.expiresAt - b.expiresAt);
    const out = { at, land, later, rows: h.host.supply.drops.map((x) => [x.id, x.landed, x.land, x.end, x.y]), boxes: boxes.map((b) => [b.name, b.x, b.y, b.z, b.expiresAt, holds(h, b)]), audit: h.host.items.audit() };
    if (restart) {
      // Stopped again once landed: the capsules and their drops come back together.
      h.host.shutdown();
      const again = createHost(reg, { dbPath: db, map: ground(), log: () => {}, seed: 77 });
      expect([again.supply.mended, again.supply.drops.map((x) => [x.id, x.landed, x.pid !== 0]), capsules({ host: again }).length, again.items.audit()]).toEqual([0, [[1, true, true], [2, true, true]], 2, []]);
      again.shutdown();
    } else h.host.shutdown();
    return out;
  };
  const stopped = run(join(dir, "stopped.db"), true);
  const ran = run(join(dir, "ran.db"), false);
  expect(stopped).toEqual(ran);
  expect([stopped.boxes.length, stopped.audit, (stopped.boxes[0]![5] as string[]).length > 2]).toEqual([2, [], true]);
});

test("an edit to the book changes no drop already called: its level, its colour and its times are those it was called with", () => {
  const { h, ada, pilot } = world();
  const was = h.host.supplyBook.book.tiers[0]!;
  const first = call(h, 250, 252, "white", "provisions", { ringed: false, notice: 1 });
  edit(h, (book) => {
    book.tiers[0]!.level = 40;
    book.tiers[0]!.rgb = 0x123456;
    book.tiers[0]!.name = "Chalk";
    book.rules.lifeSeconds = 30;
    book.rules.announce = "map";
  });
  const second = call(h, 300, 300, "white", "provisions", { ringed: false, notice: 1 });
  h.run(200);
  expect([[first.level, first.rgb, first.tierName, first.end - first.land, first.announce], [second.level, second.rgb, second.tierName, second.end - second.land, second.announce]]).toEqual([
    [was.level, was.rgb, "White", 1200 * TICK_RATE, 0],
    [40, 0x123456, "Chalk", 30 * TICK_RATE, 2],
  ]);
  // Two drops of one tier that show differently: the message says each.
  expect([ada.supply, ada.supply.tiers.map((t) => [t.name, t.level, t.count])]).toEqual([told(h), [["White", was.level, 1], ["Chalk", 40, 1]]]);
  until(h, Math.max(first.land, second.land));
  h.say(ada, "addxp 400");
  tapUse(h, pilot);
  expect(h.client(ada)!.open).toBe(first.pid);
  // The second, left alone, is out of time in thirty seconds: what it held is burned, and it leaves.
  const events: string[] = [];
  const box = h.host.records.byPid.get(second.pid)!;
  expect(holds(h, box).length).toBeGreaterThan(0);
  until(h, second.end, 10);
  expect([h.host.records.byPid.has(box.pid), second.left, h.host.supply.state(second), h.host.items.audit(), h.host.supply.live(), events]).toEqual([false, second.end, "leaving", [], 1, []]);
  h.host.shutdown();
});

test("the console brings a drop down, takes one away, and says what it cannot do; the map holds thirty-two and no more", () => {
  const { h, ada } = world();
  for (const [line, said] of [
    ["supply", /^usage: supply call/],
    ["supply call here white", /^usage: supply call/],
    ["supply call here chalk arms", /^the book has no tier "chalk"$/],
    ["supply call here white hats", /^the book has no class "hats"$/],
    ["supply call 9000 9000 white arms", /^that is off the map$/],
    ["supply land 5", /^no live drop "5"$/],
    ["supply cancel all", /^no drops are live$/],
    ["supply open 1", /^no landed drop "1"$/],
  ] as const) expect(h.say(ada, line)[0]).toMatch(said);
  expect(h.say(ada, "supply book")).toEqual([
    "drop book revision 0 (the starter book), not kept: this world has no save",
    "7 tiers (white, green, blue, purple, yellow, red, meridian), 7 classes (shelter, arms, armour, stable, works, provisions, voyage)",
    expect.stringMatching(/^\d+ tables, 0 dormant, \d+ ids waiting for the game to have them$/),
    "1 circuits, 0 sites; 0 drops live, 0 called and 0 landed since the start",
    // A map with no list of sites has the one circuit over open ground, which a Harness keeps from calling.
    expect.stringMatching(/^circuit open: looks in \d+ s(; last time, drops are off \(bDisableLootCrates\))?, open ground$/),
  ]);
  // Called where she stands, four minutes out by the book; brought down in three seconds, then at once.
  expect(h.say(ada, "supply call here red stable ringed")[0]).toMatch(/^called 1: ringed red stable at 250 250, coming, lands in (2[4-9]\d|3[0-5]\d) s$/);
  expect(h.say(ada, "supply call 300 300 meridian voyage plain")[0]).toMatch(/^called 2: meridian voyage at 300 300/);
  const [a, b] = h.host.supply.drops as [Drop, Drop];
  expect(h.say(ada, "supply land 1 3")).toEqual(["drop 1 lands in 3 s"]);
  // This world is younger than a flight, so its cast left at the world's first tick and flies the faster.
  expect([a.land - h.world.tick <= 3 * TICK_RATE + 1, a.release, a.land - a.release < 30 * TICK_RATE, a.release >= a.called, ada.supply]).toEqual([true, 0, true, true, told(h)]);
  // Its cast is under way already, seen arriving.
  expect(["flying", "braking"]).toContain(h.host.supply.state(a));
  h.run(3500);
  expect([a.landed, b.landed, capsules(h).length]).toEqual([true, false, 1]);
  expect(h.say(ada, "supply land all")).toEqual(["drop 2 lands in 0 s"]);
  // In a world younger than a flight the cast left at its first tick: no tick of a drop is before the world's.
  expect([b.release >= 0, b.called >= 0, b.brake < b.land - b.release, ada.supply.rows.every((r) => r.called >= 0 && r.called < 1e9)]).toEqual([true, true, true, true]);
  h.run(300);
  expect([b.landed, capsules(h).length, h.say(ada, "supply land all")]).toEqual([true, 2, ["none of them is pending"]]);
  expect(h.say(ada, "supply list")).toEqual([expect.stringMatching(/^1: ringed red stable at 250 250, landed, \d+ s left$/), expect.stringMatching(/^2: meridian voyage at 300 300, landed, \d+ s left$/)]);
  // Taken away: a landed one leaves with what it held, burned through the ledger.
  expect(h.say(ada, "supply cancel 1")).toEqual(["cancelled 1"]);
  expect([capsules(h).length, a.left > 0, h.host.supply.state(a), h.host.items.audit(), h.host.supply.live()]).toEqual([1, true, "leaving", [], 1]);
  expect(h.say(ada, "supply cancel 1")[0]).toBe('no live drop "1"');
  // A pending one is gone at once.
  const c = call(h, 100, 100, "white", "arms");
  expect(h.say(ada, `supply cancel ${c.id}`)).toEqual([`cancelled ${c.id}`]);
  expect(h.host.supply.get(c.id)).toBeNull();
  h.say(ada, "supply cancel all");
  seconds(h, LEAVE_SECONDS * TICK_RATE + 10);
  expect([h.host.supply.drops, capsules(h), ada.supply.rows]).toEqual([[], [], []]);
  // Thirty-two at once, each its own id, and the thirty-third is refused.
  for (let i = 0; i < SUPPLY_MOST; i++) call(h, 20 + i * 12, 30, "green", "shelter");
  expect(h.host.supply.call({ x: 40, z: 40, tier: "green", cls: "shelter", source: "test" })).toBe("32 drops are live already");
  h.run(200);
  expect([new Set(h.host.supply.drops.map((d) => d.id)).size, ada.supply.rows.length, ada.supply]).toEqual([SUPPLY_MOST, SUPPLY_MOST, told(h)]);
  h.host.shutdown();
});

test("thirty-two drops live and others still going: every session holds them all, and the live ones whatever else there is no room for", () => {
  const { h, ada } = world();
  for (let i = 0; i < SUPPLY_MOST; i++) call(h, 20 + i * 12, 30, "green", "shelter");
  h.say(ada, "supply land all 0");
  h.run(400);
  // One landed capsule is taken away and another called in its place: thirty-two live, and one going for twelve seconds.
  const gone = h.host.supply.drops[0]!;
  expect(h.say(ada, `supply cancel ${gone.id}`)).toEqual([`cancelled ${gone.id}`]);
  const next = call(h, 40, 80, "green", "shelter");
  h.run(300);
  expect([h.host.supply.live(), h.host.supply.drops.length, ada.supply.rows.length, ada.supply.rows.some((r) => r.id === next.id)]).toEqual([32, 33, 33, true]);
  expect(ada.supply).toEqual(told(h));
  // The map cleared and filled again three times inside the twelve seconds: thirty-two are live and ninety-seven are
  // going, which is more than a message carries. It has every live one and the thirty-one last to go.
  for (let k = 0; k < 3; k++) {
    h.say(ada, "supply land all 0");
    h.run(300);
    h.say(ada, "supply cancel all");
    for (let i = 0; i < SUPPLY_MOST; i++) call(h, 20 + i * 12, 110 + k * 30, "green", "shelter");
  }
  h.run(300);
  const { drops } = h.host.supply;
  const live = drops.filter((d) => d.left === 0);
  const going = drops.filter((d) => d.left > 0).sort((a, b) => b.left - a.left || b.id - a.id);
  expect([live.length, going.length, ada.supply.rows.length]).toEqual([32, 97, SUPPLY_ROWS]);
  expect(ada.supply.rows.map((r) => r.id).sort((a, b) => a - b)).toEqual([...live, ...going.slice(0, SUPPLY_ROWS - 32)].map((d) => d.id).sort((a, b) => a - b));
  expect(ada.supply).toEqual(told(h));
  // A session that joins now is told the same, and once the rest have gone the list is the live ones alone.
  const bob = h.join("bob");
  h.run(400);
  expect(bob.supply).toEqual(ada.supply);
  seconds(h, LEAVE_SECONDS * TICK_RATE + 10);
  expect([h.host.supply.drops.length, ada.supply.rows.length, ada.supply.rows.every((r) => r.left === 0), bob.supply]).toEqual([32, 32, true, ada.supply]);
  h.host.shutdown();
});

test("a tier and a class named in any script reach every session, and the capsule opens under its name: twenty-four characters at their widest", () => {
  const { h, ada, pilot } = world();
  // Twenty-four characters of four bytes each, a Chinese character outside the first plane and an emoji: the most a
  // name of the book's can take on the wire, and the capsule's name with both in it the most an open box's can.
  const [wide, pairs] = ["𠮷".repeat(24), "🎁".repeat(24)];
  edit(h, (b) => {
    b.tiers[0]!.name = wide;
    b.classes.find((c) => c.key === "arms")!.name = pairs;
  });
  const d = call(h, 250, 253, "white", "arms", { ringed: true });
  h.say(ada, `supply land ${d.id} 0`);
  h.run(600);
  expect([d.landed, ada.supply.rows.length, ada.supply.tiers[0]?.name, ada.supply.classes[0]?.name]).toEqual([true, 1, wide, pairs]);
  expect(ada.supply).toEqual(told(h));
  // She still reads the world about her, and the capsule opens.
  h.say(ada, "addxp 200000");
  h.run(300);
  tapUse(h, pilot);
  expect([d.opened, ada.open?.takeOnly, ada.open?.name]).toEqual([true, true, `Ringed ${wide} ${pairs} drop`]);
  // The name that began this, as a review met it: twenty-two characters of three bytes.
  edit(h, (b) => void (b.tiers[1]!.name = "一二三四五六七八九十一二三四五六七八九十一二"));
  call(h, 200, 200, "green", "shelter");
  h.run(300);
  expect([ada.supply.rows.length, ada.supply.tiers[1]?.name, ada.supply]).toEqual([2, "一二三四五六七八九十一二三四五六七八九十一二", told(h)]);
  h.host.shutdown();
});

test("a module is asked before a drop is called and may refuse it or change it, and one it lets hold nothing never lands", () => {
  const mod = listener("warden", ["supply.call", "item.gain", "supply.gone"]);
  const { h } = world({ modules: [mod.def] });
  let greedy = false;
  mod.heard.each = (e) => {
    if (e.name === "supply.call" && e.data.tier === "red") e.refuse("no red drops on this server");
    if (e.name === "supply.call" && e.data.tier === "green") Object.assign(e.data, { tier: "blue", class: "armour", ringed: 1 });
    if (e.name === "item.gain" && e.data.why === "supply" && greedy) e.refuse("nothing for anyone");
  };
  expect(h.host.supply.call({ x: 250, z: 250, tier: "red", cls: "arms", source: "test" })).toBe("no red drops on this server");
  const changed = call(h, 250, 250, "green", "arms", { notice: 1 });
  expect([changed.tierKey, changed.clsKey, changed.ringed, changed.level, changed.count]).toEqual(["blue", "armour", true, 25, 3]);
  // What a module writes is checked as a caller's is.
  mod.heard.each = (e) => void (e.name === "supply.call" && Object.assign(e.data, { tier: "nonesuch" }));
  expect(h.host.supply.call({ x: 250, z: 250, tier: "green", cls: "arms", source: "test" })).toBe('the book has no tier "nonesuch"');
  mod.heard.each = (e) => void (e.name === "item.gain" && e.data.why === "supply" && greedy && e.refuse("nothing for anyone"));
  until(h, changed.land);
  expect([changed.landed, capsules(h).length]).toEqual([true, 1]);
  // Asked of each stack, with the reason: two of one thing that join are one slot.
  const gains = mod.heard.lines.filter((l) => l.startsWith("item.gain"));
  expect([gains.length >= holds(h, capsules(h)[0]!).length, gains.every((l) => l.includes('"why":"supply"'))]).toEqual([true, true]);
  // Every stack refused: its floor is refused too, so no capsule lands, no record is left, and it is told as gone, empty.
  greedy = true;
  const empty = call(h, 260, 260, "white", "works", { notice: 1 });
  until(h, empty.land);
  h.run(100);
  expect([h.host.supply.get(empty.id), capsules(h).length, h.host.items.audit(), mod.heard.lines.pop()]).toEqual([null, 1, [], `supply.gone: {"id":${empty.id},"tier":"white","class":"works","why":"empty","landed":0,"opened":0}`]);
  h.host.shutdown();
});

test("a capsule comes to rest on what stands at its place: the ground, a floor built there, or the water over them; with no obelisk it comes straight down", () => {
  const map = writeMap(flatMap(8, { seaLevel: 1.5, statics: [{ kind: "core:foundation", x: 300, y: 4, z: 300, yaw: 0 }] }));
  const h = new Harness({}, 1, 60, { dev: true, map, log: () => {} });
  h.run(200);
  const onWater = call(h, 200, 200, "white", "arms", { notice: 1 });
  const onFloor = call(h, 300, 300, "white", "arms", { notice: 1 });
  expect([onWater.sender, onWater.eye, onWater.ox, onWater.oy, onWater.oz]).toEqual([SENDER_ZENITH, SENDER_ZENITH, 200, EYE_KNOT, 200]);
  // With no display to keep time by it lands on the notice exactly.
  expect([onWater.land - onWater.called, onWater.release]).toEqual([30 * TICK_RATE, onWater.called]);
  until(h, onFloor.land);
  expect([onWater.y, onFloor.y, capsules(h).map((c) => c.y).sort()]).toEqual([1.5, 4.15625, [1.5, 4.15625]]);
  let bodies = 0;
  for (let i = 0; i < h.world.ents.cap; i++) if ((h.world.ents.flags[i]! & F_ALIVE) !== 0 && h.world.ents.kind[i] === CAPSULE) bodies++;
  expect(bodies).toBe(2);
  h.host.shutdown();
});

async function runUntilKilled(db: string, seed: number, minAcks: number): Promise<void> {
  const proc = Bun.spawn(["bun", join(import.meta.dir, "../fixtures/crash-child.ts"), db, String(seed), "supply"], { stdout: "pipe", stderr: "inherit" });
  const decoder = new TextDecoder();
  let text = "";
  let killed = false;
  for await (const chunk of proc.stdout) {
    text += decoder.decode(chunk);
    if (!killed && text.split("acked").length > minAcks) {
      proc.kill(9);
      killed = true;
    }
  }
  await proc.exited;
}

test("a process killed at any moment leaves each drop wholly pending or wholly landed: a capsule for every landed drop, loot minted once, nothing to put right", async () => {
  const db = join(dir, "killed.db");
  let landed = 0;
  let pending = 0;
  for (const [seed, minAcks] of [[41, 60], [42, 90], [43, 45], [44, 75]] as const) {
    await runUntilKilled(db, seed, minAcks);
    // Loading audits the ledger and checks each capsule against each drop: there must be nothing to put right.
    const host = createHost(reg, { dbPath: db, log: () => {} });
    expect([host.items.audit(), host.supply.mended]).toEqual([[], 0]);
    const boxes = capsules({ host });
    const drops = host.supply.drops;
    // Every landed drop names a capsule that names it, and no capsule is without one.
    expect(drops.filter((d) => d.landed).map((d) => [...(host.records.byPid.get(d.pid)?.extra.get(SUPPLY_TAG) ?? [])]).sort()).toEqual(boxes.map((b) => [...b.extra.get(SUPPLY_TAG)!]).sort());
    expect(drops.filter((d) => !d.landed).every((d) => d.pid === 0)).toBe(true);
    for (const b of boxes) expect(host.items.inv(b).used()).toBeGreaterThan(0);
    expect(new Set(drops.map((d) => d.id)).size).toBe(drops.length);
    landed += boxes.length;
    pending += drops.length - boxes.length;
    // The takers are all there, with what they took.
    expect([...host.persistence!.survivors.values()].length).toBe(SUPPLY_TAKERS);
    host.shutdown();
  }
  // The kills fell on worlds with both kinds in them.
  expect([landed > 0, pending > 0]).toEqual([true, true]);
});
