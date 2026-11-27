// The tame orders that walk a course, in the whole client: the go-there whistles, and the pins panel's send and patrol.

import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { PATROL_MOST, goPins, orderPatrol } from "../../client/core/courses.ts";
import { KEY_ROWS } from "../../client/core/keys.ts";
import type { PinView } from "../../client/core/pins.ts";
import type { UiNode } from "../../client/core/ui/nodes.ts";
import { KEY_PIN_PATROL, KEY_PIN_SEND } from "../../client/core/ui/pins-panel.ts";
import { KEY_MAP_MARK_TOOL, KEY_MAP_TOOLS } from "../../client/core/ui/screens.ts";
import { ORDERED } from "../../server/courses.ts";
import { PIN_REACH, lookPlace } from "../../server/pins.ts";
import type { EntityRecord } from "../../server/records.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { CMD_ORDER, ORDER_ALL, ORDER_MOVE, ORDER_PATROL } from "../../shared/net/protocol.ts";
import { stanceEye } from "../../shared/sim/character.ts";
import { WAYPOINT_KINDS } from "../../shared/world/course.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";

const MAP = writeMap(flatMap(16));

/** Ada in the whole client with cheats, two tame raptors of hers beside her and one of hers out of whistle range. */
function play() {
  const h = new Harness({}, 3, 60, { dev: true, map: MAP });
  const app = new App(h.join("ada", {}, { manual: true }), h.reg, corePack());
  const run = (ms: number): void => h.run(ms, (now) => void app.frame(now, 1280, 720));
  run(1000);
  app.session.text("enablecheats");
  run(300);
  const me = h.host.records.byPid.get(h.client(app.session)!.pid)!;
  const e0 = h.ent(app.session), ents = h.world.ents;
  const tame = (dx: number, dz: number): { e: number; rec: EntityRecord } => {
    const e = h.host.spawnCreature("core:raptor", ents.x[e0]! + dx, ents.z[e0]! + dz, 1);
    const rec = h.host.records.byPid.get(ents.pid[e]!)!;
    expect(h.host.taming.give(rec, me, 0.9, "forced")).toBe(true);
    h.host.creatures.mind.stay(e, h.world.tick + 1e6);
    return { e, rec };
  };
  const tames = [tame(-2, 5), tame(2, 5), tame(70, 0)];
  run(400);
  for (let k = 0; k < 4 && app.ui.captureKeyboard; k++) tap(app, "Escape", run);
  const at = (key: number): UiNode | null => app.ui.frame.find(key);
  const click = (key: number): void => {
    const box = at(key);
    expect(box?.interactive, `key ${key}`).toBe(true);
    const x = box!.x + box!.w / 2, y = box!.y + box!.h / 2;
    app.pointer(0, key, x, y, 0, 1);
    app.pointer(1, key, x, y, 0, 1);
    run(64);
  };
  return { h, app, run, me, tames, at, click };
}

function tap(app: App, code: string, run: (ms: number) => void): void {
  app.key(code, true);
  run(60);
  app.key(code, false);
  run(300);
}

/** Points the view at the middle of entity `e`. */
function aim(h: Harness, app: App, e: number): void {
  const ents = h.world.ents, s = app.session;
  const eye = s.own.y + stanceEye(h.reg.move[s.ownKind]!, s.own.stance);
  const [dx, dz] = [ents.x[e]! - s.own.x, ents.z[e]! - s.own.z];
  app.controls.yaw = Math.atan2(dx, dz);
  app.controls.pitch = Math.atan2(ents.y[e]! + h.reg.bodyHeight[ents.kind[e]!]! * 0.5 - eye, Math.hypot(dx, dz));
}

test("the bracket held on a tame sends it where she looks as it is let go, and the quote sends all that hear", () => {
  const { h, app, run, tames } = play();
  const [one, two, far] = tames as [{ e: number; rec: EntityRecord }, { e: number; rec: EntityRecord }, { e: number; rec: EntityRecord }];
  const rows = KEY_ROWS.filter((r) => r.name.startsWith("go there"));
  expect(rows.map((r) => [r.keys, r.guide?.[0]?.title])).toEqual([[["BracketLeft"], "Go there: one"], [["Quote"], "Go there: all"]]);
  aim(h, app, one.e);
  run(300);
  expect(app.lookedAt).toBe(one.e);
  app.key("BracketLeft", true);
  run(60);
  app.controls.yaw = 0.8;
  app.controls.pitch = -Math.atan2(1.6, 16);
  run(400);
  app.key("BracketLeft", false);
  run(300);
  const looked = { x: 0, z: 0 };
  expect(lookPlace(h.world, h.ent(app.session), PIN_REACH, looked)).toBe(true);
  const o = one.rec.part(ORDERED)!;
  expect([o.what, o.pins.length, h.host.courses.has(two.e)]).toEqual([ORDER_MOVE, 0, false]);
  expect(Math.hypot(o.x - looked.x, o.z - looked.z)).toBeLessThan(0.5);
  // Let go looking at nothing of hers, the bracket sends nobody.
  app.key("BracketLeft", true);
  app.key("BracketLeft", false);
  run(300);
  expect(h.host.tameOrders.given).toBe(1);
  tap(app, "Quote", run);
  expect([one, two, far].map((t) => t.rec.part(ORDERED)?.what ?? 0)).toEqual([ORDER_MOVE, ORDER_MOVE, 0]);
  expect(h.host.courses.has(two.e)).toBe(true);
});

test("a pin's send in the panel sends the tames in range to it, and patrol sends them round the Go pins", () => {
  const { h, me, tames, at, click } = play();
  const go = WAYPOINT_KINDS.indexOf("go"), meet = WAYPOINT_KINDS.indexOf("meet");
  const pins = h.host.pins;
  const a = pins.place(me.team, me.pid, 300, 300, go, true, "a");
  pins.place(me.team, me.pid, 320, 300, meet, true, "m");
  const b = pins.place(me.team, me.pid, 320, 320, go, true, "b");
  click(KEY_MAP_TOOLS);
  click(KEY_MAP_TOOLS);
  click(KEY_MAP_MARK_TOOL);
  expect(at(KEY_PIN_PATROL)?.text).toBe("Patrol 2");
  // The list is newest first: its third row is the first pin.
  click(KEY_PIN_SEND + 2);
  h.run(300);
  expect(tames.map((t) => t.rec.part(ORDERED)?.pins ?? [])).toEqual([[a.id], [a.id], []]);
  click(KEY_PIN_PATROL);
  h.run(300);
  expect(tames.map((t) => [t.rec.part(ORDERED)?.what ?? 0, t.rec.part(ORDERED)?.pins ?? []])).toEqual([[ORDER_PATROL, [a.id, b.id]], [ORDER_PATROL, [a.id, b.id]], [0, []]]);
  expect(h.host.courses.of(tames[0]!.e)!.mode).toBe(1);
  // At phone width the panel's controls still lie within it.
  const panel = at(4600)!;
  for (const key of [KEY_PIN_PATROL, KEY_PIN_SEND, KEY_PIN_SEND + 1, KEY_PIN_SEND + 2]) {
    const n = at(key)!;
    expect(n.x >= panel.x && n.x + n.w <= panel.x + panel.w).toBe(true);
  }
});

test("a patrol is sent as its pins in order, eight at the most, and Go pins are those shared", () => {
  const view = (id: number, kind: number, shared = true): PinView => ({ id, kind, shared, mine: true, author: "", x: 0, z: 0, radius: 1, priority: 0, pull: 0, at: 0, expires: 0, label: "" });
  expect(goPins([view(1, 0), view(2, 4), view(3, 0, false), view(4, 0)])).toEqual([1, 4]);
  let sent: Uint8Array | null = null;
  const sender = { command: (op: number, args?: (w: BitWriter) => void): number => {
    expect(op).toBe(CMD_ORDER);
    const w = new BitWriter(64);
    args!(w);
    sent = w.bytes();
    return 1;
  } };
  expect(orderPatrol(sender, ORDER_ALL, [], false)).toBe(0);
  orderPatrol(sender, ORDER_ALL, [5, 6, 7, 8, 9, 10, 11, 12, 13, 14], true);
  const r = new BitReader(sent!);
  const head = [r.u32(), r.u8(), r.bool()];
  const ids: number[] = [];
  for (let n = r.bits(3) + 1; n > 0; n--) ids.push(r.varint());
  expect([head, ids, r.overflow]).toEqual([[ORDER_ALL, ORDER_PATROL, true], [5, 6, 7, 8, 9, 10, 11, 12].slice(0, PATROL_MOST), false]);
});
