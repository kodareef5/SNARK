// A supply drop through the whole client (client/core/supply.ts and what the HUD, the prompt and the bag do with one):
// its shaft drawn from near and far, its capsule in the air, the prompt that says its level, the bag that only takes,
// and the compass and the map where the drop book tells of it. `bun tools/supply/review.ts` pictures the same.

import { expect } from "bun:test";
import { App } from "../../client/core/app.ts";
import { KEY_INV_SLOT, KEY_OPEN_SLOT, KEY_OPEN_TAKE_ALL } from "../../client/core/ui/inventory.ts";
import { TAKE_ONLY } from "../../server/own.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { RESULT_BUSY, TEXT_NOTICE } from "../../shared/net/protocol.ts";
import { LEAVE_SECONDS, POSE_BRAKING, POSE_COMING, POSE_LANDED, POSE_LEAVING } from "../../shared/sim/supply.ts";
import type { SupplyBook } from "../../shared/supply/book.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { Harness } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";

/** Ada's whole client on level ground a kilometre a side, with cheats, at (x, z). */
function client(x = 600, z = 600) {
  const h = new Harness({}, 1, 60, { dev: true, map: writeMap(flatMap(16)), log: () => {} });
  const app = new App(h.join("ada", {}, { manual: true }), h.reg, corePack());
  const run = (ms: number): void => h.run(ms, (now) => void app.frame(now, 1280, 720));
  run(600);
  const s = app.session;
  s.text("enablecheats");
  run(300);
  /** Stands at (x, z) looking at (tx, tz), the eye raised `pitch` radians. */
  const stand = (px: number, pz: number, tx: number, tz: number, pitch = 0): void => {
    s.text(`tp ${px} ${pz}`);
    app.controls.yaw = Math.atan2(tx - px, tz - pz);
    app.controls.pitch = pitch;
    run(400);
  };
  stand(x, z, x, z + 10);
  const tap = (code: string): void => {
    app.key(code, true);
    run(70);
    app.key(code, false);
    run(300);
  };
  const edit = (change: (book: SupplyBook) => void): void => {
    const store = h.host.supplyBook;
    const next = JSON.parse(JSON.stringify(store.book)) as SupplyBook;
    const revision = store.book.revision;
    change(next);
    expect(store.save(next, revision, "test", "")).toEqual({ ok: true, revision: revision + 1 });
  };
  return { h, app, s, run, stand, tap, edit, me: h.host.records.byPid.get(h.client(s)!.pid)! };
}

artTest("the whole client: a drop's shaft from near and from far, its capsule in the air, the prompt that says its level, a bag that only takes, and its going", () => {
  const { h, app, s, run, stand, tap, me } = client();
  const { supply } = h.host;
  const [X, Z] = [640, 660];
  stand(X - 30, Z - 30, X, Z, 0.25);
  s.text(`supply call ${X} ${Z} purple works plain 60`);
  run(2600);
  const d = supply.drops[0]!;
  const row = () => s.supply.rows[0]!;
  // Its shaft stands, and nothing of a capsule yet.
  expect([s.supply.rows.length, app.supply.stateOf(row()), app.supply.shafts, app.supply.capsules]).toEqual([1, POSE_COMING, 1, 0]);
  // From 500 m, and with her back to it, when nothing of it is in the view.
  stand(280, 320, X, Z, 0.1);
  expect(app.supply.shafts).toBe(1);
  stand(280, 320, 0, 0, 0);
  expect(app.supply.shafts).toBe(0);
  // Brought down: the capsule is drawn in the air as it brakes, and not once it stands near her as the server's prop.
  stand(X - 60, Z - 40, X, Z, 0.5);
  s.text(`supply land ${d.id} 10`);
  run(300);
  h.run(((d.land - d.brake - h.world.tick) / TICK_RATE) * 1000 + 2000, (now) => void app.frame(now, 1280, 720));
  expect([app.supply.stateOf(row()), app.supply.shafts, app.supply.capsules]).toEqual([POSE_BRAKING, 1, 1]);
  h.run(((d.land - h.world.tick) / TICK_RATE) * 1000 + 1000, (now) => void app.frame(now, 1280, 720));
  // Landed near her: the capsule is its model where the pack has one, and where it has none the server's prop, which this does not draw.
  expect([d.landed, app.supply.stateOf(row()), app.supply.shafts, app.supply.capsules]).toEqual([true, POSE_LANDED, 1, app.supply.modelled ? 1 : 0]);
  // From far off there is no prop in her view, and the capsule is drawn in its place.
  stand(X - 300, Z, X, Z, 0);
  expect([app.supply.shafts, app.supply.capsules]).toEqual([1, 1]);
  // At hand, below its level: the prompt says the level and E opens nothing.
  stand(X, Z - 3.2, X, Z, -0.3);
  expect(app.hud.prompt).toBe("Purple Works drop  opens at level 35");
  tap("KeyE");
  expect([s.open, d.opened]).toEqual([null, false]);
  s.text("addxp 200000");
  run(400);
  expect([s.progress.level >= 35, app.hud.prompt]).toEqual([true, "E  open Purple Works drop"]);
  tap("KeyE");
  expect([s.open?.name, s.open?.takeOnly, d.opened, app.ui.inventory.open]).toEqual(["Purple Works drop", true, true, true]);
  expect(app.ui.frame.nodes.find((n) => n.key === KEY_OPEN_TAKE_ALL)?.text).toBe("Take all");
  const inside = s.open!.inventory;
  const mine = s.inventory!;
  const held = inside.used();
  expect(held).toBeGreaterThan(3);
  const used = (): number[] => Array.from({ length: inside.cap }, (_, k) => k).filter((k) => inside.item[k] !== 0);
  // A right click on a stack takes it into the first free slot of the bag.
  const first = used()[0]!;
  const what = inside.item[first]!;
  app.ui.inventory.pointer(0, KEY_OPEN_SLOT + first * 3, 2, s);
  run(300);
  expect([inside.item[first], mine.item[0], inside.used()]).toEqual([0, what, held - 1]);
  // A stack picked up and put down on one of hers it does not join goes to a free slot: a box that only gives does not swap.
  const second = used()[0]!;
  const other = inside.item[second]!;
  app.ui.inventory.pointer(0, KEY_OPEN_SLOT + second * 3, 0, s);
  app.ui.inventory.pointer(0, KEY_INV_SLOT + 0 * 3, 0, s);
  run(300);
  expect([mine.item[0], mine.item[1], inside.used()]).toEqual([what, other, held - 2]);
  // Putting one of hers in is refused by the server, which says why.
  const from = s.logVersion;
  app.ui.inventory.pointer(0, KEY_INV_SLOT + 0 * 3, 0, s);
  app.ui.inventory.pointer(0, KEY_OPEN_SLOT + first * 3, 0, s);
  run(300);
  expect([mine.item[0], inside.used(), s.log.slice(-(s.logVersion - from)).filter((l) => l.channel === TEXT_NOTICE).map((l) => l.text)]).toEqual([what, held - 2, [TAKE_ONLY]]);
  // Take all: the rest, and it shuts and leaves.
  const corrections = s.stats.corrections;
  app.ui.inventory.pointer(0, KEY_OPEN_TAKE_ALL, 0, s);
  run(900);
  expect([mine.used(), s.open, h.host.records.byPid.has(d.pid), d.left > 0, row().left, s.stats.corrections - corrections]).toEqual([held, null, false, true, d.left, 0]);
  if (app.ui.inventory.open) tap("KeyI");
  stand(X - 20, Z - 20, X, Z, 0.5);
  run(1200);
  expect([app.supply.stateOf(row()), app.supply.capsules]).toEqual([POSE_LEAVING, 1]);
  run(LEAVE_SECONDS * 1000);
  expect([s.supply.rows, app.supply.shafts, app.supply.capsules, h.host.items.audit(), me.dead]).toEqual([[], 0, 0, [], false]);
  h.host.shutdown();
});

artTest("take all takes all: twenty stacks and more leave a capsule at one press, though the server runs a session's commands a few at a time", () => {
  const { h, app, s, run, stand, tap, me } = client();
  const { supply, items } = h.host;
  const bow = h.reg.index.get("core:bow")!;
  let busy = 0;
  const heard = s.onResult;
  s.onResult = (seq, code) => {
    if (code === RESULT_BUSY) busy++;
    heard?.(seq, code);
  };
  s.text("addxp 200000");
  run(400);
  /** A ringed white drop landed at (x, z) with twenty bows beside its own loot: a stack to a slot, so more moves than the server queues. */
  const landed = (x: number, z: number) => {
    s.text(`supply call ${x} ${z} white provisions ringed 0`);
    run(600);
    const d = supply.drops.at(-1)!;
    s.text(`supply land ${d.id} 0`);
    run(600);
    const box = h.host.records.byPid.get(d.pid)!;
    expect([d.landed, items.mint(box, bow, 20)]).toEqual([true, 20]);
    stand(x, z - 3.2, x, z, -0.3);
    return { d, box, held: items.inv(box).used() };
  };
  const a = landed(640, 660);
  expect(a.held).toBeGreaterThan(20);
  // Its name is said whole, though an entity's own is cut at twenty-four characters.
  expect(app.hud.prompt).toBe("E  open Ringed White Provisions drop");
  tap("KeyE");
  expect([s.open?.name, s.open?.takeOnly, s.open?.inventory.used()]).toEqual(["Ringed White Provisions drop", true, a.held]);
  const mine = s.inventory!;
  const before = mine.used();
  expect(mine.bag - before).toBeGreaterThanOrEqual(a.held);
  app.ui.inventory.pointer(0, KEY_OPEN_TAKE_ALL, 0, s);
  expect(app.ui.inventory.taking.busy).toBe(true);
  run(1500);
  // Everything is hers, the capsule shut on being emptied and is leaving, and the server had room for all she asked.
  expect([mine.used() - before, s.open, app.ui.inventory.taking.busy, h.host.records.byPid.has(a.d.pid), a.d.left > 0, busy, items.audit()]).toEqual([a.held, null, false, false, true, 0, []]);
  // With room for five stacks and no more, she takes five, and the rest stays in a capsule that stays open.
  if (app.ui.inventory.open) tap("KeyI");
  const free = (): number => mine.bag - mine.used();
  expect(items.mint(me, bow, free() - 5)).toBe(mine.bag - mine.used() - 5);
  run(300);
  expect(free()).toBe(5);
  const b = landed(700, 660);
  tap("KeyE");
  expect(s.open?.inventory.used()).toBe(b.held);
  app.ui.inventory.pointer(0, KEY_OPEN_TAKE_ALL, 0, s);
  run(1500);
  expect([free(), s.open?.inventory.used(), app.ui.inventory.taking.busy, items.inv(b.box).used(), b.d.left, busy, items.audit()]).toEqual([0, b.held - 5, false, b.held - 5, 0, 0, []]);
  h.host.shutdown();
});

artTest("where the drop book tells of its drops: nothing by default, a pip on the compass, a mark on the map as well, and a line that says how far and which way", () => {
  const { h, app, s, run, edit } = client(500, 500);
  const { supply } = h.host;
  const marks = (): string[] => app.hud.markers.filter((m) => m.kind === "drop" || m.kind === "dropPip").map((m) => `${m.kind} ${(m.tint ?? -1).toString(16)} ${m.u.toFixed(3)} ${m.v.toFixed(3)}`);
  const lines = (from: number): string[] => s.log.slice(-(s.logVersion - from)).filter((l) => l.channel === TEXT_NOTICE).map((l) => l.text);
  const rgb = (tier: string): string => h.host.supplyBook.book.tiers.find((t) => t.key === tier)!.rgb.toString(16);
  let from = s.logVersion;
  supply.call({ x: 500, z: 800, tier: "white", cls: "arms", ringed: false, source: "test" });
  run(300);
  expect([marks(), lines(from)]).toEqual([[], []]);
  // Each drop keeps the way it was told of when it was called.
  edit((book) => void (book.rules.announce = "compass"));
  supply.call({ x: 800, z: 500, tier: "green", cls: "works", ringed: false, source: "test" });
  run(300);
  // The map's picture has x running west and z north: 800 m along x is 0.219 across it.
  expect([marks(), lines(from)]).toEqual([[`dropPip ${rgb("green")} 0.219 0.512`], []]);
  edit((book) => void (book.rules.announce = "map"));
  supply.call({ x: 200, z: 200, tier: "red", cls: "voyage", ringed: true, source: "test" });
  run(300);
  expect([marks(), lines(from)]).toEqual([[`dropPip ${rgb("green")} 0.219 0.512`, `drop ${rgb("red")} 0.805 0.805`], []]);
  // "chat": the compass, the map, and a line to everyone in the world, each by where they stand.
  edit((book) => void (book.rules.announce = "chat"));
  from = s.logVersion;
  supply.call({ x: 500, z: 100, tier: "blue", cls: "stable", ringed: false, source: "test" });
  supply.call({ x: 2, z: 998, tier: "meridian", cls: "armour", ringed: true, source: "test" });
  supply.call({ x: 510, z: 505, tier: "white", cls: "shelter", ringed: false, source: "test" });
  run(300);
  expect(lines(from)).toEqual(["A Blue Stable drop is coming down 400 m to the south.", "A ringed Meridian Armour drop is coming down 700 m to the north-east.", "A White Shelter drop is coming down here."]);
  expect(marks().length).toBe(5);
  // One that has left is told of no longer.
  supply.cancel(supply.drops.find((d) => d.tierKey === "red")!);
  run(300);
  expect(marks().some((m) => m.startsWith(`drop ${rgb("red")}`))).toBe(false);
  h.host.shutdown();
});
